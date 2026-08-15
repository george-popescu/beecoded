import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { normalizeResult } from './evals/results.mjs';
import { evalExitCode, parseEvalArguments, runPluginEvals } from './run-plugin-evals.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('parses host, product, case, output, concurrency, and dry-run options', () => {
  assert.deepEqual(parseEvalArguments([
    '--all', '--product', 'nectar', '--case=split-*', '--output-dir', 'tmp/results',
    '--concurrency', '2', '--dry-run',
  ]), {
    hosts: ['claude', 'codex'],
    products: ['nectar'],
    casePatterns: ['split-*'],
    outputDir: 'tmp/results',
    concurrency: 2,
    dryRun: true,
  });
});

test('dry-run lists product-host-case jobs without invoking either host', async () => {
  let invoked = false;
  const outcome = await runPluginEvals({
    repoRoot,
    options: parseEvalArguments(['--all', '--product', 'nectar', '--case', 'split-approval', '--dry-run']),
    runners: {
      claude: async () => { invoked = true; },
      codex: async () => { invoked = true; },
    },
  });

  assert.equal(invoked, false);
  assert.match(outcome.output, /claude:nectar:split-approval/);
  assert.match(outcome.output, /codex:nectar:split-approval/);
  assert.equal(outcome.aggregate, null);
});

test('runs selected jobs and persists one normalized aggregate', async (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-eval-results-'));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const calls = [];
  const outcome = await runPluginEvals({
    repoRoot,
    options: parseEvalArguments([
      '--all', '--product', 'nectar', '--case', 'split-approval', '--output-dir', outputDir,
    ]),
    runners: {
      claude: async ({ product, contract }) => {
        calls.push(`claude:${product}:${contract.id}`);
        return normalizeResult({ product, host: 'claude', caseId: contract.id, passed: true, score: 1, evidence: 'ok' });
      },
      codex: async ({ product, contract }) => {
        calls.push(`codex:${product}:${contract.id}`);
        return normalizeResult({ product, host: 'codex', caseId: contract.id, passed: true, score: 1, evidence: 'ok' });
      },
    },
  });

  assert.deepEqual(calls, ['claude:nectar:split-approval', 'codex:nectar:split-approval']);
  assert.equal(outcome.aggregate.passed, 2);
  const files = fs.readdirSync(outputDir);
  assert.equal(files.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outputDir, files[0]), 'utf8')).passed, 2);
});

test('uses a distinct nonzero exit when any requested host is unavailable', () => {
  assert.equal(evalExitCode({ failed: 1, unavailable: 0 }), 1);
  assert.equal(evalExitCode({ failed: 0, unavailable: 1 }), 2);
  assert.equal(evalExitCode({ failed: 0, unavailable: 0 }), 0);
});
