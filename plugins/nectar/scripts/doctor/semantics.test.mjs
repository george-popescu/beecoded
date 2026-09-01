import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { inspectWorkTree } from './inspect.mjs';

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-doctor-semantics-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

function topic(report, topicPath) {
  return report.topics.find((candidate) => candidate.path === topicPath);
}

function codes(report) {
  return report.diagnostics.map((diagnostic) => diagnostic.code);
}

const cleanReview = '# Review\n\n## Clean pass\n\nBlocking: 0\nDeferred: 3\nClean pass: zero blocking code defects remain.\n';

test('detects duplicate normalized slugs across dated, child, and legacy topics', (t) => {
  const root = fixture(t, {
    'docs/work/2026-07-16-checkout/design.md': '# Checkout — Design\n',
    'docs/work/checkout/design.md': '# Old Checkout — Design\n',
    'docs/work/2026-07-16-platform/design.md': '# Platform — Design\n\n## Topics\n1. `01-checkout/` — checkout; depends on: none\n',
    'docs/work/2026-07-16-platform/01-checkout/design.md': '# Platform Checkout — Design\n',
  });

  const duplicates = inspectWorkTree(root).diagnostics
    .filter((diagnostic) => diagnostic.code === 'DUPLICATE_TOPIC');

  assert.ok(duplicates.length >= 2);
  assert.ok(duplicates.some((diagnostic) => diagnostic.evidence.includes('docs/work/checkout')));
  assert.ok(duplicates.some((diagnostic) => diagnostic.evidence.includes('01-checkout')));
});

test('detects duplicate first design headings while leaving distinct topics alone', (t) => {
  const root = fixture(t, {
    'docs/work/2026-07-16-cart/design.md': '# Checkout Recovery — Design\n',
    'docs/work/2026-07-16-recovery/design.md': '# Checkout Recovery — Design\n',
    'docs/work/2026-07-16-search/design.md': '# Search Ranking — Design\n',
  });

  const report = inspectWorkTree(root);
  const duplicates = report.diagnostics.filter((diagnostic) => diagnostic.code === 'DUPLICATE_TOPIC');

  assert.equal(duplicates.length, 1);
  assert.match(duplicates[0].evidence, /cart/);
  assert.match(duplicates[0].evidence, /recovery/);
  assert.doesNotMatch(duplicates[0].evidence, /search/);
});

test('includes dated project parents in duplicate detection', (t) => {
  const root = fixture(t, {
    'docs/work/2026-07-16-checkout/design.md': '# Checkout Project — Design\n\n## Topics\n1. `01-domain/` — domain; depends on: none\n',
    'docs/work/2026-07-16-checkout/01-domain/design.md': '# Domain — Design\n',
    'docs/work/checkout/design.md': '# Legacy Checkout — Design\n',
  });

  const duplicates = inspectWorkTree(root).diagnostics
    .filter((diagnostic) => diagnostic.code === 'DUPLICATE_TOPIC');

  assert.equal(duplicates.length, 1);
  assert.match(duplicates[0].evidence, /2026-07-16-checkout/);
  assert.match(duplicates[0].evidence, /docs\/work\/checkout/);
});

test('derives direct, nested, legacy, and aggregate parent statuses', (t) => {
  const root = fixture(t, {
    'docs/work/2026-07-16-search/design.md': '# Search — Design\n',
    'docs/work/legacy-import/design.md': '# Import — Design\n',
    'docs/work/legacy-import/plan.md': '## Wave 1\n- [x] T1: Import — done when: green.\n  - files: `src/import.js`\n',
    'docs/work/2026-07-16-checkout/design.md': '# Checkout — Design\n\n## Topics\n1. `01-domain/` — domain; depends on: none\n2. `02-api/` — API; depends on: `01-domain/`\n',
    'docs/work/2026-07-16-checkout/01-domain/design.md': '# Domain — Design\n',
    'docs/work/2026-07-16-checkout/01-domain/plan.md': '## Wave 1\n- [x] T1: Domain — done when: green.\n  - files: `src/domain.js`\n',
    'docs/work/2026-07-16-checkout/01-domain/review.md': cleanReview,
    'docs/work/2026-07-16-checkout/02-api/design.md': '# API — Design\n',
    'docs/work/2026-07-16-checkout/02-api/plan.md': '## Wave 1\n- [ ] T1: API — done when: green.\n  - files: `src/api.js`\n',
  });

  const report = inspectWorkTree(root);

  assert.equal(topic(report, 'docs/work/2026-07-16-search').status, 'designed, needs plan');
  assert.equal(topic(report, 'docs/work/legacy-import').status, 'in review');
  assert.equal(topic(report, 'docs/work/2026-07-16-checkout/01-domain').status, 'done');
  assert.equal(topic(report, 'docs/work/2026-07-16-checkout/02-api').status, 'building');
  assert.equal(topic(report, 'docs/work/2026-07-16-checkout').status, 'building');
  assert.equal(topic(report, 'docs/work/2026-07-16-checkout').statusSource, '02-api');
});

test('reports review without plan, malformed plans, and otherwise impossible artifacts', (t) => {
  const root = fixture(t, {
    'docs/work/2026-07-16-review-only/design.md': '# Review Only — Design\n',
    'docs/work/2026-07-16-review-only/review.md': cleanReview,
    'docs/work/2026-07-16-bad-plan/design.md': '# Bad Plan — Design\n',
    'docs/work/2026-07-16-bad-plan/plan.md': '## Wave 1\nNo checkboxes here.\n',
    'docs/work/2026-07-16-no-design/plan.md': '## Wave 1\n- [ ] T1: Missing design.\n',
  });

  const reportCodes = codes(inspectWorkTree(root));

  assert.ok(reportCodes.includes('REVIEW_WITHOUT_PLAN'));
  assert.ok(reportCodes.includes('MALFORMED_PLAN'));
  assert.ok(reportCodes.includes('PLAN_WITHOUT_DESIGN'));
});

test('does not treat a review that merely says not a clean pass as done', (t) => {
  const root = fixture(t, {
    'docs/work/2026-07-16-search/design.md': '# Search — Design\n',
    'docs/work/2026-07-16-search/plan.md': '## Wave 1\n- [x] T1: Search — done when: green.\n  - files: `src/search.js`\n',
    'docs/work/2026-07-16-search/review.md': '# Review\n\nThis is not a clean pass because one finding remains.\n',
  });

  assert.equal(
    topic(inspectWorkTree(root), 'docs/work/2026-07-16-search').status,
    'in review',
  );
});

test('warns for completed historical dependency chains but blocks active premature progress', (t) => {
  const legacyReview = '# Review\n\n## Clean pass\n\nNo CONFIRMED findings remain.\n';
  const canonicalReview = '# Review\n\nBlocking: 0\nClean pass: zero blocking code defects remain.\n';
  const root = fixture(t, {
    'docs/work/2026-07-16-checkout/design.md': '# Checkout — Design\n\n## Topics\n1. `01-domain/` — domain; depends on: none\n2. `02-api/` — API; depends on: `01-domain/`\n3. `03-ui/` — UI; depends on: `01-domain/`\n',
    'docs/work/2026-07-16-checkout/01-domain/design.md': '# Domain — Design\n',
    'docs/work/2026-07-16-checkout/01-domain/plan.md': '## Wave 1\n- [x] T1: Domain — done when: green.\n',
    'docs/work/2026-07-16-checkout/01-domain/review.md': legacyReview,
    'docs/work/2026-07-16-checkout/02-api/design.md': '# API — Design\n',
    'docs/work/2026-07-16-checkout/02-api/plan.md': '## Wave 1\n- [x] T1: API — done when: green.\n',
    'docs/work/2026-07-16-checkout/02-api/review.md': canonicalReview,
    'docs/work/2026-07-16-checkout/03-ui/design.md': '# UI — Design\n',
    'docs/work/2026-07-16-checkout/03-ui/plan.md': '## Wave 1\n- [x] T1: Started — done when: green.\n- [ ] T2: Finish — done when: green.\n',
  });

  const report = inspectWorkTree(root);
  const historical = report.diagnostics.find((diagnostic) => (
    diagnostic.code === 'LEGACY_DEPENDENCY_HISTORY'
  ));
  const active = report.diagnostics.find((diagnostic) => (
    diagnostic.code === 'DEPENDENCY_PROGRESS_STARTED'
    && diagnostic.path.endsWith('/03-ui')
  ));

  assert.equal(historical?.severity, 'warning');
  assert.ok(historical?.path.endsWith('/02-api'));
  assert.equal(active?.severity, 'error');
});

test('gives a structurally invalid parent no actionable aggregate status', (t) => {
  const root = fixture(t, {
    'docs/work/2026-07-16-checkout/design.md': '# Checkout — Design\n\n## Topics\n1. `01-domain/` — domain; depends on: none\n2. `02-api/` — API; depends on: `01-domain/`\n',
    'docs/work/2026-07-16-checkout/01-domain/design.md': '# Domain — Design\n',
    'docs/work/2026-07-16-checkout/03-ui/design.md': '# UI — Design\n',
  });

  assert.equal(
    topic(inspectWorkTree(root), 'docs/work/2026-07-16-checkout').status,
    null,
  );
});

test('reports progress started before dependencies are done', (t) => {
  const root = fixture(t, {
    'docs/work/2026-07-16-checkout/design.md': '# Checkout — Design\n\n## Topics\n1. `01-domain/` — domain; depends on: none\n2. `02-api/` — API; depends on: `01-domain/`\n',
    'docs/work/2026-07-16-checkout/01-domain/design.md': '# Domain — Design\n',
    'docs/work/2026-07-16-checkout/02-api/design.md': '# API — Design\n',
    'docs/work/2026-07-16-checkout/02-api/plan.md': '## Wave 1\n- [x] T1: Started too early — done when: green.\n  - files: `src/api.js`\n- [ ] T2: Continue — done when: green.\n  - files: `src/api.js`\n',
  });

  const report = inspectWorkTree(root);
  const diagnostic = report.diagnostics.find(
    (candidate) => candidate.code === 'DEPENDENCY_PROGRESS_STARTED',
  );

  assert.ok(diagnostic);
  assert.match(diagnostic.path, /02-api/);
  assert.match(diagnostic.evidence, /01-domain/);
});

test('rejects symlinked design, plan, and review artifacts without disclosing targets', (t) => {
  const root = fixture(t, {
    'docs/work/2026-07-16-design-link/plan.md': '## Wave 1\n- [x] T1: Complete.\n',
    'docs/work/2026-07-16-plan-link/design.md': '# Plan Link — Design\n',
    'docs/work/2026-07-16-review-link/design.md': '# Review Link — Design\n',
    'docs/work/2026-07-16-review-link/plan.md': '## Wave 1\n- [x] T1: Complete.\n',
  });
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-doctor-external-artifacts-'));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  const externalFiles = {
    'design.md': '# External\n\n## Topics\nEXTERNAL_DESIGN_CONTENT_DO_NOT_DISCLOSE\n',
    'plan.md': 'EXTERNAL_PLAN_CONTENT_DO_NOT_DISCLOSE\n',
    'review.md': 'Blocking: 0\nClean pass: zero blocking code defects remain.\nEXTERNAL_REVIEW_CONTENT_DO_NOT_DISCLOSE\n',
  };
  for (const [name, content] of Object.entries(externalFiles)) {
    fs.writeFileSync(path.join(external, name), content);
  }
  fs.symlinkSync(
    path.join(external, 'design.md'),
    path.join(root, 'docs/work/2026-07-16-design-link/design.md'),
  );
  fs.symlinkSync(
    path.join(external, 'plan.md'),
    path.join(root, 'docs/work/2026-07-16-plan-link/plan.md'),
  );
  fs.symlinkSync(
    path.join(external, 'review.md'),
    path.join(root, 'docs/work/2026-07-16-review-link/review.md'),
  );

  const report = inspectWorkTree(root);
  const unsafePaths = report.diagnostics
    .filter((diagnostic) => diagnostic.code === 'UNSAFE_ARTIFACT')
    .map((diagnostic) => diagnostic.path)
    .sort();
  const serialized = JSON.stringify(report);

  assert.deepEqual(unsafePaths, [
    'docs/work/2026-07-16-design-link/design.md',
    'docs/work/2026-07-16-plan-link/plan.md',
    'docs/work/2026-07-16-review-link/review.md',
  ]);
  assert.doesNotMatch(serialized, /EXTERNAL_(?:DESIGN|PLAN|REVIEW)_CONTENT_DO_NOT_DISCLOSE/);
  assert.equal(serialized.includes(external), false);
  for (const topicPath of [
    'docs/work/2026-07-16-design-link',
    'docs/work/2026-07-16-plan-link',
    'docs/work/2026-07-16-review-link',
  ]) {
    assert.equal(topic(report, topicPath).status, null);
  }
});

test('rejects oversized artifacts before an unbounded Doctor read', (t) => {
  const root = fixture(t, {
    'docs/work/2026-07-16-oversized/design.md': Buffer.alloc(256 * 1024 + 1, 0x58),
  });

  const report = inspectWorkTree(root);
  const diagnostic = report.diagnostics.find((candidate) => (
    candidate.code === 'ARTIFACT_TOO_LARGE'
  ));

  assert.equal(diagnostic?.path, 'docs/work/2026-07-16-oversized/design.md');
  assert.equal(Object.hasOwn(diagnostic || {}, 'evidence'), false);
  assert.equal(topic(report, 'docs/work/2026-07-16-oversized').status, null);
});
