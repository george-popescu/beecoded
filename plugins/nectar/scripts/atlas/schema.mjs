export const ATLAS_SCHEMA_VERSION = 7;

export const ATLAS_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 1,
    sql: `
      CREATE TABLE snapshots (
        worktree_id TEXT PRIMARY KEY,
        head TEXT,
        branch TEXT,
        dirty INTEGER NOT NULL DEFAULT 0 CHECK (dirty IN (0, 1)),
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE manifest (
        worktree_id TEXT NOT NULL,
        path TEXT NOT NULL,
        content_hash TEXT,
        size INTEGER NOT NULL CHECK (size >= 0),
        tier TEXT NOT NULL,
        skip_reason TEXT,
        indexed_at TEXT NOT NULL,
        PRIMARY KEY (worktree_id, path)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE parse_records (
        content_hash TEXT PRIMARY KEY,
        language TEXT,
        parsed_at TEXT NOT NULL
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE symbols (
        content_hash TEXT NOT NULL REFERENCES parse_records(content_hash) ON DELETE CASCADE,
        symbol_index INTEGER NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        line_start INTEGER,
        line_end INTEGER,
        exported INTEGER NOT NULL DEFAULT 0 CHECK (exported IN (0, 1)),
        metadata_json TEXT,
        PRIMARY KEY (content_hash, symbol_index)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE edges (
        content_hash TEXT NOT NULL REFERENCES parse_records(content_hash) ON DELETE CASCADE,
        edge_index INTEGER NOT NULL,
        kind TEXT NOT NULL,
        source_symbol TEXT,
        target TEXT NOT NULL,
        line INTEGER,
        metadata_json TEXT,
        PRIMARY KEY (content_hash, edge_index)
      ) STRICT, WITHOUT ROWID;

      CREATE VIRTUAL TABLE documents_fts USING fts5(
        worktree_id UNINDEXED,
        path UNINDEXED,
        content,
        tokenize = 'unicode61'
      );
    `,
  }),
  Object.freeze({
    version: 2,
    sql: `
      CREATE TABLE failures (
        worktree_id TEXT NOT NULL,
        path TEXT NOT NULL,
        content_hash TEXT,
        code TEXT NOT NULL,
        message TEXT NOT NULL,
        details_json TEXT,
        PRIMARY KEY (worktree_id, path)
      ) STRICT, WITHOUT ROWID;

      CREATE INDEX manifest_content_hash_idx
        ON manifest(content_hash);
      CREATE INDEX symbols_name_idx
        ON symbols(name);
      CREATE INDEX edges_target_idx
        ON edges(target);
    `,
  }),
  Object.freeze({
    version: 3,
    sql: `
      DROP INDEX symbols_name_idx;
      DROP INDEX edges_target_idx;
      DROP TABLE edges;
      DROP TABLE symbols;
      DROP TABLE parse_records;

      ALTER TABLE manifest ADD COLUMN parse_key TEXT;
      ALTER TABLE snapshots ADD COLUMN policy_json TEXT;

      CREATE TABLE parse_records (
        parse_key TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        language TEXT NOT NULL,
        parsed_at TEXT NOT NULL
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE symbols (
        parse_key TEXT NOT NULL REFERENCES parse_records(parse_key) ON DELETE CASCADE,
        symbol_index INTEGER NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        line_start INTEGER,
        line_end INTEGER,
        exported INTEGER NOT NULL DEFAULT 0 CHECK (exported IN (0, 1)),
        metadata_json TEXT,
        PRIMARY KEY (parse_key, symbol_index)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE edges (
        parse_key TEXT NOT NULL REFERENCES parse_records(parse_key) ON DELETE CASCADE,
        edge_index INTEGER NOT NULL,
        kind TEXT NOT NULL,
        source_symbol TEXT,
        target TEXT NOT NULL,
        line INTEGER,
        metadata_json TEXT,
        PRIMARY KEY (parse_key, edge_index)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE path_edges (
        worktree_id TEXT NOT NULL,
        path TEXT NOT NULL,
        edge_index INTEGER NOT NULL,
        kind TEXT NOT NULL,
        source_symbol TEXT,
        target TEXT NOT NULL,
        line INTEGER,
        metadata_json TEXT,
        PRIMARY KEY (worktree_id, path, edge_index)
      ) STRICT, WITHOUT ROWID;

      CREATE INDEX parse_records_content_hash_idx
        ON parse_records(content_hash);
      CREATE INDEX symbols_name_idx
        ON symbols(name);
      CREATE INDEX edges_target_idx
        ON edges(target);
      CREATE INDEX path_edges_target_idx
        ON path_edges(target);

      UPDATE snapshots SET dirty = 1;
    `,
  }),
  Object.freeze({
    version: 4,
    sql: `
      DROP INDEX symbols_name_idx;
      DROP INDEX edges_target_idx;
      DROP TABLE edges;
      DROP TABLE symbols;
      DROP TABLE parse_records;

      UPDATE manifest SET parse_key = NULL;

      CREATE TABLE parse_records (
        parse_key TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        language TEXT NOT NULL,
        parser_identity TEXT NOT NULL,
        parsed_at TEXT NOT NULL
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE symbols (
        parse_key TEXT NOT NULL REFERENCES parse_records(parse_key) ON DELETE CASCADE,
        symbol_index INTEGER NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        line_start INTEGER,
        line_end INTEGER,
        exported INTEGER NOT NULL DEFAULT 0 CHECK (exported IN (0, 1)),
        metadata_json TEXT,
        PRIMARY KEY (parse_key, symbol_index)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE edges (
        parse_key TEXT NOT NULL REFERENCES parse_records(parse_key) ON DELETE CASCADE,
        edge_index INTEGER NOT NULL,
        kind TEXT NOT NULL,
        source_symbol TEXT,
        target TEXT NOT NULL,
        line INTEGER,
        metadata_json TEXT,
        PRIMARY KEY (parse_key, edge_index)
      ) STRICT, WITHOUT ROWID;

      CREATE INDEX parse_records_content_hash_idx
        ON parse_records(content_hash);
      CREATE INDEX symbols_name_idx
        ON symbols(name);
      CREATE INDEX edges_target_idx
        ON edges(target);

      UPDATE snapshots SET dirty = 1;
    `,
  }),
  Object.freeze({
    version: 5,
    sql: `
      ALTER TABLE snapshots ADD COLUMN dirty_paths_json TEXT;
      UPDATE snapshots SET dirty = 1, dirty_paths_json = NULL;
    `,
  }),
  Object.freeze({
    version: 6,
    sql: `
      ALTER TABLE snapshots ADD COLUMN worktree_fingerprint TEXT;
      UPDATE snapshots SET dirty = 1, worktree_fingerprint = NULL;
    `,
  }),
  Object.freeze({
    version: 7,
    sql: `
      UPDATE manifest SET parse_key = NULL;
      DELETE FROM parse_records;
      UPDATE snapshots SET dirty = 1, worktree_fingerprint = NULL;
    `,
  }),
]);

export function migrateAtlasSchema(database) {
  const row = database.prepare('PRAGMA user_version').get();
  const currentVersion = Number(row.user_version);
  if (!Number.isInteger(currentVersion) || currentVersion < 0) {
    throw new Error(`Invalid Atlas schema version: ${row.user_version}`);
  }
  if (currentVersion > ATLAS_SCHEMA_VERSION) {
    throw new Error(
      `Atlas schema ${currentVersion} is newer than supported schema ${ATLAS_SCHEMA_VERSION}`,
    );
  }

  database.exec('BEGIN IMMEDIATE');
  try {
    for (const migration of ATLAS_MIGRATIONS) {
      if (migration.version <= currentVersion) continue;
      database.exec(migration.sql);
      database.exec(`PRAGMA user_version = ${migration.version}`);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
