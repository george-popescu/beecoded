import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePlanState } from './plan-state.mjs';

function plan({ tasks = '- [x] T1: Ship search.', verification = 'Status: pending\nEvidence:', suffix = '' } = {}) {
  return `Workflow: nectar-slim-v1\n\n## Wave 1\n${tasks}\n\n## Verification\n${verification}\n${suffix}`;
}

test('keeps unversioned plans on their legacy interpretation', () => {
  assert.deepEqual(parsePlanState('## Wave 1\n- [x] T1: Existing work.\n'), { workflow: 'legacy' });
});

test('accepts many waves and tasks with partial implementation progress', () => {
  const tasks = Array.from({ length: 600 }, (_, index) => (
    `${index % 30 === 0 ? `## Wave ${index / 30 + 1}\n` : ''}- [${index < 47 ? 'x' : ' '}] T${index + 1}: Deliver behavior ${index + 1}.`
  )).join('\n');
  const result = parsePlanState(plan({ tasks }));
  assert.equal(result.error, undefined);
  assert.equal(result.checkedTasks, 47);
  assert.equal(result.uncheckedTasks, 553);
  assert.equal(result.verification.status, 'pending');
});

test('requires explicit final evidence before accepting a verification pass', () => {
  const pending = parsePlanState('Workflow: nectar-slim-v1\n- [x] T1: Complete implementation.\n');
  assert.equal(pending.verification.status, 'pending');
  assert.ok(parsePlanState(plan({ verification: 'Status: passed\nEvidence:' })).error);
  const passed = parsePlanState(plan({ verification: 'Status: passed\nEvidence: node --test test/search.mjs: 4 passed, 0 failed.' }));
  assert.equal(passed.error, undefined);
  assert.equal(passed.verification.status, 'passed');
  assert.equal(passed.verification.evidence, 'node --test test/search.mjs: 4 passed, 0 failed.');
  assert.equal(parsePlanState(plan({ verification: 'Status: failed\nEvidence: search returns insertion order.' })).verification.status, 'failed');
});

test('ignores example checkboxes and verification results inside Markdown fences', () => {
  for (const fence of ['```', '````', '~~~', '~~~~']) {
    const result = parsePlanState(plan({
      tasks: `- [ ] T1: Real task.\n${fence}md\n- [x] T2: Example only.\n${fence}`,
      verification: `${fence}text\nStatus: passed\nEvidence: example\n${fence}\nStatus: pending\nEvidence:`,
    }));
    assert.equal(result.error, undefined, fence);
    assert.equal(result.checkedTasks, 0, fence);
    assert.equal(result.uncheckedTasks, 1, fence);
    assert.equal(result.verification.status, 'pending', fence);
  }
});

test('rejects conflicting state, unfinished work marked verified and malformed task identities', () => {
  for (const value of [
    plan({ tasks: '- [ ] T1: Pending.', verification: 'Status: passed\nEvidence: stale result' }),
    plan({ tasks: '- [x] T1: First.\n- [x] T1: Duplicate.' }),
    plan({ tasks: '- [x] Missing task ID.' }),
    plan({ verification: 'Status: pending\nStatus: passed\nEvidence: ambiguous' }),
    plan({ verification: 'Status: green\nEvidence: unknown status' }),
    plan({ suffix: '## Verification\nStatus: passed\nEvidence: duplicate block' }),
    plan({ suffix: '```text\nunclosed' }),
    plan().replace('nectar-slim-v1', 'nectar-slim-v99'),
    `Workflow: nectar-slim-v1\n${plan()}`,
  ]) assert.ok(parsePlanState(value).error, value);
});
