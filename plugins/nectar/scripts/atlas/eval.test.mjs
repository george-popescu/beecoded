import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasEvaluationReport, evaluateAtlasPacket } from './eval.mjs';

test('computes deterministic bounded retrieval metrics', () => {
  const packet = {
    state: 'ready',
    fallback: false,
    truncated: false,
    evidence: [
      { path: 'src/order.ts', line: 1 },
      { path: './src/helper.ts', line: 4 },
      { path: 'src/helper.ts', line: 8 },
    ],
  };
  const first = evaluateAtlasPacket({
    packet,
    expectedPaths: ['src/order.ts', 'src/missing.ts'],
    elapsedMs: 12,
    baselineFilesRead: 8,
    baselineContextCharacters: 10_000,
    incrementalRefreshMs: 7,
    firstRelevantMs: 3,
  });
  const second = evaluateAtlasPacket({
    packet,
    expectedPaths: ['src/order.ts', 'src/missing.ts'],
    elapsedMs: 12,
    baselineFilesRead: 8,
    baselineContextCharacters: 10_000,
    incrementalRefreshMs: 7,
    firstRelevantMs: 3,
  });

  assert.deepEqual(first, second);
  assert.equal(first.recallAtK, 0.5);
  assert.equal(first.firstRelevantMs, 3);
  assert.equal(first.evidenceCount, 3);
  assert.equal(first.estimatedFilesAvoided, 6);
  assert.equal(first.incrementalRefreshMs, 7);
  assert.ok(first.packetCharacters > 0);
  assert.equal(first.estimatedPacketTokens, Math.ceil(first.packetCharacters / 4));
});

test('reports fallback and no first relevant evidence without inventing recall', () => {
  const metrics = evaluateAtlasPacket({
    packet: {
      state: 'fallback',
      fallback: true,
      truncated: false,
      evidence: [],
    },
    expectedPaths: [],
    elapsedMs: 4,
    baselineFilesRead: 0,
    baselineContextCharacters: 0,
  });

  assert.equal(metrics.recallAtK, null);
  assert.equal(metrics.firstRelevantMs, null);
  assert.equal(metrics.fallback, true);
});

test('rejects invalid baselines so eval evidence cannot hide malformed runs', () => {
  assert.throws(
    () => evaluateAtlasPacket({
      packet: { evidence: [] },
      expectedPaths: [],
      elapsedMs: -1,
      baselineFilesRead: 0,
      baselineContextCharacters: 0,
    }),
    /elapsedMs/,
  );
});

test('publishes reproducible Atlas-on versus baseline evidence', () => {
  const report = createAtlasEvaluationReport({
    caseId: 'order-change',
    expectedPaths: ['src/order.ts', './src/order.test.ts', 'src/order.ts'],
    baseline: {
      succeeded: true,
      firstRelevantMs: 40,
      filesRead: 12,
      contextCharacters: 9_000,
    },
    atlas: {
      succeeded: true,
      elapsedMs: 9,
      firstRelevantMs: 4,
      filesRead: 3,
      contextCharacters: 2_000,
      incrementalRefreshMs: 5,
      packet: {
        state: 'ready',
        fallback: false,
        truncated: false,
        evidence: [
          { path: 'src/order.ts', line: 1 },
          { path: 'src/order.test.ts', line: 1 },
        ],
      },
    },
  });

  assert.deepEqual(report.expectedPaths, ['src/order.test.ts', 'src/order.ts']);
  assert.equal(report.atlas.recallAtK, 1);
  assert.deepEqual(report.tokenEstimation, {
    approximate: true,
    method: 'ceil(characters / 4)',
  });
  assert.equal(report.baseline.estimatedContextTokens, 2_250);
  assert.equal(report.atlas.estimatedContextTokens, 500);
  assert.deepEqual(report.comparison, {
    sameTaskOutcome: true,
    firstRelevantMsSaved: 36,
    filesReadSaved: 9,
    contextCharactersSaved: 7_000,
    estimatedContextTokensSaved: 1_750,
  });
});
