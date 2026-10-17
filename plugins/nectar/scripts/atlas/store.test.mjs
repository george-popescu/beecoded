import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { resolveRepositoryIdentity } from './paths.mjs';
import { ATLAS_MIGRATIONS, ATLAS_SCHEMA_VERSION, migrateAtlasSchema } from './schema.mjs';

test('v8 invalidates old parsed relationships while retaining manifest discovery', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec('PRAGMA foreign_keys = ON');
    for (const migration of ATLAS_MIGRATIONS.filter((m) => m.version <= 7)) database.exec(migration.sql);
    database.exec("PRAGMA user_version = 7; INSERT INTO snapshots(worktree_id, dirty, updated_at) VALUES ('w', 0, 'now'); INSERT INTO parse_records(parse_key, content_hash, language, parser_identity, parsed_at) VALUES ('p', 'h', 'javascript', 'old', 'now'); INSERT INTO edges(parse_key, edge_index, kind, target) VALUES ('p', 0, 'calls', 'channels.order.channel');");
    migrateAtlasSchema(database);
    assert.equal(database.prepare('SELECT count(*) AS n FROM parse_records').get().n, 0);
    assert.equal(database.prepare('SELECT count(*) AS n FROM edges').get().n, 0);
    assert.equal(database.prepare('SELECT dirty FROM snapshots').get().dirty, 1);
    assert.equal(database.prepare('PRAGMA user_version').get().user_version, 8);
  } finally { database.close(); }
});

function git(root, ...args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function repositoryFixture(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-atlas-store-'));
  const root = path.join(parent, 'repository');
  const cacheRoot = path.join(parent, 'cache', 'beecoded', 'nectar', 'atlas');
  fs.mkdirSync(root);
  git(root, 'init', '--quiet');
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { root, cacheRoot };
}

async function loadStore() {
  try {
    return await import('./store.mjs');
  } catch (error) {
    assert.fail(`Atlas SQLite store is not implemented: ${error.message}`);
  }
}

test('creates the current WAL schema only at the repository-derived safe cache path', async (t) => {
  const { root, cacheRoot } = repositoryFixture(t);
  const { openAtlasStore } = await loadStore();

  const store = openAtlasStore(root, { cacheRoot });
  t.after(() => store.close());

  const status = store.status();
  assert.equal(status.schemaVersion, status.currentSchemaVersion);
  assert.equal(status.journalMode, 'wal');
  assert.equal(status.integrity, 'ok');
  assert.equal(store.path.startsWith(`${fs.realpathSync(cacheRoot)}${path.sep}`), true);
  assert.equal(store.path.startsWith(`${fs.realpathSync(root)}${path.sep}`), false);
  assert.equal(fs.existsSync(store.path), true);
  assert.deepEqual(fs.readdirSync(root).sort(), ['.git']);
});

test('enforces private modes for new and existing Atlas cache files', async (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX cache modes are not observable on Windows');
    return;
  }

  const { root, cacheRoot } = repositoryFixture(t);
  const { openAtlasStore } = await loadStore();
  const previousUmask = process.umask(0o022);
  let store;
  try {
    store = openAtlasStore(root, { cacheRoot });
  } finally {
    process.umask(previousUmask);
  }
  const databasePath = store.path;
  const repositoryCacheDirectory = path.dirname(databasePath);
  store.close();

  assert.equal(fs.statSync(repositoryCacheDirectory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(databasePath).mode & 0o777, 0o600);

  fs.chmodSync(repositoryCacheDirectory, 0o755);
  fs.chmodSync(databasePath, 0o644);
  const reopened = openAtlasStore(root, { cacheRoot });
  reopened.close();

  assert.equal(fs.statSync(repositoryCacheDirectory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(databasePath).mode & 0o777, 0o600);
});

test('migrates a populated v1 database without losing its per-worktree manifest', async (t) => {
  const { root, cacheRoot } = repositoryFixture(t);
  const repository = resolveRepositoryIdentity(root, { cacheRoot });
  fs.mkdirSync(path.dirname(repository.cachePath), { recursive: true });
  const legacy = new DatabaseSync(repository.cachePath);
  legacy.exec(ATLAS_MIGRATIONS[0].sql);
  legacy.exec('PRAGMA user_version = 1');
  legacy.prepare(`
    INSERT INTO manifest (
      worktree_id, path, content_hash, size, tier, skip_reason, indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(repository.worktreeId, 'src/legacy.js', 'legacy-hash', 12, 'ast+fts', null, 'v1');
  legacy.close();

  const { openAtlasStore } = await loadStore();
  const store = openAtlasStore(repository);
  t.after(() => store.close());

  assert.equal(store.status().schemaVersion, ATLAS_SCHEMA_VERSION);
  const migrated = new DatabaseSync(store.path, { readOnly: true });
  t.after(() => migrated.close());
  assert.equal(
    migrated.prepare('SELECT content_hash FROM manifest WHERE path = ?')
      .get('src/legacy.js').content_hash,
    'legacy-hash',
  );
  assert.equal(
    migrated.prepare(
      "SELECT count(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = 'failures'",
    ).get().count,
    1,
  );
});

test('rolls back a failed schema migration without advancing or losing v1 data', async (t) => {
  const { root, cacheRoot } = repositoryFixture(t);
  const repository = resolveRepositoryIdentity(root, { cacheRoot });
  fs.mkdirSync(path.dirname(repository.cachePath), { recursive: true });
  const legacy = new DatabaseSync(repository.cachePath);
  legacy.exec(ATLAS_MIGRATIONS[0].sql);
  legacy.exec('CREATE TABLE failures (incompatible TEXT)');
  legacy.exec('PRAGMA user_version = 1');
  legacy.prepare(`
    INSERT INTO manifest (
      worktree_id, path, content_hash, size, tier, skip_reason, indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(repository.worktreeId, 'src/preserved.js', 'preserved-hash', 4, 'ast+fts', null, 'v1');
  legacy.close();

  const { openAtlasStore } = await loadStore();
  assert.throws(() => openAtlasStore(repository), /failures already exists/);

  const unchanged = new DatabaseSync(repository.cachePath, { readOnly: true });
  t.after(() => unchanged.close());
  assert.equal(unchanged.prepare('PRAGMA user_version').get().user_version, 1);
  assert.equal(
    unchanged.prepare('SELECT content_hash FROM manifest WHERE path = ?')
      .get('src/preserved.js').content_hash,
    'preserved-hash',
  );
  assert.deepEqual(
    unchanged.prepare('PRAGMA table_info(failures)').all().map((column) => column.name),
    ['incompatible'],
  );
});

test('isolates worktree manifests while reusing one content-addressed parse record', async (t) => {
  const { root, cacheRoot } = repositoryFixture(t);
  const { openAtlasStore } = await loadStore();
  const store = openAtlasStore(root, { cacheRoot });
  t.after(() => store.close());
  const sharedParse = {
    language: 'javascript',
    parserIdentity: 'javascript:babel8:js',
    symbols: [{
      name: 'shared',
      kind: 'function',
      lineStart: 1,
      lineEnd: 3,
      exported: true,
    }],
    edges: [],
  };

  const first = store.writeSnapshot({
    worktreeId: 'worktree-a',
    head: 'aaaa',
    files: [{
      path: 'src/a.js',
      contentHash: 'same-content-hash',
      size: 42,
      tier: 'ast+fts',
      text: 'export function shared() {}',
      parse: sharedParse,
    }],
  });
  const second = store.writeSnapshot({
    worktreeId: 'worktree-b',
    head: 'bbbb',
    files: [{
      path: 'src/b.js',
      contentHash: 'same-content-hash',
      size: 42,
      tier: 'ast+fts',
      text: 'export function shared() {}',
      parse: sharedParse,
    }],
  });

  assert.equal(first.parseRecordsCreated, 1);
  assert.equal(second.parseRecordsReused, 1);
  assert.deepEqual(store.getManifest('worktree-a').map((file) => file.path), ['src/a.js']);
  assert.deepEqual(store.getManifest('worktree-b').map((file) => file.path), ['src/b.js']);
  assert.equal(store.getParseRecord('same-content-hash').symbols[0].name, 'shared');
  assert.equal(store.counts().parseRecords, 1);
});

test('clear removes orphaned parse data while preserving records shared by another worktree', async (t) => {
  const { root, cacheRoot } = repositoryFixture(t);
  const { openAtlasStore } = await loadStore();
  const store = openAtlasStore(root, { cacheRoot });
  t.after(() => store.close());
  const parse = {
    language: 'javascript',
    parserIdentity: 'javascript:babel8:js',
    symbols: [{
      name: 'SharedSymbol',
      kind: 'function',
      lineStart: 1,
      lineEnd: 1,
      exported: true,
    }],
    edges: [{
      kind: 'calls',
      sourceSymbol: 'SharedSymbol',
      target: 'dependency',
      line: 1,
    }],
  };
  store.writeSnapshot({
    worktreeId: 'worktree-a',
    files: [
      {
        path: 'src/shared-a.js',
        contentHash: 'shared',
        size: 1,
        tier: 'ast+fts',
        parse,
      },
      {
        path: 'src/private-a.js',
        contentHash: 'private',
        size: 1,
        tier: 'ast+fts',
        parse: { ...parse, parserIdentity: 'javascript:babel8:private' },
      },
    ],
  });
  store.writeSnapshot({
    worktreeId: 'worktree-b',
    files: [{
      path: 'src/shared-b.js',
      contentHash: 'shared',
      size: 1,
      tier: 'ast+fts',
      parse,
    }],
  });

  assert.equal(store.counts().parseRecords, 2);
  assert.equal(store.clearWorktree('worktree-a'), true);
  assert.equal(store.counts().parseRecords, 1);
  assert.equal(store.getParseRecord('private'), null);
  assert.notEqual(store.getParseRecord('shared'), null);
  assert.equal(store.counts().symbols, 1);
  assert.equal(store.counts().edges, 1);
  assert.deepEqual(store.getManifest('worktree-b').map((entry) => entry.path), [
    'src/shared-b.js',
  ]);
});

test('persists the exact worktree fingerprint with each snapshot', async (t) => {
  const { root, cacheRoot } = repositoryFixture(t);
  const { openAtlasStore } = await loadStore();
  const first = openAtlasStore(root, { cacheRoot });
  first.writeSnapshot({
    worktreeId: 'fingerprint-worktree',
    head: 'aaaa',
    dirty: true,
    dirtyFiles: ['src/dirty.js'],
    worktreeFingerprint: 'fingerprint-a',
    files: [],
  });
  first.close();

  const reopened = openAtlasStore(root, { cacheRoot });
  t.after(() => reopened.close());
  assert.equal(
    reopened.getSnapshot('fingerprint-worktree').worktreeFingerprint,
    'fingerprint-a',
  );
});

test('returns FTS5 matches only from the requested worktree', async (t) => {
  const { root, cacheRoot } = repositoryFixture(t);
  const { openAtlasStore } = await loadStore();
  const store = openAtlasStore(root, { cacheRoot });
  t.after(() => store.close());

  for (const [worktreeId, filePath, text] of [
    ['worktree-a', 'src/payments.js', 'const settlementOrchid = true;'],
    ['worktree-b', 'src/private.js', 'const settlementOrchid = false;'],
  ]) {
    store.writeSnapshot({
      worktreeId,
      files: [{
        path: filePath,
        contentHash: `${worktreeId}-hash`,
        size: text.length,
        tier: 'fts-only',
        text,
      }],
    });
  }

  assert.deepEqual(
    store.search('settlementOrchid', { worktreeId: 'worktree-a' })
      .map((match) => match.path),
    ['src/payments.js'],
  );
  assert.deepEqual(store.search('missingToken', { worktreeId: 'worktree-a' }), []);
});

test('persists symbols, graph edges, and bounded failures across reopen', async (t) => {
  const { root, cacheRoot } = repositoryFixture(t);
  const { openAtlasStore } = await loadStore();
  const first = openAtlasStore(root, { cacheRoot });
  first.writeSnapshot({
    worktreeId: 'graph-worktree',
    files: [{
      path: 'src/controller.js',
      contentHash: 'controller-hash',
      size: 80,
      tier: 'ast+fts',
      parse: {
        language: 'javascript',
        parserIdentity: 'javascript:babel8:js',
        symbols: [{
          name: 'Controller',
          kind: 'class',
          lineStart: 4,
          lineEnd: 12,
          exported: true,
          metadata: { role: 'route' },
        }],
        edges: [{
          kind: 'calls',
          sourceSymbol: 'Controller',
          target: 'Service.run',
          line: 8,
          metadata: { confidence: 'exact' },
        }],
      },
      failure: {
        code: 'PARTIAL_PARSE',
        message: 'Recovered after unexpected token',
        details: { line: 11 },
      },
    }],
  });
  first.close();

  const reopened = openAtlasStore(root, { cacheRoot });
  t.after(() => reopened.close());
  const parseRecord = reopened.getParseRecord('controller-hash');
  assert.deepEqual(parseRecord.symbols, [{
    name: 'Controller',
    kind: 'class',
    lineStart: 4,
    lineEnd: 12,
    exported: true,
    metadata: { role: 'route' },
  }]);
  assert.deepEqual(reopened.listEdges('graph-worktree'), [{
    path: 'src/controller.js',
    kind: 'calls',
    sourceSymbol: 'Controller',
    target: 'Service.run',
    line: 8,
    metadata: { confidence: 'exact' },
  }]);
  assert.deepEqual(reopened.getFailures('graph-worktree'), [{
    path: 'src/controller.js',
    contentHash: 'controller-hash',
    code: 'PARTIAL_PARSE',
    message: 'Recovered after unexpected token',
    details: { line: 11 },
  }]);
});

test('caps oversized batch requests and reports every bounded write batch', async (t) => {
  const { root, cacheRoot } = repositoryFixture(t);
  const { openAtlasStore } = await loadStore();
  const store = openAtlasStore(root, { cacheRoot });
  t.after(() => store.close());
  const observedBatchSizes = [];
  const files = Array.from({ length: 205 }, (_, index) => ({
    path: `src/file-${String(index).padStart(3, '0')}.js`,
    contentHash: `hash-${index}`,
    size: index,
    tier: 'metadata-only',
  }));

  const result = store.writeSnapshot(
    { worktreeId: 'large-worktree', files },
    {
      batchSize: 10_000,
      onBatch(size) {
        observedBatchSizes.push(size);
      },
    },
  );

  assert.deepEqual(result.batchSizes, [100, 100, 5]);
  assert.deepEqual(observedBatchSizes, [100, 100, 5]);
  assert.equal(result.filesWritten, 205);
  assert.equal(store.getManifest('large-worktree').length, 205);
});

test('removes deleted paths from manifest, FTS, and failures without discarding parse reuse', async (t) => {
  const { root, cacheRoot } = repositoryFixture(t);
  const { openAtlasStore } = await loadStore();
  const store = openAtlasStore(root, { cacheRoot });
  t.after(() => store.close());
  const retained = {
    path: 'src/retained.js',
    contentHash: 'retained-hash',
    size: 8,
    tier: 'fts-only',
    text: 'retainedTerm',
  };
  const deleted = {
    path: 'src/deleted.js',
    contentHash: 'deleted-hash',
    size: 8,
    tier: 'ast+fts',
    text: 'deletedTerm',
    parse: {
      language: 'javascript',
      parserIdentity: 'javascript:babel8:js',
      symbols: [],
      edges: [],
    },
    failure: { code: 'PARSE_ERROR', message: 'old failure' },
  };
  store.writeSnapshot({ worktreeId: 'cleanup-worktree', files: [retained, deleted] });
  const added = {
    path: 'src/added.js',
    contentHash: 'added-hash',
    size: 8,
    tier: 'fts-only',
    text: 'addedTerm',
  };

  const result = store.writeSnapshot({
    worktreeId: 'cleanup-worktree',
    files: [retained, added],
  });

  assert.equal(result.filesDeleted, 1);
  assert.deepEqual(
    store.getManifest('cleanup-worktree').map((file) => file.path),
    ['src/added.js', 'src/retained.js'],
  );
  assert.deepEqual(store.search('deletedTerm', { worktreeId: 'cleanup-worktree' }), []);
  assert.deepEqual(store.getFailures('cleanup-worktree'), []);
  assert.notEqual(store.getParseRecord('deleted-hash'), null);
});

test('rolls back the whole snapshot when a later write batch fails validation', async (t) => {
  const { root, cacheRoot } = repositoryFixture(t);
  const { openAtlasStore } = await loadStore();
  const store = openAtlasStore(root, { cacheRoot });
  t.after(() => store.close());
  store.writeSnapshot({
    worktreeId: 'rollback-worktree',
    head: 'old-head',
    files: [{
      path: 'src/old.js',
      contentHash: 'old-hash',
      size: 3,
      tier: 'fts-only',
      text: 'oldSearchTerm',
    }],
  });

  assert.throws(
    () => store.writeSnapshot({
      worktreeId: 'rollback-worktree',
      head: 'new-head',
      files: [
        {
          path: 'src/new.js',
          contentHash: 'new-hash',
          size: 3,
          tier: 'fts-only',
          text: 'newSearchTerm',
        },
        {
          path: '../outside.js',
          contentHash: 'invalid-hash',
          size: 3,
          tier: 'fts-only',
        },
      ],
    }, { batchSize: 1 }),
    { message: 'Invalid Atlas file path: ../outside.js' },
  );

  assert.deepEqual(
    store.getManifest('rollback-worktree').map((file) => file.path),
    ['src/old.js'],
  );
  assert.equal(store.search('oldSearchTerm', { worktreeId: 'rollback-worktree' }).length, 1);
  assert.deepEqual(store.search('newSearchTerm', { worktreeId: 'rollback-worktree' }), []);
});

test('keeps concurrent readers on the last committed snapshot during a WAL write', async (t) => {
  const { root, cacheRoot } = repositoryFixture(t);
  const { openAtlasStore } = await loadStore();
  const writer = openAtlasStore(root, { cacheRoot });
  const reader = openAtlasStore(root, { cacheRoot });
  t.after(() => writer.close());
  t.after(() => reader.close());
  writer.writeSnapshot({
    worktreeId: 'reader-worktree',
    files: [{
      path: 'src/old.js',
      contentHash: 'reader-old',
      size: 3,
      tier: 'fts-only',
      text: 'visibleBeforeCommit',
    }],
  });

  writer.writeSnapshot({
    worktreeId: 'reader-worktree',
    files: [{
      path: 'src/new.js',
      contentHash: 'reader-new',
      size: 3,
      tier: 'fts-only',
      text: 'visibleAfterCommit',
    }],
  }, {
    beforeCommit() {
      assert.equal(
        reader.search('visibleBeforeCommit', { worktreeId: 'reader-worktree' }).length,
        1,
      );
      assert.deepEqual(
        reader.search('visibleAfterCommit', { worktreeId: 'reader-worktree' }),
        [],
      );
    },
  });

  assert.deepEqual(
    reader.search('visibleBeforeCommit', { worktreeId: 'reader-worktree' }),
    [],
  );
  assert.equal(
    reader.search('visibleAfterCommit', { worktreeId: 'reader-worktree' }).length,
    1,
  );
});

test('detects corruption and rebuilds only through explicit quarantined recovery', async (t) => {
  const { root, cacheRoot } = repositoryFixture(t);
  const repository = resolveRepositoryIdentity(root, { cacheRoot });
  fs.mkdirSync(path.dirname(repository.cachePath), { recursive: true });
  const corruptBytes = Buffer.from('this is not a sqlite database');
  fs.writeFileSync(repository.cachePath, corruptBytes);
  const { AtlasStoreCorruptionError, openAtlasStore } = await loadStore();

  assert.throws(
    () => openAtlasStore(repository),
    (error) => {
      assert.equal(error instanceof AtlasStoreCorruptionError, true);
      assert.equal(error.code, 'ATLAS_STORE_CORRUPT');
      assert.equal(error.path, fs.realpathSync(repository.cachePath));
      return true;
    },
  );
  assert.deepEqual(fs.readFileSync(repository.cachePath), corruptBytes);

  const rebuilt = openAtlasStore(repository, { recoverCorrupt: true });
  t.after(() => rebuilt.close());
  assert.equal(rebuilt.status().integrity, 'ok');
  const quarantined = fs.readdirSync(path.dirname(rebuilt.path))
    .filter((name) => name.startsWith('atlas.sqlite.corrupt-'));
  assert.equal(quarantined.length, 1);
  assert.deepEqual(
    fs.readFileSync(path.join(path.dirname(rebuilt.path), quarantined[0])),
    corruptBytes,
  );
});

test('rejects forged database paths before creating any repository file', async (t) => {
  const { root, cacheRoot } = repositoryFixture(t);
  const repository = resolveRepositoryIdentity(root, { cacheRoot });
  const forgedPath = path.join(root, '.atlas', 'atlas.sqlite');
  const { openAtlasStore } = await loadStore();

  assert.throws(
    () => openAtlasStore({ ...repository, cachePath: forgedPath }),
    { message: 'Atlas database path is outside the safe Beecoded cache path' },
  );
  assert.equal(fs.existsSync(path.join(root, '.atlas')), false);
  assert.deepEqual(fs.readdirSync(root).sort(), ['.git']);
});
