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

const cleanReview = '# Review\n\n## Clean pass\n\nClean pass: zero blocking code defects remain.\n\nBlocking: 0\nDeferred: 3\n';

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

test('accepts the exact stronger legacy zero-confirmed clean marker', (t) => {
  const root = fixture(t, {
    'docs/work/2026-07-16-search/design.md': '# Search — Design\n',
    'docs/work/2026-07-16-search/plan.md': '## Wave 1\n- [x] T1: Search — done when: green.\n',
    'docs/work/2026-07-16-search/review.md': '# Review\n\n## Clean pass\n\nCorrectness and tests were rechecked. No CONFIRMED findings remain.\n',
  });

  assert.equal(
    topic(inspectWorkTree(root), 'docs/work/2026-07-16-search').status,
    'done',
  );
});

test('uses the final blocking count when a resumed review retains older summaries', (t) => {
  const root = fixture(t, {
    'docs/work/2026-07-16-search/design.md': '# Search — Design\n',
    'docs/work/2026-07-16-search/plan.md': '## Wave 1\n- [x] T1: Search — done when: green.\n',
    'docs/work/2026-07-16-search/review.md': '# Review\n\n## Clean pass\n\nClean pass: zero blocking code defects remain.\n\nBlocking: 0\n\n## Resumed review\n\nBlocking: 1\n',
  });

  assert.equal(
    topic(inspectWorkTree(root), 'docs/work/2026-07-16-search').status,
    'in review',
  );
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
