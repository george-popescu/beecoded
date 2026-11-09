import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { summarizeImpact, runImpact } from './run-impact.mjs';

const row = (variant, overrides = {}) => ({ scenario: 'rounding', repetition: 1, variant, status: 'passed', behaviorPassed: true,
  settings: { model: 'configured-model', model_reasoning_effort: 'high' }, actorElapsedMs: 100,
  commandCount: 4, usage: { output_tokens: 200 }, ...overrides });

test('impact pairs settings and reports slower candidates honestly without interpreting missing usage as zero', () => {
  const report = summarizeImpact([row('baseline'), row('nectar', { actorElapsedMs: 150, usage: null })]);
  assert.equal(report.status, 'paired-summary');
  const comparison = report.comparisons[0];
  assert.equal(comparison.pairedTrials, 1);
  assert.equal(comparison.elapsedMs.percentChange, 50);
  assert.equal(comparison.outputTokens.pairs, 0);
  assert.equal(comparison.outputTokens.candidateTotal, null);
  assert.equal(report.cost, null);
});

test('impact excludes mismatched settings, duplicates, unavailable and failed speedups', () => {
  const mismatch = summarizeImpact([row('baseline'), row('nectar', { settings: { model: 'different' } })]);
  assert.equal(mismatch.status, 'not-comparable');
  assert.equal(mismatch.comparisons[0].excluded.differentSettings, 1);
  assert.throws(() => summarizeImpact([row('baseline'), row('baseline'), row('nectar')]));
  const failed = summarizeImpact([row('baseline'), row('nectar', { status: 'failed', behaviorPassed: false, actorElapsedMs: 1 }), row('published', { status: 'unavailable', behaviorPassed: null })]);
  assert.equal(failed.unavailable, 1);
  const comparison = failed.comparisons.find(item => item.variant === 'nectar');
  assert.equal(comparison.correctness.candidatePassed, 0);
  assert.equal(comparison.elapsedMs.percentChange, null);
  const noSettings = summarizeImpact([row('baseline', { settings: {} }), row('nectar', { settings: {} })]);
  assert.equal(noSettings.comparisons[0].excluded.missingSettings, 1);
});

test('impact supports inspection results with the same pairing rules', () => {
  const input = ['baseline', 'skill'].map(variant => ({ caseId: 'inspection-code', repetition: 1, variant, host: 'codex', status: 'passed', passed: true,
    metrics: { actorMs: variant === 'skill' ? 80 : 100, commandCount: 2, usage: { output_tokens: 50 }, settings: { model: 'model' } } }));
  const comparison = summarizeImpact(input).comparisons[0];
  assert.equal(comparison.variant, 'skill');
  assert.equal(comparison.elapsedMs.percentChange, -20);
});

test('impact reads only an explicit bounded normal JSON file and otherwise makes no claims', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-impact-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'results.json');
  fs.writeFileSync(file, JSON.stringify([row('baseline'), row('nectar')]));
  assert.equal(runImpact({ argv: [] }).report.status, 'no-benchmark-selected');
  assert.equal(runImpact({ argv: ['--file', file, '--json'] }).exitCode, 0);
  const link = path.join(root, 'link.json');
  fs.symlinkSync(file, link);
  assert.equal(runImpact({ argv: ['--file', link] }).exitCode, 2);
  fs.writeFileSync(file, '{"secret":"NeverEchoBrokenJSON"');
  const malformed = runImpact({ argv: ['--file', file] });
  assert.equal(malformed.exitCode, 2);
  assert.ok(!malformed.output.includes('NeverEchoBrokenJSON'));
  fs.writeFileSync(file, JSON.stringify({ unrelated: true }));
  assert.equal(runImpact({ argv: ['--file', file] }).exitCode, 2);
  fs.writeFileSync(file, 'x'.repeat(8 * 1024 * 1024 + 1));
  assert.equal(runImpact({ argv: ['--file', file] }).exitCode, 2);
  assert.equal(runImpact({ argv: ['--file'] }).exitCode, 2);
});
