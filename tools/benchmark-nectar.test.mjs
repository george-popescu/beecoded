import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { benchmarkNectar, evaluateBenchmarkOutcome } from './benchmark-nectar.mjs';

test('outcome grading uses external behavior rather than requiring identical fixture tests', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-benchmark-outcome-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(root, 'test.mjs'), '// a legitimately extended test suite\n');
  const source = path.join(root, 'src/total.mjs');
  fs.writeFileSync(source, 'export const calculateTotal = items => Math.round((items.reduce((sum, item) => sum + item.price * item.quantity, 0) + Number.EPSILON) * 100) / 100;');
  assert.equal(evaluateBenchmarkOutcome(root, 'rounding').behaviorPassed, true);
  assert.equal(fs.existsSync(path.join(root, 'test-runs.log')), false);
  fs.writeFileSync(source, 'export const calculateTotal = () => 0;');
  assert.equal(evaluateBenchmarkOutcome(root, 'rounding').behaviorPassed, false);
});

test('an unavailable native actor stops the benchmark without grading untouched code as a product failure', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-benchmark-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let calls = 0;
  const results = await benchmarkNectar({
    temporaryRoot: root, report: () => {},
    execute: async () => {
      calls += 1;
      return { status: 1, error: null, stderr: '', stdout: JSON.stringify({ type: 'turn.failed', error: { message: 'client upgrade required' } }) };
    },
  });
  assert.equal(calls, 1);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'unavailable');
  assert.equal(results[0].behaviorPassed, null);
  assert.equal(results[0].actorError, 'client upgrade required');
  assert.equal(fs.existsSync(path.join(results[0].artifacts, 'project/test-runs.log')), false);
});
