import assert from 'node:assert/strict';
import test from 'node:test';

import { aggregateResults, normalizeResult } from './results.mjs';

test('normalizes pass, fail, and unavailable host results', () => {
  assert.deepEqual(normalizeResult({
    product: 'code-audit',
    host: 'codex',
    caseId: 'clean-repository',
    passed: true,
    score: 1,
    evidence: 'all checks passed',
  }), {
    product: 'code-audit',
    host: 'codex',
    caseId: 'clean-repository',
    status: 'passed',
    passed: true,
    score: 1,
    evidence: ['all checks passed'],
  });

  assert.throws(() => normalizeResult({
    product: 'code-audit',
    host: 'browser',
    caseId: 'x',
    passed: false,
    score: 0,
    evidence: 'bad host',
  }), /host must be claude or codex/);
});

test('aggregates normalized results without scoring unavailable hosts', () => {
  const results = [
    normalizeResult({ product: 'code-audit', host: 'codex', caseId: 'a', passed: true, score: 1, evidence: 'ok' }),
    normalizeResult({ product: 'code-audit', host: 'claude', caseId: 'a', passed: false, score: 0, evidence: 'missing', status: 'unavailable' }),
  ];

  assert.deepEqual(aggregateResults(results), {
    passed: 1,
    failed: 0,
    unavailable: 1,
    total: 2,
    score: 1,
    results,
  });
});
