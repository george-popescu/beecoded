import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { evaluateTestOptimization } from './test-optimization.mjs';

const contract = JSON.parse(fs.readFileSync(new URL('../../evals/contracts/test-review-optimize.json', import.meta.url)));

test('external oracle accepts removing waits and rejects speed bought by skipping, weak assertions or early exit', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-test-optimization-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'test'));
  const original = contract.fixture.files['test/cache.test.mjs'];
  const optimized = original.replaceAll('await delay(250);', '');
  const check = (content) => {
    fs.writeFileSync(path.join(root, 'test/cache.test.mjs'), content);
    return evaluateTestOptimization(root, contract.fixture.files);
  };
  assert.equal(check(optimized).passed, true);
  assert.equal(check(optimized.replaceAll('test(', 'test.skip(')).passed, false);
  assert.equal(check(optimized.replace("assert.equal(read('item'), 7);", 'assert.ok(true);')).passed, false);
  assert.equal(check('process.exit(0);\n').passed, false);
});
