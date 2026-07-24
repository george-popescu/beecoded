import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { indexRepository } from './indexer.mjs';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function write(root, relativePath, content) {
  const destination = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content);
}

function fixture(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-atlas-retrieval-'));
  const root = path.join(parent, 'repository');
  const cacheRoot = path.join(parent, 'cache');
  fs.mkdirSync(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'atlas@example.test']);
  git(root, ['config', 'user.name', 'Atlas Test']);
  write(root, 'src/service.ts', [
    'export class AlphaService {',
    '  run() { return "needle-value"; }',
    '}',
    'export function helper() { return new AlphaService().run(); }',
    '',
  ].join('\n'));
  write(root, 'src/service.test.ts', [
    'import { AlphaService } from "./service";',
    'export function testAlpha() { return new AlphaService().run(); }',
    '',
  ].join('\n'));
  write(root, 'README.md', '# Example\n\nneedle-value documentation\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'fixture']);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { parent, root, cacheRoot };
}

async function retrievalModule() {
  return import('./retrieval-store.mjs');
}

test('opening an absent Atlas index returns fallback without creating cache state', async (t) => {
  const { root, cacheRoot } = fixture(t);
  const { openAtlasRetrieval } = await retrievalModule();

  const before = fs.existsSync(cacheRoot);
  const retrieval = openAtlasRetrieval(root, { cacheRoot });

  assert.equal(before, false);
  assert.deepEqual(retrieval, {
    state: 'fallback',
    code: 'ATLAS_INDEX_ABSENT',
    reason: 'Atlas index does not exist for this repository',
  });
  assert.equal(fs.existsSync(cacheRoot), false);
});

test('reads exact paths, symbols, graph edges, tests, and escaped FTS evidence', async (t) => {
  const { root, cacheRoot } = fixture(t);
  await indexRepository(root, { cacheRoot });
  const { openAtlasRetrieval } = await retrievalModule();

  const retrieval = openAtlasRetrieval(root, { cacheRoot });
  t.after(() => retrieval.close());

  assert.equal(retrieval.state, 'ready');
  assert.equal(retrieval.freshness.state, 'fresh');
  assert.equal(retrieval.findPaths('src/service.ts')[0].path, 'src/service.ts');

  const exact = retrieval.findSymbols('AlphaService');
  assert.equal(exact[0].path, 'src/service.ts');
  assert.equal(exact[0].line, 1);
  assert.equal(exact[0].match, 'exact');

  const folded = retrieval.findSymbols('alphaservice');
  assert.equal(folded[0].match, 'case-insensitive');

  assert.ok(retrieval.listEdges('AlphaService').some((edge) => edge.line >= 1));
  assert.ok(retrieval.findTests('src/service.ts').some((edge) => (
    edge.path === 'src/service.test.ts' && edge.target === 'src/service.ts'
  )));

  const lexical = retrieval.searchText('needle-value" OR *');
  assert.ok(lexical.some((result) => result.path === 'src/service.ts'));
  assert.ok(lexical.every((result) => Number.isInteger(result.line) && result.line >= 1));
});

test('isolates every lookup to the active worktree', async (t) => {
  const { parent, root, cacheRoot } = fixture(t);
  const worktree = path.join(parent, 'worktree');
  git(root, ['worktree', 'add', '-q', '-b', 'alternate', worktree]);
  write(worktree, 'src/worktree-only.ts', 'export const WorktreeOnly = true;\n');

  await indexRepository(root, { cacheRoot });
  await indexRepository(worktree, { cacheRoot });
  const { openAtlasRetrieval } = await retrievalModule();
  const main = openAtlasRetrieval(root, { cacheRoot });
  const alternate = openAtlasRetrieval(worktree, { cacheRoot });
  t.after(() => {
    main.close();
    alternate.close();
  });

  assert.deepEqual(main.findPaths('worktree-only'), []);
  assert.equal(alternate.findPaths('worktree-only')[0].path, 'src/worktree-only.ts');
  assert.deepEqual(main.findSymbols('WorktreeOnly'), []);
  assert.equal(alternate.findSymbols('WorktreeOnly')[0].path, 'src/worktree-only.ts');
});

test('returns stable diagnostics for corrupt and incompatible caches', async (t) => {
  const corrupt = fixture(t);
  await indexRepository(corrupt.root, { cacheRoot: corrupt.cacheRoot });
  const { resolveRepositoryIdentity } = await import('./paths.mjs');
  const corruptIdentity = resolveRepositoryIdentity(corrupt.root, {
    cacheRoot: corrupt.cacheRoot,
  });
  fs.writeFileSync(corruptIdentity.cachePath, 'not sqlite');
  const { openAtlasRetrieval } = await retrievalModule();

  assert.equal(
    openAtlasRetrieval(corrupt.root, { cacheRoot: corrupt.cacheRoot }).code,
    'ATLAS_INDEX_CORRUPT',
  );

  const incompatible = fixture(t);
  await indexRepository(incompatible.root, { cacheRoot: incompatible.cacheRoot });
  const incompatibleIdentity = resolveRepositoryIdentity(incompatible.root, {
    cacheRoot: incompatible.cacheRoot,
  });
  const database = new DatabaseSync(incompatibleIdentity.cachePath);
  database.exec('PRAGMA user_version = 999');
  database.close();

  assert.equal(
    openAtlasRetrieval(incompatible.root, { cacheRoot: incompatible.cacheRoot }).code,
    'ATLAS_INDEX_INCOMPATIBLE',
  );
});

test('keeps the full SQLite integrity scan off the retrieval hot path', async (t) => {
  const { root, cacheRoot } = fixture(t);
  await indexRepository(root, { cacheRoot });
  const { openAtlasRetrieval } = await retrievalModule();
  let integrityChecks = 0;

  const fast = openAtlasRetrieval(root, {
    cacheRoot,
    onIntegrityCheck() {
      integrityChecks += 1;
    },
  });
  fast.close();
  assert.equal(integrityChecks, 0);

  const verified = openAtlasRetrieval(root, {
    cacheRoot,
    verifyIntegrity: true,
    onIntegrityCheck() {
      integrityChecks += 1;
    },
  });
  verified.close();
  assert.equal(integrityChecks, 1);
});

test('marks a changed repository stale without reading project content', async (t) => {
  const { root, cacheRoot } = fixture(t);
  await indexRepository(root, { cacheRoot });
  write(root, 'src/service.ts', 'export class ChangedWithoutRefresh {}\n');
  const { openAtlasRetrieval } = await retrievalModule();

  const retrieval = openAtlasRetrieval(root, {
    cacheRoot,
    readFile() {
      assert.fail('retrieval must not read repository files');
    },
  });
  t.after(() => retrieval.close());

  assert.equal(retrieval.state, 'ready');
  assert.equal(retrieval.freshness.state, 'stale');
  assert.equal(retrieval.freshness.reason, 'worktree-fingerprint-changed');
});

test('accepts the exact indexed dirty worktree and rejects later edits to the same path', async (t) => {
  const { root, cacheRoot } = fixture(t);
  write(root, 'src/service.ts', 'export class DirtyAtIndexTime {}\n');
  await indexRepository(root, { cacheRoot });
  const { openAtlasRetrieval } = await retrievalModule();

  const current = openAtlasRetrieval(root, { cacheRoot });
  assert.equal(current.state, 'ready');
  assert.equal(current.freshness.state, 'fresh');
  assert.equal(current.freshness.reason, 'dirty-fingerprint-current');
  current.close();

  write(root, 'src/service.ts', 'export class DirtyChangedAfterIndex {}\n');
  const changed = openAtlasRetrieval(root, { cacheRoot });
  t.after(() => changed.close());

  assert.equal(changed.state, 'ready');
  assert.equal(changed.freshness.state, 'stale');
  assert.equal(changed.freshness.reason, 'worktree-fingerprint-changed');
});

for (const [flag, label] of [
  ['--assume-unchanged', 'assume-unchanged'],
  ['--skip-worktree', 'skip-worktree'],
]) {
  test(`tracks same-size edits hidden by Git ${label}`, async (t) => {
    const { root, cacheRoot } = fixture(t);
    await indexRepository(root, { cacheRoot });
    git(root, ['update-index', flag, 'src/service.ts']);
    write(root, 'src/service.ts', 'export class HiddenChangeA {}\n');
    const { openAtlasRetrieval } = await retrievalModule();

    const stale = openAtlasRetrieval(root, { cacheRoot });
    assert.equal(stale.freshness.state, 'stale');
    assert.equal(stale.freshness.reason, 'worktree-fingerprint-changed');
    stale.close();

    await indexRepository(root, { cacheRoot });
    const refreshed = openAtlasRetrieval(root, { cacheRoot });
    assert.equal(refreshed.freshness.state, 'fresh');
    assert.equal(refreshed.findSymbols('HiddenChangeA')[0].name, 'HiddenChangeA');
    refreshed.close();

    write(root, 'src/service.ts', 'export class HiddenChangeB {}\n');
    const changedAgain = openAtlasRetrieval(root, { cacheRoot });
    t.after(() => changedAgain.close());
    assert.equal(changedAgain.freshness.state, 'stale');
    assert.equal(changedAgain.freshness.reason, 'worktree-fingerprint-changed');
  });
}

test('validates and caps all retrieval limits', async (t) => {
  const { root, cacheRoot } = fixture(t);
  await indexRepository(root, { cacheRoot });
  const { openAtlasRetrieval } = await retrievalModule();
  const retrieval = openAtlasRetrieval(root, { cacheRoot });
  t.after(() => retrieval.close());

  for (const invalid of [0, -1, Infinity, 1.5, '10']) {
    assert.throws(() => retrieval.findSymbols('AlphaService', { limit: invalid }), {
      code: 'ATLAS_INVALID_LIMIT',
    });
  }
  assert.ok(retrieval.manifest({ limit: 10_000 }).length <= 100);
});
