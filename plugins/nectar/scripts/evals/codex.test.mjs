import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  createCodexEvalWorkspace,
  runCodexCase,
} from './codex.mjs';
import { loadContracts } from './contracts.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(currentDirectory, '../..');
const contracts = loadContracts(path.join(pluginRoot, 'evals', 'contracts'));
const duplicateDetection = contracts.find((contract) => contract.id === 'duplicate-detection');
const reviewRiskClassification = contracts.find((contract) => (
  contract.id === 'review-risk-classification'
));
const planRiskClassification = contracts.find((contract) => (
  contract.id === 'plan-risk-classification'
));
const splitApproval = contracts.find((contract) => contract.id === 'split-approval');

const semanticFindingContract = {
  id: 'semantic-finding-unit',
  skill: 'nectar-review',
  fixture: { files: { 'src/example.js': 'export const value = 1;\n' } },
  prompt: 'Review src/example.js without editing it.',
  checks: [
    {
      type: 'findingMatches',
      where: 'src/example.js',
      class: 'CODE_DEFECT',
      severityIn: ['MEDIUM', 'HIGH', 'CRITICAL'],
      convergence: 'BLOCKING',
      requiredFields: [
        'Runtime path',
        'Reachability',
        'Exposure/preconditions',
        'Likelihood',
        'Exploitability',
        'Impact',
        'Solution opportunity',
        'Confidence',
        'Disposition',
      ],
    },
    { type: 'summaryCount', label: 'Blocking', value: 1 },
  ],
  graderCriteria: ['Return one complete structured blocker.'],
};

const fixtureIntegrityContract = {
  id: 'fixture-integrity-unit',
  skill: 'nectar-review',
  fixture: {
    files: {
      'src/example.js': 'export const value = 1;\n',
      'README.md': '# Fixture\n',
    },
  },
  prompt: 'Review without editing the fixture.',
  checks: [{ type: 'fixtureUnchanged' }],
  graderCriteria: ['The complete fixture remains unchanged.'],
};

test('stages the risk-classification fixture with the current review contract', (t) => {
  const workspace = createCodexEvalWorkspace({
    contract: reviewRiskClassification,
    pluginRoot,
  });
  t.after(workspace.cleanup);

  assert.ok(fs.existsSync(path.join(workspace.root, 'src/session-store.js')));
  assert.ok(fs.existsSync(path.join(workspace.root, 'test/profile.test.js')));
  assert.match(workspace.prompt, /# Review/);
  assert.match(workspace.prompt, /CODE_DEFECT/);
  assert.match(workspace.prompt, /provisional label.*untrusted/i);
  assert.doesNotMatch(workspace.prompt, /exactly `Blocking: 1`/i);
  assert.match(workspace.prompt, /do not edit/i);
});

test('risk fixture deterministically reproduces the concurrent lost update', async (t) => {
  const workspace = createCodexEvalWorkspace({
    contract: reviewRiskClassification,
    pluginRoot,
  });
  t.after(workspace.cleanup);

  const store = await import(`${pathToFileURL(path.join(workspace.root, 'src/session-store.js')).href}?fixture`);
  let releaseFirst;
  let releaseSecond;
  const first = new Promise((resolve) => { releaseFirst = resolve; });
  const second = new Promise((resolve) => { releaseSecond = resolve; });
  store.seedSession('s1', { theme: 'light', locale: 'en' });
  const theme = store.updateSession('s1', { theme: 'dark' }, first);
  const locale = store.updateSession('s1', { locale: 'ro' }, second);
  releaseFirst();
  releaseSecond();
  await Promise.all([theme, locale]);

  assert.deepEqual(store.readSession('s1'), { theme: 'light', locale: 'ro' });
  assert.notDeepEqual(store.readSession('s1'), { theme: 'dark', locale: 'ro' });
});

test('stages the plan-classification fixture without rewriting its draft', (t) => {
  const workspace = createCodexEvalWorkspace({
    contract: planRiskClassification,
    pluginRoot,
  });
  t.after(workspace.cleanup);

  assert.match(workspace.prompt, /# Plan/);
  assert.match(workspace.prompt, /Run only the Plan self-review section/);
  assert.match(
    fs.readFileSync(path.join(workspace.root, 'docs/work/2026-07-21-order-api/plan.md'), 'utf8'),
    /manual glance/,
  );
});

test('stages the fixture and current package skill in an isolated Codex prompt', (t) => {
  const workspace = createCodexEvalWorkspace({
    contract: duplicateDetection,
    pluginRoot,
  });
  t.after(workspace.cleanup);

  assert.ok(workspace.root.startsWith(os.tmpdir()));
  assert.ok(fs.existsSync(path.join(
    workspace.root,
    'docs/work/2026-07-15-checkout-rebuild/design.md',
  )));
  assert.match(workspace.prompt, /# Shape/);
  assert.match(workspace.prompt, /Duplicate check/);
  assert.match(workspace.prompt, /Let's build a checkout rebuild/);
  assert.match(workspace.prompt, /Return your normal user-facing answer/);
});

test('invokes codex exec and grades response plus workspace checks', async () => {
  let invocation;
  const result = await runCodexCase({
    contract: duplicateDetection,
    pluginRoot,
    execute(command, args, options) {
      invocation = { command, args, options };
      fs.writeFileSync(
        args[args.indexOf('--output-last-message') + 1],
        'Existing work: docs/work/2026-07-15-checkout-rebuild. Choose Continue existing work, Create a distinct feature, or Cancel.',
      );
      return { status: 0, stdout: '{"type":"turn.completed"}\n', stderr: '' };
    },
  });

  assert.equal(invocation.command, 'codex');
  assert.deepEqual(invocation.args.slice(0, 2), ['exec', '--ephemeral']);
  assert.ok(invocation.args.includes('--skip-git-repo-check'));
  assert.ok(invocation.args.includes('--output-last-message'));
  assert.match(invocation.options.input, /Duplicate check/);
  assert.equal(result.status, 'passed');
  assert.equal(result.score, 1);
  assert.ok(result.evidence.every((entry) => entry.startsWith('PASS')));
});

test('returns a failed normalized result with evidence for unmet checks', async () => {
  const result = await runCodexCase({
    contract: duplicateDetection,
    pluginRoot,
    execute(_command, args) {
      fs.writeFileSync(
        args[args.indexOf('--output-last-message') + 1],
        'I created a new checkout feature.',
      );
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  assert.equal(result.status, 'failed');
  assert.ok(result.score < 1);
  assert.ok(result.evidence.some((entry) => entry.startsWith('FAIL responseIncludes')));
});

test('passes a structured finding associated with its location and risk fields', async () => {
  const response = `### [MEDIUM] Reachable defect
- **Class:** CODE_DEFECT
- **Where:** src/example.js:1
- **Evidence:** \`value\` is incorrect for the live caller.
- **Runtime path:** public entry → example → incorrect value
- **Reachability:** REACHABLE — exported entry
- **Exposure/preconditions:** any caller reads the value
- **Likelihood:** COMMON — every call
- **Exploitability:** NOT_APPLICABLE — no adversary
- **Impact:** bounded incorrect response
- **Solution opportunity:** HIGH — local fix; no planned replacement
- **Confidence:** HIGH — direct evidence
- **Convergence:** BLOCKING
- **Disposition:** FIX_NOW

Blocking: 1`;
  const result = await runCodexCase({
    contract: semanticFindingContract,
    pluginRoot,
    execute(_command, args) {
      fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], response);
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.score, 1);
});

test('rejects a structured finding with meaningless one-character risk values', async () => {
  const response = `### [MEDIUM] Structured nonsense
- **Class:** CODE_DEFECT
- **Where:** src/example.js:1
- **Runtime path:** x
- **Reachability:** x
- **Exposure/preconditions:** x
- **Likelihood:** x
- **Exploitability:** x
- **Impact:** x
- **Solution opportunity:** x
- **Confidence:** x
- **Convergence:** BLOCKING
- **Disposition:** x

Blocking: 1`;
  const result = await runCodexCase({
    contract: semanticFindingContract,
    pluginRoot,
    execute(_command, args) {
      fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], response);
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  assert.equal(result.status, 'failed');
  assert.ok(result.score < 1);
  assert.ok(result.evidence.some((entry) => entry.startsWith('FAIL findingMatches')));
});

test('rejects repeated two-word filler across an otherwise valid structured finding', async () => {
  const response = `### [MEDIUM] Structured filler
- **Class:** CODE_DEFECT
- **Where:** src/example.js:1
- **Evidence:** foo bars
- **Runtime path:** foo bars
- **Reachability:** REACHABLE — foo bars
- **Exposure/preconditions:** foo bars
- **Likelihood:** COMMON — foo bars
- **Exploitability:** NOT_APPLICABLE — foo bars
- **Impact:** foo bars
- **Solution opportunity:** HIGH — foo bars
- **Confidence:** HIGH — foo bars
- **Convergence:** BLOCKING
- **Disposition:** FIX_NOW

Blocking: 1`;
  const result = await runCodexCase({
    contract: semanticFindingContract,
    pluginRoot,
    execute(_command, args) {
      fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], response);
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  assert.equal(result.status, 'failed');
  assert.ok(result.evidence.some((entry) => entry.startsWith('FAIL findingMatches')));
});

test('passes the whole-fixture invariant when execution is read-only', async () => {
  const result = await runCodexCase({
    contract: fixtureIntegrityContract,
    pluginRoot,
    execute(_command, args) {
      fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], 'No findings.');
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  assert.equal(result.status, 'passed');
});

test('fails the whole-fixture invariant on edits, additions, and deletions', async () => {
  for (const mutate of [
    (root) => fs.writeFileSync(path.join(root, 'src/example.js'), 'changed\n'),
    (root) => fs.writeFileSync(path.join(root, 'UNREQUESTED.md'), 'added\n'),
    (root) => fs.rmSync(path.join(root, 'README.md')),
  ]) {
    const result = await runCodexCase({
      contract: fixtureIntegrityContract,
      pluginRoot,
      execute(_command, args) {
        mutate(args[args.indexOf('--cd') + 1]);
        fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], 'No findings.');
        return { status: 0, stdout: '', stderr: '' };
      },
    });

    assert.equal(result.status, 'failed');
    assert.ok(result.evidence.some((entry) => entry.startsWith('FAIL fixtureUnchanged')));
  }
});

test('rejects a finding whose expected location is only a substring', async () => {
  const response = `### [MEDIUM] Wrong location boundary
- **Class:** CODE_DEFECT
- **Where:** prefix-src/example.js-suffix
- **Runtime path:** public entry → example → incorrect value
- **Reachability:** REACHABLE — exported entry
- **Exposure/preconditions:** any caller reads the value
- **Likelihood:** COMMON — every call
- **Exploitability:** NOT_APPLICABLE — no adversary
- **Impact:** bounded incorrect response
- **Solution opportunity:** HIGH — local fix; no planned replacement
- **Confidence:** HIGH — direct evidence
- **Convergence:** BLOCKING
- **Disposition:** FIX_NOW

Blocking: 1`;
  const result = await runCodexCase({
    contract: semanticFindingContract,
    pluginRoot,
    execute(_command, args) {
      fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], response);
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  assert.equal(result.status, 'failed');
  assert.ok(result.score < 1);
  assert.ok(result.evidence.some((entry) => entry.startsWith('FAIL findingMatches')));
});

test('rejects token salad without a structured location-to-class association', async () => {
  const result = await runCodexCase({
    contract: semanticFindingContract,
    pluginRoot,
    execute(_command, args) {
      fs.writeFileSync(
        args[args.indexOf('--output-last-message') + 1],
        'src/example.js CODE_DEFECT MEDIUM BLOCKING Runtime path Reachability Exposure/preconditions Likelihood Exploitability Impact Solution opportunity Confidence Disposition Blocking: 1',
      );
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  assert.equal(result.status, 'failed');
  assert.ok(result.evidence.some((entry) => entry.startsWith('FAIL findingMatches')));
});

test('fails split approval when any numbered child directory was created', async () => {
  const result = await runCodexCase({
    contract: splitApproval,
    pluginRoot,
    execute(_command, args) {
      const workspace = args[args.indexOf('--cd') + 1];
      fs.mkdirSync(
        path.join(workspace, 'docs/work/2026-07-16-checkout-rebuild/01-domain-rules'),
        { recursive: true },
      );
      fs.writeFileSync(
        args[args.indexOf('--output-last-message') + 1],
        'Approve split, Revise split, or Decline split?',
      );
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  assert.equal(result.status, 'failed');
  assert.ok(result.evidence.some((entry) => entry.startsWith('FAIL childDirectoriesAbsent')));
});

test('fails split approval when the protected parent directory was deleted', async () => {
  const result = await runCodexCase({
    contract: splitApproval,
    pluginRoot,
    execute(_command, args) {
      const workspace = args[args.indexOf('--cd') + 1];
      fs.rmSync(
        path.join(workspace, 'docs/work/2026-07-16-checkout-rebuild'),
        { recursive: true, force: true },
      );
      fs.writeFileSync(
        args[args.indexOf('--output-last-message') + 1],
        'Approve split, Revise split, or Decline split?',
      );
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  assert.equal(result.status, 'failed');
  assert.ok(result.evidence.some((entry) => (
    entry.includes('target-missing-or-not-directory')
  )));
});

test('rejects model-created symlinks instead of inspecting paths outside the workspace', async (t) => {
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-eval-external-'));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  fs.mkdirSync(path.join(external, 'private-entry'));

  const result = await runCodexCase({
    contract: splitApproval,
    pluginRoot,
    execute(_command, args) {
      const workspace = args[args.indexOf('--cd') + 1];
      const checkedParent = path.join(
        workspace,
        'docs/work/2026-07-16-checkout-rebuild',
      );
      fs.rmSync(checkedParent, { recursive: true, force: true });
      fs.symlinkSync(external, checkedParent);
      fs.writeFileSync(
        args[args.indexOf('--output-last-message') + 1],
        'Approve split, Revise split, or Decline split?',
      );
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  assert.equal(result.status, 'failed');
  assert.ok(result.evidence.some((entry) => entry.includes('symbolic links are not allowed')));
  assert.ok(result.evidence.every((entry) => !entry.includes('private-entry')));
});

test('rejects symlinked child entries that would otherwise bypass childDirectoriesAbsent', async (t) => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-eval-child-target-'));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const result = await runCodexCase({
    contract: splitApproval,
    pluginRoot,
    execute(_command, args) {
      const workspace = args[args.indexOf('--cd') + 1];
      fs.symlinkSync(
        target,
        path.join(workspace, 'docs/work/2026-07-16-checkout-rebuild/01-domain-rules'),
      );
      fs.writeFileSync(
        args[args.indexOf('--output-last-message') + 1],
        'Approve split, Revise split, or Decline split?',
      );
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  assert.equal(result.status, 'failed');
  assert.ok(result.evidence.some((entry) => entry.includes('unsafe symbolic child')));
});

test('rejects a symlinked response capture instead of reading an external message', async (t) => {
  const external = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-eval-message-')),
    'message.txt',
  );
  t.after(() => fs.rmSync(path.dirname(external), { recursive: true, force: true }));
  fs.writeFileSync(
    external,
    'Approve split, Revise split, or Decline split?',
  );

  const result = await runCodexCase({
    contract: splitApproval,
    pluginRoot,
    execute(_command, args) {
      const output = args[args.indexOf('--output-last-message') + 1];
      fs.rmSync(output);
      fs.symlinkSync(external, output);
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  assert.equal(result.status, 'failed');
  assert.match(result.evidence[0], /Unsafe Codex output capture/);
});

test('reports an unavailable Codex CLI separately from a failed behavior', async () => {
  const result = await runCodexCase({
    contract: duplicateDetection,
    pluginRoot,
    execute() {
      return {
        status: null,
        stdout: '',
        stderr: '',
        error: new Error('spawn codex ENOENT'),
      };
    },
  });

  assert.equal(result.status, 'unavailable');
  assert.match(result.evidence[0], /ENOENT/);
});

test('treats a non-ENOENT spawn error as an eval failure, not a missing host', async () => {
  const result = await runCodexCase({
    contract: duplicateDetection,
    pluginRoot,
    execute() {
      const error = new Error('stdout maxBuffer length exceeded');
      error.code = 'ENOBUFS';
      return {
        status: null,
        stdout: '',
        stderr: '',
        error,
      };
    },
  });

  assert.equal(result.status, 'failed');
  assert.match(result.evidence[0], /maxBuffer/);
});
