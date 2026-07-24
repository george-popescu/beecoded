import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  assertSafeAtlasCachePath,
  mandatoryPathExclusionReason,
  resolveRepositoryIdentity,
} from './paths.mjs';
import { assertAtlasRuntime } from './runtime.mjs';
import { ATLAS_SCHEMA_VERSION, migrateAtlasSchema } from './schema.mjs';

function repositoryIdentity(projectRootOrIdentity, options) {
  if (typeof projectRootOrIdentity === 'string') {
    return resolveRepositoryIdentity(projectRootOrIdentity, options);
  }
  return projectRootOrIdentity;
}

function json(value) {
  return value === undefined ? null : JSON.stringify(value);
}

function parseJson(value) {
  return value === null ? null : JSON.parse(value);
}

function assertRecord(condition, message) {
  if (!condition) throw new TypeError(message);
}

function parseKey(contentHash, parserIdentity) {
  assertRecord(
    typeof contentHash === 'string' && contentHash.length > 0,
    'Atlas parse key requires a content hash',
  );
  assertRecord(
    typeof parserIdentity === 'string' && parserIdentity.length > 0,
    'Atlas parse key requires a parser identity',
  );
  return `${parserIdentity}:${contentHash}`;
}

function validateFile(file) {
  assertRecord(file && typeof file === 'object', 'Atlas file must be an object');
  assertRecord(
    typeof file.path === 'string' && !mandatoryPathExclusionReason(file.path),
    `Invalid Atlas file path: ${file.path}`,
  );
  assertRecord(Number.isInteger(file.size) && file.size >= 0, `Invalid size for ${file.path}`);
  assertRecord(typeof file.tier === 'string' && file.tier.length > 0, `Invalid tier for ${file.path}`);
  assertRecord(
    file.contentHash === null
      || file.contentHash === undefined
      || (typeof file.contentHash === 'string' && file.contentHash.length > 0),
    `Invalid content hash for ${file.path}`,
  );
  if (file.parse) {
    assertRecord(
      typeof file.contentHash === 'string' && file.contentHash.length > 0,
      `Parse record for ${file.path} requires a content hash`,
    );
    assertRecord(Array.isArray(file.parse.symbols), `Invalid symbols for ${file.path}`);
    assertRecord(Array.isArray(file.parse.edges), `Invalid edges for ${file.path}`);
    assertRecord(
      typeof file.parse.language === 'string' && file.parse.language.length > 0,
      `Invalid parse language for ${file.path}`,
    );
    assertRecord(
      typeof file.parse.parserIdentity === 'string'
        && file.parse.parserIdentity.length > 0,
      `Invalid parser identity for ${file.path}`,
    );
    for (const symbol of file.parse.symbols) {
      assertRecord(
        typeof symbol.name === 'string' && symbol.name.length > 0,
        `Invalid symbol name for ${file.path}`,
      );
      assertRecord(
        typeof symbol.kind === 'string' && symbol.kind.length > 0,
        `Invalid symbol kind for ${file.path}`,
      );
    }
    for (const edge of file.parse.edges) {
      assertRecord(
        typeof edge.kind === 'string' && edge.kind.length > 0,
        `Invalid edge kind for ${file.path}`,
      );
      assertRecord(
        typeof edge.target === 'string' && edge.target.length > 0,
        `Invalid edge target for ${file.path}`,
      );
    }
  }
  if (file.pathEdges) {
    assertRecord(Array.isArray(file.pathEdges), `Invalid path edges for ${file.path}`);
    for (const edge of file.pathEdges) {
      assertRecord(
        typeof edge.kind === 'string' && edge.kind.length > 0,
        `Invalid path edge kind for ${file.path}`,
      );
      assertRecord(
        typeof edge.target === 'string' && edge.target.length > 0,
        `Invalid path edge target for ${file.path}`,
      );
    }
  }
  if (file.failure) {
    assertRecord(
      typeof file.failure.code === 'string' && file.failure.code.length > 0,
      `Invalid failure code for ${file.path}`,
    );
    assertRecord(
      typeof file.failure.message === 'string' && file.failure.message.length > 0,
      `Invalid failure message for ${file.path}`,
    );
  }
}

function isSqliteCorruption(error) {
  return error?.errcode === 11
    || error?.errcode === 26
    || /(?:database disk image is malformed|file is not a database)/i.test(error?.message || '');
}

export class AtlasStoreCorruptionError extends Error {
  constructor(databasePath, cause) {
    super(`Atlas SQLite cache is corrupt: ${databasePath}`, { cause });
    this.name = 'AtlasStoreCorruptionError';
    this.code = 'ATLAS_STORE_CORRUPT';
    this.path = databasePath;
  }
}

export class AtlasStore {
  constructor(database, repository, databasePath) {
    this.database = database;
    this.repository = repository;
    this.path = databasePath;
    this.closed = false;
    this.statements = {
      upsertSnapshot: database.prepare(`
        INSERT INTO snapshots (
          worktree_id, head, branch, dirty, dirty_paths_json,
          worktree_fingerprint, policy_json, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (worktree_id) DO UPDATE SET
          head = excluded.head,
          branch = excluded.branch,
          dirty = excluded.dirty,
          dirty_paths_json = excluded.dirty_paths_json,
          worktree_fingerprint = excluded.worktree_fingerprint,
          policy_json = excluded.policy_json,
          updated_at = excluded.updated_at
      `),
      clearManifest: database.prepare('DELETE FROM manifest WHERE worktree_id = ?'),
      clearDocuments: database.prepare('DELETE FROM documents_fts WHERE worktree_id = ?'),
      clearFailures: database.prepare('DELETE FROM failures WHERE worktree_id = ?'),
      clearPathEdges: database.prepare('DELETE FROM path_edges WHERE worktree_id = ?'),
      deleteManifestPath: database.prepare(
        'DELETE FROM manifest WHERE worktree_id = ? AND path = ?',
      ),
      deleteDocumentPath: database.prepare(
        'DELETE FROM documents_fts WHERE worktree_id = ? AND path = ?',
      ),
      deleteFailurePath: database.prepare(
        'DELETE FROM failures WHERE worktree_id = ? AND path = ?',
      ),
      insertManifest: database.prepare(`
        INSERT INTO manifest (
          worktree_id, path, content_hash, parse_key, size, tier, skip_reason, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `),
      insertParse: database.prepare(`
        INSERT OR IGNORE INTO parse_records (
          parse_key, content_hash, language, parser_identity, parsed_at
        ) VALUES (?, ?, ?, ?, ?)
      `),
      insertSymbol: database.prepare(`
        INSERT INTO symbols (
          parse_key, symbol_index, name, kind, line_start, line_end, exported, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `),
      insertEdge: database.prepare(`
        INSERT INTO edges (
          parse_key, edge_index, kind, source_symbol, target, line, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `),
      insertPathEdge: database.prepare(`
        INSERT INTO path_edges (
          worktree_id, path, edge_index, kind, source_symbol, target, line, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `),
      insertDocument: database.prepare(`
        INSERT INTO documents_fts (worktree_id, path, content) VALUES (?, ?, ?)
      `),
      insertFailure: database.prepare(`
        INSERT INTO failures (
          worktree_id, path, content_hash, code, message, details_json
        ) VALUES (?, ?, ?, ?, ?, ?)
      `),
    };
  }

  status() {
    const integrity = this.database.prepare('PRAGMA quick_check').get().quick_check;
    const journalMode = this.database.prepare('PRAGMA journal_mode').get().journal_mode;
    const schemaVersion = Number(
      this.database.prepare('PRAGMA user_version').get().user_version,
    );
    return {
      schemaVersion,
      currentSchemaVersion: ATLAS_SCHEMA_VERSION,
      journalMode,
      integrity,
    };
  }

  writeSnapshot(snapshot, options = {}) {
    assertRecord(snapshot && typeof snapshot === 'object', 'Atlas snapshot must be an object');
    assertRecord(
      typeof snapshot.worktreeId === 'string' && snapshot.worktreeId.length > 0,
      'Atlas snapshot requires a worktreeId',
    );
    assertRecord(Array.isArray(snapshot.files), 'Atlas snapshot files must be an array');
    const requestedBatchSize = options.batchSize ?? 100;
    assertRecord(
      Number.isInteger(requestedBatchSize) && requestedBatchSize > 0,
      'Atlas batch size must be a positive integer',
    );
    const batchSize = Math.min(requestedBatchSize, 100);
    const incremental = options.incremental === true;
    const changedPaths = new Set(options.changedPaths || []);
    if (incremental) {
      assertRecord(
        Array.isArray(options.changedPaths),
        'Incremental Atlas writes require changedPaths',
      );
    }
    const indexedAt = snapshot.indexedAt || new Date().toISOString();
    const previousPaths = new Set(
      this.database.prepare('SELECT path FROM manifest WHERE worktree_id = ?')
        .all(snapshot.worktreeId)
        .map((row) => row.path),
    );
    const seenPaths = new Set();
    for (const file of snapshot.files) {
      validateFile(file);
      assertRecord(!seenPaths.has(file.path), `Duplicate Atlas file path: ${file.path}`);
      seenPaths.add(file.path);
    }
    if (incremental) {
      for (const filePath of changedPaths) {
        assertRecord(
          seenPaths.has(filePath),
          `Changed Atlas path is absent from the snapshot: ${filePath}`,
        );
      }
    }
    const removedPaths = [...previousPaths]
      .filter((filePath) => !seenPaths.has(filePath));
    const filesToWrite = incremental
      ? snapshot.files.filter((file) => changedPaths.has(file.path))
      : snapshot.files;
    const result = {
      filesWritten: 0,
      filesDeleted: removedPaths.length,
      parseRecordsCreated: 0,
      parseRecordsReused: 0,
      batchSizes: [],
    };

    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.statements.upsertSnapshot.run(
        snapshot.worktreeId,
        snapshot.head ?? null,
        snapshot.branch ?? null,
        snapshot.dirty ? 1 : 0,
        json(snapshot.dirtyFiles || []),
        snapshot.worktreeFingerprint ?? null,
        json(snapshot.policy),
        indexedAt,
      );
      this.statements.clearPathEdges.run(snapshot.worktreeId);
      if (incremental) {
        for (const filePath of new Set([...removedPaths, ...changedPaths])) {
          this.statements.deleteDocumentPath.run(snapshot.worktreeId, filePath);
          this.statements.deleteFailurePath.run(snapshot.worktreeId, filePath);
          this.statements.deleteManifestPath.run(snapshot.worktreeId, filePath);
        }
      } else {
        this.statements.clearManifest.run(snapshot.worktreeId);
        this.statements.clearDocuments.run(snapshot.worktreeId);
        this.statements.clearFailures.run(snapshot.worktreeId);
      }

      for (let offset = 0; offset < filesToWrite.length; offset += batchSize) {
        const batch = filesToWrite.slice(offset, offset + batchSize);
        result.batchSizes.push(batch.length);
        for (const file of batch) {
          const fileParseKey = file.parse
            ? parseKey(file.contentHash, file.parse.parserIdentity)
            : null;
          this.statements.insertManifest.run(
            snapshot.worktreeId,
            file.path,
            file.contentHash ?? null,
            fileParseKey,
            file.size,
            file.tier,
            file.skipReason ?? null,
            indexedAt,
          );
          result.filesWritten += 1;

          if (file.parse) {
            const inserted = this.statements.insertParse.run(
              fileParseKey,
              file.contentHash,
              file.parse.language,
              file.parse.parserIdentity,
              indexedAt,
            );
            if (Number(inserted.changes) === 1) {
              result.parseRecordsCreated += 1;
              for (const [index, symbol] of file.parse.symbols.entries()) {
                this.statements.insertSymbol.run(
                  fileParseKey,
                  index,
                  symbol.name,
                  symbol.kind,
                  symbol.lineStart ?? null,
                  symbol.lineEnd ?? null,
                  symbol.exported ? 1 : 0,
                  json(symbol.metadata),
                );
              }
              for (const [index, edge] of file.parse.edges.entries()) {
                this.statements.insertEdge.run(
                  fileParseKey,
                  index,
                  edge.kind,
                  edge.sourceSymbol ?? null,
                  edge.target,
                  edge.line ?? null,
                  json(edge.metadata),
                );
              }
            } else {
              result.parseRecordsReused += 1;
            }
          }
          if (typeof file.text === 'string') {
            this.statements.insertDocument.run(snapshot.worktreeId, file.path, file.text);
          }
          if (file.failure) {
            this.statements.insertFailure.run(
              snapshot.worktreeId,
              file.path,
              file.contentHash ?? null,
              file.failure.code,
              file.failure.message,
              json(file.failure.details),
            );
          }
        }
        options.onBatch?.(batch.length);
      }
      for (const file of snapshot.files) {
        for (const [index, edge] of (file.pathEdges || []).entries()) {
          this.statements.insertPathEdge.run(
            snapshot.worktreeId,
            file.path,
            index,
            edge.kind,
            edge.sourceSymbol ?? null,
            edge.target,
            edge.line ?? null,
            json(edge.metadata),
          );
        }
      }
      options.beforeCommit?.();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  getManifest(worktreeId) {
    return this.database.prepare(`
      SELECT
        path,
        content_hash AS contentHash,
        parse_key AS parseKey,
        size,
        tier,
        skip_reason AS skipReason,
        indexed_at AS indexedAt
      FROM manifest
      WHERE worktree_id = ?
      ORDER BY path
    `).all(worktreeId);
  }

  getSnapshot(worktreeId) {
    const snapshot = this.database.prepare(`
      SELECT
        worktree_id AS worktreeId,
        head,
        branch,
        dirty,
        dirty_paths_json AS dirtyPathsJson,
        worktree_fingerprint AS worktreeFingerprint,
        policy_json AS policyJson,
        updated_at AS updatedAt
      FROM snapshots
      WHERE worktree_id = ?
    `).get(worktreeId);
    if (!snapshot) return null;
    const { dirtyPathsJson, policyJson, ...rest } = snapshot;
    return {
      ...rest,
      dirty: Boolean(snapshot.dirty),
      dirtyFiles: parseJson(dirtyPathsJson),
      policy: parseJson(policyJson),
    };
  }

  getParseRecord(contentHash, parserIdentity) {
    let key;
    if (parserIdentity === undefined) {
      const matches = this.database.prepare(`
        SELECT parse_key AS parseKey
        FROM parse_records
        WHERE content_hash = ?
        ORDER BY parse_key
      `).all(contentHash);
      if (matches.length === 0) return null;
      assertRecord(
        matches.length === 1,
        `Atlas parse lookup for ${contentHash} requires a parser identity`,
      );
      key = matches[0].parseKey;
    } else {
      key = parseKey(contentHash, parserIdentity);
    }
    return this.getParseRecordByKey(key);
  }

  getParseRecordByKey(key) {
    const record = this.database.prepare(`
      SELECT
        parse_key AS parseKey,
        content_hash AS contentHash,
        language,
        parser_identity AS parserIdentity,
        parsed_at AS parsedAt
      FROM parse_records
      WHERE parse_key = ?
    `).get(key);
    if (!record) return null;
    return {
      ...record,
      symbols: this.database.prepare(`
        SELECT
          name,
          kind,
          line_start AS lineStart,
          line_end AS lineEnd,
          exported,
          metadata_json AS metadataJson
        FROM symbols
        WHERE parse_key = ?
        ORDER BY symbol_index
      `).all(key).map(({ exported, metadataJson, ...symbol }) => ({
        ...symbol,
        exported: Boolean(exported),
        metadata: parseJson(metadataJson),
      })),
      edges: this.database.prepare(`
        SELECT
          kind,
          source_symbol AS sourceSymbol,
          target,
          line,
          metadata_json AS metadataJson
        FROM edges
        WHERE parse_key = ?
        ORDER BY edge_index
      `).all(key).map(({ metadataJson, ...edge }) => ({
        ...edge,
        metadata: parseJson(metadataJson),
      })),
    };
  }

  getStoredFile(worktreeId, filePath) {
    const manifest = this.database.prepare(`
      SELECT
        path,
        content_hash AS contentHash,
        parse_key AS parseKey,
        size,
        tier,
        skip_reason AS skipReason
      FROM manifest
      WHERE worktree_id = ? AND path = ?
    `).get(worktreeId, filePath);
    if (!manifest) return null;
    const document = this.database.prepare(`
      SELECT content
      FROM documents_fts
      WHERE worktree_id = ? AND path = ?
    `).get(worktreeId, filePath);
    const failure = this.database.prepare(`
      SELECT
        code,
        message,
        details_json AS detailsJson
      FROM failures
      WHERE worktree_id = ? AND path = ?
    `).get(worktreeId, filePath);
    const pathEdges = this.database.prepare(`
      SELECT
        kind,
        source_symbol AS sourceSymbol,
        target,
        line,
        metadata_json AS metadataJson
      FROM path_edges
      WHERE worktree_id = ? AND path = ?
      ORDER BY edge_index
    `).all(worktreeId, filePath).map(({ metadataJson, ...edge }) => ({
      ...edge,
      metadata: parseJson(metadataJson),
    }));
    return {
      ...manifest,
      ...(document ? { text: document.content } : {}),
      ...(manifest.parseKey
        ? { parse: this.getParseRecordByKey(manifest.parseKey) }
        : {}),
      ...(pathEdges.length ? { pathEdges } : {}),
      ...(failure
        ? {
            failure: {
              code: failure.code,
              message: failure.message,
              details: parseJson(failure.detailsJson),
            },
          }
        : {}),
    };
  }

  getStoredFilesForRelationships(worktreeId) {
    const files = new Map(
      this.getManifest(worktreeId).map((file) => [
        file.path,
        {
          path: file.path,
          contentHash: file.contentHash,
          parseKey: file.parseKey,
          size: file.size,
          tier: file.tier,
          skipReason: file.skipReason,
        },
      ]),
    );
    const parseRows = this.database.prepare(`
      SELECT
        manifest.path,
        parse_records.parse_key AS parseKey,
        parse_records.content_hash AS contentHash,
        parse_records.language,
        parse_records.parser_identity AS parserIdentity,
        parse_records.parsed_at AS parsedAt
      FROM manifest
      JOIN parse_records ON parse_records.parse_key = manifest.parse_key
      WHERE manifest.worktree_id = ?
      ORDER BY manifest.path
    `).all(worktreeId);
    for (const row of parseRows) {
      const file = files.get(row.path);
      if (!file) continue;
      file.parse = {
        parseKey: row.parseKey,
        contentHash: row.contentHash,
        language: row.language,
        parserIdentity: row.parserIdentity,
        parsedAt: row.parsedAt,
        symbols: [],
        edges: [],
      };
    }
    const symbolRows = this.database.prepare(`
      SELECT
        manifest.path,
        symbols.name,
        symbols.kind,
        symbols.line_start AS lineStart,
        symbols.line_end AS lineEnd,
        symbols.exported,
        symbols.metadata_json AS metadataJson
      FROM manifest
      JOIN symbols ON symbols.parse_key = manifest.parse_key
      WHERE manifest.worktree_id = ?
      ORDER BY manifest.path, symbols.symbol_index
    `).all(worktreeId);
    for (const { path: filePath, exported, metadataJson, ...symbol } of symbolRows) {
      const parse = files.get(filePath)?.parse;
      if (!parse) continue;
      parse.symbols.push({
        ...symbol,
        exported: Boolean(exported),
        metadata: parseJson(metadataJson),
      });
    }
    const edgeRows = this.database.prepare(`
      SELECT
        manifest.path,
        edges.kind,
        edges.source_symbol AS sourceSymbol,
        edges.target,
        edges.line,
        edges.metadata_json AS metadataJson
      FROM manifest
      JOIN edges ON edges.parse_key = manifest.parse_key
      WHERE manifest.worktree_id = ?
      ORDER BY manifest.path, edges.edge_index
    `).all(worktreeId);
    for (const { path: filePath, metadataJson, ...edge } of edgeRows) {
      const parse = files.get(filePath)?.parse;
      if (!parse) continue;
      parse.edges.push({
        ...edge,
        metadata: parseJson(metadataJson),
      });
    }
    return [...files.values()];
  }

  search(query, { worktreeId, limit = 20 } = {}) {
    assertRecord(typeof query === 'string' && query.trim().length > 0, 'FTS query is required');
    assertRecord(
      typeof worktreeId === 'string' && worktreeId.length > 0,
      'FTS search requires a worktreeId',
    );
    assertRecord(Number.isInteger(limit) && limit > 0, 'FTS limit must be a positive integer');
    return this.database.prepare(`
      SELECT
        path,
        snippet(documents_fts, 2, '<mark>', '</mark>', '…', 24) AS snippet,
        bm25(documents_fts) AS rank
      FROM documents_fts
      WHERE documents_fts MATCH ? AND worktree_id = ?
      ORDER BY rank, path
      LIMIT ?
    `).all(query, worktreeId, Math.min(limit, 100));
  }

  listEdges(worktreeId) {
    return this.database.prepare(`
      SELECT
        path,
        kind,
        sourceSymbol,
        target,
        line,
        metadataJson
      FROM (
        SELECT
          manifest.path AS path,
          edges.kind AS kind,
          edges.source_symbol AS sourceSymbol,
          edges.target AS target,
          edges.line AS line,
          edges.metadata_json AS metadataJson,
          edges.edge_index AS edgeIndex
        FROM manifest
        JOIN edges ON edges.parse_key = manifest.parse_key
        WHERE manifest.worktree_id = ?
        UNION ALL
        SELECT
          path_edges.path AS path,
          path_edges.kind AS kind,
          path_edges.source_symbol AS sourceSymbol,
          path_edges.target AS target,
          path_edges.line AS line,
          path_edges.metadata_json AS metadataJson,
          path_edges.edge_index AS edgeIndex
        FROM path_edges
        WHERE path_edges.worktree_id = ?
      )
      ORDER BY path, edgeIndex
    `).all(worktreeId, worktreeId).map(({ metadataJson, ...edge }) => ({
      ...edge,
      metadata: parseJson(metadataJson),
    }));
  }

  getFailures(worktreeId) {
    return this.database.prepare(`
      SELECT
        path,
        content_hash AS contentHash,
        code,
        message,
        details_json AS detailsJson
      FROM failures
      WHERE worktree_id = ?
      ORDER BY path
    `).all(worktreeId).map(({ detailsJson, ...failure }) => ({
      ...failure,
      details: parseJson(detailsJson),
    }));
  }

  counts() {
    const count = (table) => Number(
      this.database.prepare(`SELECT count(*) AS count FROM ${table}`).get().count,
    );
    return {
      snapshots: count('snapshots'),
      manifest: count('manifest'),
      parseRecords: count('parse_records'),
      symbols: count('symbols'),
      edges: count('edges'),
      pathEdges: count('path_edges'),
      failures: count('failures'),
      documents: count('documents_fts'),
    };
  }

  clearWorktree(worktreeId) {
    assertRecord(typeof worktreeId === 'string' && worktreeId.length > 0, 'worktreeId is required');
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const existed = this.database.prepare(
        'SELECT 1 AS present FROM snapshots WHERE worktree_id = ?',
      ).get(worktreeId);
      this.statements.clearDocuments.run(worktreeId);
      this.statements.clearFailures.run(worktreeId);
      this.statements.clearPathEdges.run(worktreeId);
      this.statements.clearManifest.run(worktreeId);
      this.database.prepare('DELETE FROM snapshots WHERE worktree_id = ?').run(worktreeId);
      this.database.prepare(`
        DELETE FROM parse_records
        WHERE NOT EXISTS (
          SELECT 1
          FROM manifest
          WHERE manifest.parse_key = parse_records.parse_key
        )
      `).run();
      this.database.exec('COMMIT');
      return Boolean(existed);
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  close() {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }
}

export function openAtlasStore(projectRootOrIdentity, options = {}) {
  assertAtlasRuntime();
  const repository = repositoryIdentity(projectRootOrIdentity, options);
  const databasePath = assertSafeAtlasCachePath(repository);
  const repositoryCacheDirectory = path.dirname(databasePath);
  fs.mkdirSync(repositoryCacheDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(repositoryCacheDirectory, 0o700);
  if (fs.existsSync(databasePath)) fs.chmodSync(databasePath, 0o600);

  let database;
  try {
    database = new DatabaseSync(databasePath);
    fs.chmodSync(databasePath, 0o600);
    database.exec('PRAGMA busy_timeout = 5000');
    database.exec('PRAGMA foreign_keys = ON');
    database.exec('PRAGMA journal_mode = WAL');
    database.exec('PRAGMA synchronous = NORMAL');
    migrateAtlasSchema(database);
    for (const candidate of [
      databasePath,
      `${databasePath}-wal`,
      `${databasePath}-shm`,
    ]) {
      if (fs.existsSync(candidate)) fs.chmodSync(candidate, 0o600);
    }
    const integrity = database.prepare('PRAGMA quick_check').get().quick_check;
    if (integrity !== 'ok') {
      const error = new Error(`database disk image is malformed: ${integrity}`);
      error.errcode = 11;
      throw error;
    }
    return new AtlasStore(database, repository, databasePath);
  } catch (error) {
    try {
      database?.close();
    } catch {
      // The original open or integrity error is the actionable failure.
    }
    if (!isSqliteCorruption(error)) throw error;
    if (!options.recoverCorrupt) {
      throw new AtlasStoreCorruptionError(databasePath, error);
    }

    const suffix = `${Date.now()}-${process.pid}`;
    const quarantinePath = `${databasePath}.corrupt-${suffix}`;
    fs.renameSync(databasePath, quarantinePath);
    for (const sidecar of [`${databasePath}-wal`, `${databasePath}-shm`]) {
      fs.rmSync(sidecar, { force: true });
    }
    try {
      const rebuilt = openAtlasStore(repository, { ...options, recoverCorrupt: false });
      rebuilt.quarantinePath = quarantinePath;
      return rebuilt;
    } catch (rebuildError) {
      for (const candidate of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
        fs.rmSync(candidate, { force: true });
      }
      fs.renameSync(quarantinePath, databasePath);
      throw rebuildError;
    }
  }
}
