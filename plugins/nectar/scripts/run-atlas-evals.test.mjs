import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  runAtlasEvaluation,
  runAtlasEvaluationSuite,
} from './run-atlas-evals.mjs';

test('runs and publishes a reproducible Atlas-on versus baseline fixture', async (t) => {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-atlas-eval-output-'));
  const outputFile = path.join(outputDirectory, 'report.json');
  t.after(() => fs.rmSync(outputDirectory, { recursive: true, force: true }));

  const report = await runAtlasEvaluation({ fileCount: 120, outputFile });

  assert.equal(report.schema, 1);
  assert.equal(report.caseId, 'synthetic-typescript-120');
  assert.equal(report.baseline.succeeded, true);
  assert.equal(report.atlas.succeeded, true);
  assert.equal(report.atlas.recallAtK, 1);
  assert.equal(report.comparison.sameTaskOutcome, true);
  assert.equal(report.baseline.method, 'git-grep-and-direct-source');
  assert.equal(report.baseline.filesRead, report.expectedPaths.length);
  assert.equal(
    report.baseline.sourceVerificationCharacters,
    report.atlas.sourceVerificationCharacters,
  );
  assert.ok(report.atlas.contextCharacters > report.atlas.packetCharacters);
  assert.ok(Number.isFinite(report.comparison.estimatedContextTokensSaved));
  assert.equal(report.tokenEstimation.approximate, true);
  assert.equal(report.fixture.eligibleIndexedFiles, report.fixture.files);
  assert.equal(report.fixture.excludedFiles, 0);
  assert.ok(report.indexing.coldMs >= 0);
  assert.ok(report.indexing.incrementalMs >= 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(outputFile, 'utf8')), report);
});

test('publishes an honest small and large scale profile', async () => {
  const report = await runAtlasEvaluationSuite({
    fileCounts: [120, 240],
  });

  assert.equal(report.schema, 1);
  assert.equal(report.kind, 'atlas-scale-suite');
  assert.deepEqual(report.cases.map((entry) => entry.fixture.files), [122, 242]);
  assert.equal(report.summary.sameTaskOutcome, true);
  assert.equal(report.summary.fullRecall, true);
  assert.equal(report.broadCase.fixture.profile, 'broad-service');
  assert.equal(report.broadCase.comparison.sameTaskOutcome, true);
  assert.equal(report.broadCase.atlas.truncated, false);
  assert.equal(report.broadCase.fixture.metadataOnlyFiles, 240);
  assert.ok(
    report.broadCase.baseline.matchedFiles
      > report.broadCase.atlas.filesRead,
  );
  assert.ok(report.broadCase.comparison.estimatedContextTokensSaved > 0);
  assert.ok(Number.isFinite(
    report.summary.smallProject.estimatedContextTokensSaved,
  ));
  assert.ok(Number.isFinite(
    report.summary.largeProject.estimatedContextTokensSaved,
  ));
  assert.ok(
    report.summary.broadLargeProject.estimatedContextTokensSaved > 0,
  );
  assert.equal(
    report.summary.largeProject.firstRelevantMsSaved,
    report.cases[1].comparison.firstRelevantMsSaved,
  );
});
