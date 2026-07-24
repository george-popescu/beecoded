import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  parseEvalArguments,
  runEvalSuite,
} from '../run-behavioral-evals.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(currentDirectory, '../..');

test('parses host, case, output, and dry-run options', () => {
  assert.deepEqual(
    parseEvalArguments([
      '--all',
      '--case',
      'split-*',
      '--case=artifact-recovery',
      '--output-dir',
      'tmp/results',
      '--concurrency=3',
      '--dry-run',
    ]),
    {
      hosts: ['claude', 'codex'],
      explicitHosts: true,
      casePatterns: ['split-*', 'artifact-recovery'],
      outputDirectory: 'tmp/results',
      concurrency: 3,
      dryRun: true,
      help: false,
    },
  );
  assert.throws(() => parseEvalArguments(['--wat']), /Unknown argument/);
  assert.throws(() => parseEvalArguments(['--concurrency', '0']), /integer from 1 to 8/);
  assert.throws(() => parseEvalArguments(['--concurrency=9']), /integer from 1 to 8/);
});

test('filters cases, selects available hosts, and persists normalized aggregate results', async (t) => {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-eval-output-'));
  t.after(() => fs.rmSync(outputDirectory, { recursive: true, force: true }));
  const calls = [];

  const outcome = await runEvalSuite({
    pluginRoot,
    options: parseEvalArguments([
      '--all',
      '--case',
      'split-approval',
      '--output-dir',
      outputDirectory,
    ]),
    commandExists: () => true,
    hostRunners: {
      claude: async ({ contract }) => {
        calls.push(`claude:${contract.id}`);
        return {
          host: 'claude',
          caseId: contract.id,
          status: 'passed',
          passed: true,
          score: 1,
          evidence: ['native pass'],
        };
      },
      codex: async ({ contract }) => {
        calls.push(`codex:${contract.id}`);
        return {
          host: 'codex',
          caseId: contract.id,
          status: 'passed',
          passed: true,
          score: 1,
          evidence: ['deterministic pass'],
        };
      },
    },
  });

  assert.deepEqual(calls, ['claude:split-approval', 'codex:split-approval']);
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.aggregate.passed, 2);
  const persisted = JSON.parse(fs.readFileSync(
    path.join(outputDirectory, 'aggregate-result.json'),
    'utf8',
  ));
  assert.equal(persisted.total, 2);
});

test('returns non-zero for failed and unavailable requested hosts', async () => {
  const failed = await runEvalSuite({
    pluginRoot,
    options: parseEvalArguments(['--codex', '--case', 'split-approval']),
    commandExists: () => true,
    hostRunners: {
      codex: async ({ contract }) => ({
        host: 'codex',
        caseId: contract.id,
        status: 'failed',
        passed: false,
        score: 0,
        evidence: ['failed check'],
      }),
    },
  });
  assert.equal(failed.exitCode, 1);

  const unavailable = await runEvalSuite({
    pluginRoot,
    options: parseEvalArguments(['--claude', '--case', 'split-approval']),
    commandExists: () => false,
  });
  assert.equal(unavailable.exitCode, 2);
  assert.equal(unavailable.aggregate.unavailable, 1);
});

test('dry-run lists selected cases without invoking hosts or writing output', async () => {
  let invoked = false;
  const outcome = await runEvalSuite({
    pluginRoot,
    options: parseEvalArguments(['--all', '--case', '*numbering', '--dry-run']),
    commandExists: () => true,
    hostRunners: {
      claude: async () => { invoked = true; },
      codex: async () => { invoked = true; },
    },
  });

  assert.equal(invoked, false);
  assert.equal(outcome.exitCode, 0);
  assert.match(outcome.output, /claude: contiguous-numbering/);
  assert.match(outcome.output, /codex: contiguous-numbering/);
});

test('runs model jobs with bounded concurrency and preserves deterministic result order', async () => {
  let active = 0;
  let maximumActive = 0;
  const expected = [
    'artifact-recovery',
    'atlas-workflow-discipline',
    'contiguous-numbering',
    'dependency-readiness',
    'duplicate-detection',
    'plan-risk-classification',
    'review-risk-classification',
    'split-approval',
  ];
  const outcome = await runEvalSuite({
    pluginRoot,
    options: parseEvalArguments(['--codex', '--case', '*', '--concurrency', '2']),
    commandExists: () => true,
    hostRunners: {
      codex: async ({ contract }) => {
        active++;
        maximumActive = Math.max(maximumActive, active);
        const delay = (expected.length - expected.indexOf(contract.id)) * 3;
        await new Promise((resolve) => setTimeout(resolve, delay));
        active--;
        return {
          host: 'codex',
          caseId: contract.id,
          status: 'passed',
          passed: true,
          score: 1,
          evidence: ['pass'],
        };
      },
    },
  });

  assert.equal(maximumActive, 2);
  assert.deepEqual(outcome.aggregate.results.map((result) => result.caseId), expected);
});
