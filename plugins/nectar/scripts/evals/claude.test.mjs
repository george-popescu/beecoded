import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createClaudeEvalWorkspace,
  runClaudeCase,
} from './claude.mjs';
import { loadContracts } from './contracts.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(currentDirectory, '../..');
const contracts = loadContracts(path.join(pluginRoot, 'evals', 'contracts'));
const reviewRiskClassification = contracts.find((contract) => (
  contract.id === 'review-risk-classification'
));
const splitApproval = contracts.find((contract) => contract.id === 'split-approval');

test('materializes the shared risk-classification case for Claude', (t) => {
  const workspace = createClaudeEvalWorkspace({
    contract: reviewRiskClassification,
    pluginRoot,
  });
  t.after(workspace.cleanup);

  const prompt = fs.readFileSync(workspace.promptPath, 'utf8');
  const grader = fs.readFileSync(workspace.graderPath, 'utf8');

  assert.match(prompt, /Use the Nectar `review` skill/);
  assert.match(prompt, /preserves independent concurrent session patches/);
  assert.match(prompt, /provisional label.*untrusted/i);
  assert.match(grader, /only blocking code defect/i);
  assert.match(grader, /HARDENING_IDEA/);
  assert.match(grader, /read-only pass with no fixes/i);
  assert.match(grader, /findingMatches/);
  assert.match(grader, /severityIn/);
});

test('materializes a native Claude prompt and grader from one shared contract', (t) => {
  const workspace = createClaudeEvalWorkspace({
    contract: splitApproval,
    pluginRoot,
  });
  t.after(workspace.cleanup);

  const prompt = fs.readFileSync(workspace.promptPath, 'utf8');
  const grader = fs.readFileSync(workspace.graderPath, 'utf8');
  const copiedManifest = JSON.parse(fs.readFileSync(
    path.join(workspace.pluginRoot, '.claude-plugin', 'plugin.json'),
    'utf8',
  ));

  assert.equal(copiedManifest.name, 'nectar');
  assert.match(prompt, /Plan the approved checkout rebuild/);
  assert.match(prompt, /docs\/work\/2026-07-16-checkout-rebuild\/design\.md/);
  assert.match(prompt, /Checkout Rebuild — Design/);
  assert.match(prompt, /Use the Nectar `plan` skill/);
  assert.match(grader, /Presents the complete ordered split/);
  assert.match(grader, /Approve split/);
  assert.match(grader, /childDirectoriesAbsent/);
  assert.ok(workspace.pluginRoot.startsWith(os.tmpdir()));
  assert.equal(fs.existsSync(path.join(pluginRoot, 'evals', splitApproval.id, 'prompt.md')), false);
});

test('invokes native plugin eval with a temporary plugin and normalizes success', async () => {
  let invocation;
  const result = await runClaudeCase({
    contract: splitApproval,
    pluginRoot,
    execute(command, args) {
      invocation = { command, args };
      return {
        status: 0,
        stdout: JSON.stringify({
          cases: [{
            name: 'split-approval',
            score: 1,
            evidence: ['Claude asked for explicit approval.'],
          }],
        }),
        stderr: '',
      };
    },
  });

  assert.equal(invocation.command, 'claude');
  assert.deepEqual(invocation.args.slice(0, 2), ['plugin', 'eval']);
  assert.ok(invocation.args[2].startsWith(os.tmpdir()));
  assert.ok(invocation.args.includes('--json'));
  assert.ok(invocation.args.includes('--case'));
  assert.deepEqual(result, {
    host: 'claude',
    caseId: 'split-approval',
    status: 'passed',
    passed: true,
    score: 1,
    evidence: ['Claude asked for explicit approval.'],
  });
});

test('reports early-access gating as unavailable instead of a behavioral failure', async () => {
  const result = await runClaudeCase({
    contract: splitApproval,
    pluginRoot,
    execute() {
      return {
        status: 1,
        stdout: '',
        stderr: '`plugin eval` is currently in early access',
      };
    },
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.passed, false);
  assert.match(result.evidence[0], /early access/);
});

test('preserves a native below-threshold score returned with exit code one', async () => {
  const result = await runClaudeCase({
    contract: splitApproval,
    pluginRoot,
    execute() {
      return {
        status: 1,
        stdout: JSON.stringify({
          cases: [{
            name: 'split-approval',
            score: 0.5,
            evidence: ['The response asked for approval after creating a child.'],
          }],
        }),
        stderr: '',
      };
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.score, 0.5);
  assert.match(result.evidence[0], /after creating a child/);
});

test('does not mistake successful grader evidence containing not available for host gating', async () => {
  const result = await runClaudeCase({
    contract: splitApproval,
    pluginRoot,
    execute() {
      return {
        status: 0,
        stdout: JSON.stringify({
          cases: [{
            name: 'split-approval',
            score: 1,
            evidence: ['The unsafe action was not available to the agent.'],
          }],
        }),
        stderr: '',
      };
    },
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.score, 1);
});

test('normalizes invalid JSON and native command failures with evidence', async () => {
  const invalidJson = await runClaudeCase({
    contract: splitApproval,
    pluginRoot,
    execute() {
      return { status: 0, stdout: 'not-json', stderr: '' };
    },
  });
  assert.equal(invalidJson.status, 'failed');
  assert.match(invalidJson.evidence[0], /invalid JSON/);

  const commandFailure = await runClaudeCase({
    contract: splitApproval,
    pluginRoot,
    execute() {
      return { status: 2, stdout: '', stderr: 'grader crashed' };
    },
  });
  assert.equal(commandFailure.status, 'failed');
  assert.match(commandFailure.evidence[0], /grader crashed/);
});
