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
  fs.writeFileSync(source, 'process.exit(0); export const calculateTotal = () => 0;');
  assert.equal(evaluateBenchmarkOutcome(root, 'rounding').behaviorPassed, false);
  fs.writeFileSync(source, 'import fs from "node:fs"; export const calculateTotal = () => fs.readFileSync("/etc/hosts");');
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

test('Honey has a baseline and product correctness does not depend on Doctor formatting', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-honey-comparator-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prompts = [];
  const homes = [];
  const results = await benchmarkNectar({
    temporaryRoot: root, scenarios: ['honey'], report: () => {},
    execute: async (_binary, args, options) => {
      prompts.push(args.at(-1));
      homes.push(options.env.HOME);
      fs.writeFileSync(path.join(options.cwd, 'src/cart.mjs'), `export function quote(items, vip = false) {
        const subtotalCents = items.reduce((s, i) => s + i.priceCents * i.quantity, 0);
        const discountCents = vip ? Math.round(subtotalCents * 0.1) : 0;
        const shippingCents = items.length && subtotalCents - discountCents < 10000 ? 500 : 0;
        return {subtotalCents,discountCents,shippingCents,totalCents:subtotalCents-discountCents+shippingCents};
      }`);
      return { status: 0, error: null, stdout: '', stderr: '' };
    },
  });
  assert.deepEqual(results.map((r) => r.variant), ['baseline', 'nectar']);
  assert.equal(prompts[0], prompts[1]);
  assert.ok(results.every((r) => r.status === 'passed'));
  assert.ok(results.every((r) => r.topicStatus !== 'done'));
  assert.ok(homes.every((home) => !fs.existsSync(home)));
});
