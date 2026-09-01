import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
const splitApproval = contracts.find((contract) => contract.id === 'split-approval');
const secretRedaction = contracts.find((contract) => contract.id === 'secret-redaction');
const semanticOnlySplitApproval = {
  ...splitApproval,
  id: 'split-approval-semantic-only',
  requireLocalChecks: false,
};

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
  assert.ok(prompt.includes(splitApproval.prompt));
  for (const content of Object.values(splitApproval.fixture.files)) {
    assert.ok(prompt.includes(content.trimEnd()));
  }
  for (const criterion of splitApproval.graderCriteria) {
    assert.ok(grader.includes(`- ${criterion}`));
  }
  for (const check of splitApproval.checks) {
    assert.ok(grader.includes(`- ${check.type} ${JSON.stringify(check)}`));
  }
  assert.ok(workspace.pluginRoot.startsWith(os.tmpdir()));
  assert.equal(fs.existsSync(path.join(pluginRoot, 'evals', splitApproval.id, 'prompt.md')), false);
});

test('marks native success unavailable when required final workspace is not exposed', async () => {
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
  assert.equal(result.host, 'claude');
  assert.equal(result.caseId, 'split-approval');
  assert.equal(result.status, 'unavailable');
  assert.equal(result.passed, false);
  assert.match(result.evidence[0], /final workspace.*not exposed/i);
});

test('redacts excluded values from Claude artifacts before an unavailable result persists', async () => {
  const result = await runClaudeCase({
    contract: secretRedaction,
    pluginRoot,
    execute() {
      return {
        status: 0,
        stdout: JSON.stringify({
          cases: [{
            name: secretRedaction.id,
            score: 1,
            response: 'Leaked SECRET_VALUE_DO_NOT_REPEAT in native output.',
            evidence: ['native semantic pass'],
          }],
        }),
        stderr: '',
      };
    },
  });

  assert.equal(result.status, 'unavailable');
  assert.doesNotMatch(result.artifacts.actorResponse, /SECRET_VALUE_DO_NOT_REPEAT/);
  assert.match(result.artifacts.actorResponse, /<redacted>/);
  assert.equal(
    result.artifacts.actorResponseSha256,
    crypto.createHash('sha256').update(result.artifacts.actorResponse).digest('hex'),
  );
});

test('does not grade the immutable definition fixture as native actor final state', async () => {
  const contract = {
    ...splitApproval,
    id: 'claude-combined-grade-unit',
    requireLocalChecks: true,
    budgets: { timeoutMs: 5000, claudeMaxCostUsd: 0.25 },
  };
  let invocationArgs;
  let invocationOptions;
  const result = await runClaudeCase({
    contract,
    pluginRoot,
    execute(_command, args, options) {
      invocationArgs = args;
      invocationOptions = options;
      const fixtureRoot = path.join(args[2], 'evals', contract.id, 'fixture');
      fs.mkdirSync(path.join(
        fixtureRoot,
        'docs/work/2026-07-16-checkout-rebuild/01-unsafe-child',
      ), { recursive: true });
      return {
        status: 0,
        stdout: JSON.stringify({ cases: [{ name: contract.id, score: 1, response: 'Approve split', evidence: ['semantic pass'] }] }),
        stderr: '',
      };
    },
  });
  assert.equal(result.status, 'unavailable');
  assert.match(result.evidence[0], /final workspace.*not exposed/i);
  assert.equal(invocationOptions.timeout, 5000);
  assert.deepEqual(
    invocationArgs.slice(invocationArgs.indexOf('--max-cost-usd'), invocationArgs.indexOf('--max-cost-usd') + 2),
    ['--max-cost-usd', '0.25'],
  );
});

test('normalizes a semantic-only native success without claiming local checks', async () => {
  const result = await runClaudeCase({
    contract: semanticOnlySplitApproval,
    pluginRoot,
    execute() {
      return {
        status: 0,
        stdout: JSON.stringify({ cases: [{ name: semanticOnlySplitApproval.id, score: 1, response: 'Approve split', evidence: ['semantic pass'] }] }),
        stderr: '',
      };
    },
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.metadata.deterministicScore, 1);
  assert.equal(result.metadata.semanticScore, 1);
});

test('rejects a partial numeric score when the Claude cost ceiling aborts', async () => {
  const result = await runClaudeCase({
    contract: semanticOnlySplitApproval,
    pluginRoot,
    execute() {
      return {
        status: 2,
        stdout: JSON.stringify({ cases: [{ name: semanticOnlySplitApproval.id, score: 1, evidence: ['A required capability was not available during the partial run.'] }] }),
        stderr: 'maximum cost reached',
      };
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.passed, false);
  assert.match(result.evidence[0], /cost ceiling|partial/i);
});

test('reports early-access gating as unavailable instead of a behavioral failure', async () => {
  const result = await runClaudeCase({
    contract: semanticOnlySplitApproval,
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
    contract: semanticOnlySplitApproval,
    pluginRoot,
    execute() {
      return {
        status: 1,
        stdout: JSON.stringify({
          cases: [{
            name: semanticOnlySplitApproval.id,
            score: 0.5,
            evidence: ['The requested safe path was not available because the response created a child.'],
          }],
        }),
        stderr: '',
      };
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.score, 0.5);
  assert.match(result.evidence[0], /not available.*created a child/);
});

test('normalizes a scored abnormal Claude exit without throwing', async () => {
  const result = await runClaudeCase({
    contract: semanticOnlySplitApproval,
    pluginRoot,
    execute() {
      return {
        status: 3,
        stdout: JSON.stringify({
          cases: [{
            name: semanticOnlySplitApproval.id,
            score: 0.5,
            evidence: ['partial native evidence'],
          }],
        }),
        stderr: 'native process aborted after partial grading',
      };
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.score, 0.5);
  assert.match(result.evidence.join('\n'), /aborted after partial grading/i);
});

test('does not mistake successful grader evidence containing not available for host gating', async () => {
  const result = await runClaudeCase({
    contract: semanticOnlySplitApproval,
    pluginRoot,
    execute() {
      return {
        status: 0,
        stdout: JSON.stringify({
          cases: [{
            name: semanticOnlySplitApproval.id,
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
