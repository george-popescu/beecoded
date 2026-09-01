import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { inspectWorkTree } from './inspect.mjs';

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-doctor-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    if (content === null) {
      fs.mkdirSync(target, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
  }
  return root;
}

function parentDesign(entries) {
  return `# Checkout — Design

## Problem
Checkout needs work.

## Approach
Split it safely.

## Acceptance criteria
- [ ] Checkout works.

## Out of scope
- None.

## Topics
${entries.join('\n')}
`;
}

function codes(report) {
  return report.diagnostics.map((diagnostic) => diagnostic.code);
}

test('accepts a clean dated parent and a legacy flat topic', (t) => {
  const root = fixture(t, {
    'docs/work/2026-07-16-checkout/design.md': parentDesign([
      '1. `01-domain/` — domain; depends on: none',
      '2. `02-api/` — API; depends on: `01-domain/`',
    ]),
    'docs/work/2026-07-16-checkout/01-domain/design.md': '# Domain — Design\n',
    'docs/work/2026-07-16-checkout/02-api/design.md': '# API — Design\n',
    'docs/work/legacy-search/design.md': '# Legacy Search — Design\n',
  });

  const report = inspectWorkTree(root);

  assert.deepEqual(report.diagnostics, []);
  assert.deepEqual(
    report.topics.map((topic) => [topic.path, topic.kind]),
    [
      ['docs/work/2026-07-16-checkout', 'parent'],
      ['docs/work/2026-07-16-checkout/01-domain', 'nested'],
      ['docs/work/2026-07-16-checkout/02-api', 'nested'],
      ['docs/work/legacy-search', 'legacy'],
    ],
  );
});

test('diagnoses missing, stale, and differently ordered children', (t) => {
  const root = fixture(t, {
    'docs/work/2026-07-16-checkout/design.md': parentDesign([
      '1. `01-domain/` — domain; depends on: none',
      '2. `02-api/` — API; depends on: `01-domain/`',
    ]),
    'docs/work/2026-07-16-checkout/01-domain/design.md': '# Domain\n',
    'docs/work/2026-07-16-checkout/03-ui/design.md': '# UI\n',
  });

  const reportCodes = codes(inspectWorkTree(root));

  assert.ok(reportCodes.includes('MISSING_LISTED_CHILD'));
  assert.ok(reportCodes.includes('UNLISTED_CHILD'));
  assert.ok(reportCodes.includes('NON_CONTIGUOUS_CHILDREN'));
  assert.ok(reportCodes.includes('TOPIC_ORDER_MISMATCH'));
});

test('diagnoses mixed padding, gaps, and duplicate numeric prefixes', (t) => {
  const root = fixture(t, {
    'docs/work/2026-07-16-checkout/design.md': parentDesign([
      '1. `01-domain/` — domain; depends on: none',
      '2. `1-api/` — API; depends on: `01-domain/`',
      '3. `03-ui/` — UI; depends on: `01-domain/`',
      '4. `03-observability/` — observability; depends on: `01-domain/`',
    ]),
    'docs/work/2026-07-16-checkout/01-domain/design.md': '# Domain\n',
    'docs/work/2026-07-16-checkout/1-api/design.md': '# API\n',
    'docs/work/2026-07-16-checkout/03-ui/design.md': '# UI\n',
    'docs/work/2026-07-16-checkout/03-observability/design.md': '# Observability\n',
  });

  const reportCodes = codes(inspectWorkTree(root));

  assert.ok(reportCodes.includes('MIXED_CHILD_PADDING'));
  assert.ok(reportCodes.includes('DUPLICATE_CHILD_NUMBER'));
  assert.ok(reportCodes.includes('NON_CONTIGUOUS_CHILDREN'));
});

test('diagnoses invalid dependency targets, forward/self references, and cycles', (t) => {
  const root = fixture(t, {
    'docs/work/2026-07-16-checkout/design.md': parentDesign([
      '1. `01-domain/` — domain; depends on: `02-api/`',
      '2. `02-api/` — API; depends on: `01-domain/`',
      '3. `03-ui/` — UI; depends on: `03-ui/`, `99-missing/`',
    ]),
    'docs/work/2026-07-16-checkout/01-domain/design.md': '# Domain\n',
    'docs/work/2026-07-16-checkout/02-api/design.md': '# API\n',
    'docs/work/2026-07-16-checkout/03-ui/design.md': '# UI\n',
  });

  const reportCodes = codes(inspectWorkTree(root));

  assert.ok(reportCodes.includes('FORWARD_DEPENDENCY'));
  assert.ok(reportCodes.includes('SELF_DEPENDENCY'));
  assert.ok(reportCodes.includes('UNKNOWN_DEPENDENCY'));
  assert.ok(reportCodes.includes('DEPENDENCY_CYCLE'));
});

test('diagnoses malformed dated roots and unsupported nested directories', (t) => {
  const root = fixture(t, {
    'docs/work/2026-7-16-checkout/design.md': '# Malformed\n',
    'docs/work/2026-99-40-impossible/design.md': '# Impossible Date\n',
    'docs/work/2026-07-16-search/design.md': '# Search\n',
    'docs/work/2026-07-16-search/01-index/design.md': '# Index\n',
    'docs/work/2026-07-16-search/01-index/01-grandchild/design.md': '# Invalid\n',
  });

  const reportCodes = codes(inspectWorkTree(root));

  assert.ok(reportCodes.filter((code) => code === 'MALFORMED_DATED_ROOT').length >= 2);
  assert.ok(reportCodes.includes('PARENT_TOPICS_MISSING'));
  assert.ok(reportCodes.includes('UNSUPPORTED_NESTING'));
});

test('reports invalid dependency syntax instead of guessing', (t) => {
  const root = fixture(t, {
    'docs/work/2026-07-16-checkout/design.md': parentDesign([
      '1. `01-domain/` — domain; depends on: none',
      '2. `02-api/` — API; depends on: 01-domain',
    ]),
    'docs/work/2026-07-16-checkout/01-domain/design.md': '# Domain\n',
    'docs/work/2026-07-16-checkout/02-api/design.md': '# API\n',
  });

  assert.ok(codes(inspectWorkTree(root)).includes('INVALID_DEPENDENCY_SYNTAX'));
});

test('inspection does not change file contents or mtimes', async (t) => {
  const root = fixture(t, {
    'docs/work/2026-07-16-search/design.md': '# Search — Design\n',
  });
  const target = path.join(root, 'docs/work/2026-07-16-search/design.md');
  const before = {
    content: fs.readFileSync(target, 'utf8'),
    mtimeMs: fs.statSync(target).mtimeMs,
  };

  inspectWorkTree(root);

  const after = {
    content: fs.readFileSync(target, 'utf8'),
    mtimeMs: fs.statSync(target).mtimeMs,
  };
  assert.deepEqual(after, before);
});

test('rejects a symlinked docs/work root without reading its external contents', (t) => {
  const root = fixture(t, {
    'docs': null,
  });
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-doctor-external-work-'));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  fs.mkdirSync(path.join(external, '2026-07-16-private'), { recursive: true });
  fs.writeFileSync(
    path.join(external, '2026-07-16-private', 'design.md'),
    '# Private\n\n## Topics\nEXTERNAL_PRIVATE_CONTENT_DO_NOT_DISCLOSE\n',
  );
  fs.symlinkSync(external, path.join(root, 'docs', 'work'));

  const report = inspectWorkTree(root);
  const serialized = JSON.stringify(report);

  assert.ok(report.diagnostics.some((diagnostic) => (
    diagnostic.code === 'UNSAFE_WORK_ROOT' && diagnostic.path === 'docs/work'
  )));
  assert.deepEqual(report.topics, []);
  assert.doesNotMatch(serialized, /EXTERNAL_PRIVATE_CONTENT_DO_NOT_DISCLOSE/);
  assert.equal(serialized.includes(external), false);
});

test('rejects symlinked top-level and nested topics without traversing their targets', (t) => {
  const root = fixture(t, {
    'docs/work/2026-07-16-checkout/design.md': parentDesign([
      '1. `01-domain/` — domain; depends on: none',
    ]),
  });
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-doctor-external-topic-'));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(external, 'design.md'),
    '# External Topic\nEXTERNAL_TOPIC_CONTENT_DO_NOT_DISCLOSE\n',
  );
  fs.symlinkSync(external, path.join(root, 'docs/work/2026-07-15-external'));
  fs.symlinkSync(external, path.join(root, 'docs/work/2026-07-16-checkout/01-domain'));

  const report = inspectWorkTree(root);
  const unsafePaths = report.diagnostics
    .filter((diagnostic) => diagnostic.code === 'UNSAFE_TOPIC_PATH')
    .map((diagnostic) => diagnostic.path)
    .sort();
  const serialized = JSON.stringify(report);

  assert.deepEqual(unsafePaths, [
    'docs/work/2026-07-15-external',
    'docs/work/2026-07-16-checkout/01-domain',
  ]);
  assert.doesNotMatch(serialized, /EXTERNAL_TOPIC_CONTENT_DO_NOT_DISCLOSE/);
  assert.equal(serialized.includes(external), false);
});
