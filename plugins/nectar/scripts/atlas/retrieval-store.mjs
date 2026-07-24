import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import {
  assertSafeAtlasCachePath,
  gitWorktreeState,
  resolveRepositoryIdentity,
} from './paths.mjs';
import { ATLAS_SCHEMA_VERSION } from './schema.mjs';
import { assertAtlasRuntime } from './runtime.mjs';

const MAX_RESULTS = 101;

function fallback(code, reason) {
  return { state: 'fallback', code, reason };
}

function parseJson(value) {
  return value === null || value === undefined ? null : JSON.parse(value);
}

function limitValue(value = 20) {
  if (!Number.isInteger(value) || value <= 0 || !Number.isFinite(value)) {
    const error = new TypeError('Atlas retrieval limit must be a positive finite integer');
    error.code = 'ATLAS_INVALID_LIMIT';
    throw error;
  }
  return Math.min(value, MAX_RESULTS);
}

function currentFreshness(repository, snapshot, options = {}) {
  let current;
  try {
    current = gitWorktreeState(repository.root, {
      spawn: options.spawn,
    });
  } catch {
    return { state: 'stale', reason: 'git-state-unavailable' };
  }
  if (current.head !== snapshot.head) {
    return { state: 'stale', reason: 'head-changed' };
  }
  if (!snapshot.worktreeFingerprint) {
    return { state: 'stale', reason: 'worktree-fingerprint-missing' };
  }
  if (current.worktreeFingerprint !== snapshot.worktreeFingerprint) {
    return { state: 'stale', reason: 'worktree-fingerprint-changed' };
  }
  return {
    state: 'fresh',
    reason: current.dirty ? 'dirty-fingerprint-current' : 'snapshot-current',
  };
}

function ftsQuery(value) {
  const tokens = String(value)
    .normalize('NFKC')
    .match(/[\p{L}\p{N}_]+/gu)
    ?.filter((token) => !/^(?:and|or|not|near)$/i.test(token))
    .slice(0, 12) || [];
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(' AND ');
}

function firstLine(content, query) {
  const tokens = String(query).match(/[\p{L}\p{N}_]+/gu) || [];
  const normalized = content.toLocaleLowerCase();
  const offsets = tokens
    .map((token) => normalized.indexOf(token.toLocaleLowerCase()))
    .filter((offset) => offset >= 0);
  const offset = offsets.length ? Math.min(...offsets) : 0;
  return content.slice(0, offset).split('\n').length;
}

function snapshotRow(database, worktreeId) {
  const row = database.prepare(`
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
  if (!row) return null;
  const { dirtyPathsJson, policyJson, ...snapshot } = row;
  return {
    ...snapshot,
    dirty: Boolean(row.dirty),
    dirtyFiles: parseJson(dirtyPathsJson),
    policy: parseJson(policyJson),
  };
}

function evidenceRow(row) {
  const metadata = parseJson(row.metadataJson);
  const { metadataJson, ...result } = row;
  return { ...result, ...(metadata ? { metadata } : {}) };
}

class AtlasRetrieval {
  constructor(database, repository, snapshot) {
    this.database = database;
    this.repository = repository;
    this.snapshot = snapshot;
    this.freshness = null;
    this.state = 'ready';
    this.closed = false;
  }

  manifest({ limit = 20 } = {}) {
    return this.database.prepare(`
      SELECT path, size, tier, skip_reason AS skipReason, indexed_at AS indexedAt
      FROM manifest
      WHERE worktree_id = ?
      ORDER BY path
      LIMIT ?
    `).all(this.repository.worktreeId, limitValue(limit));
  }

  findPaths(query, { limit = 20 } = {}) {
    const value = String(query || '').trim();
    if (!value) return [];
    return this.database.prepare(`
      SELECT path, size, tier, skip_reason AS skipReason, indexed_at AS indexedAt
      FROM manifest
      WHERE worktree_id = ?
        AND (path = ? OR instr(lower(path), lower(?)) > 0)
      ORDER BY CASE WHEN path = ? THEN 0 ELSE 1 END, length(path), path
      LIMIT ?
    `).all(
      this.repository.worktreeId,
      value,
      value,
      value,
      limitValue(limit),
    ).map((row) => ({
      ...row,
      line: 1,
      match: row.path === value ? 'exact' : 'partial',
    }));
  }

  findSymbols(query, { limit = 20 } = {}) {
    const value = String(query || '').trim();
    if (!value) return [];
    return this.database.prepare(`
      SELECT
        manifest.path,
        symbols.name,
        symbols.kind,
        symbols.line_start AS line,
        symbols.line_end AS lineEnd,
        symbols.exported,
        symbols.metadata_json AS metadataJson,
        documents_fts.content,
        CASE
          WHEN symbols.name = ? THEN 'exact'
          WHEN lower(symbols.name) = lower(?) THEN 'case-insensitive'
          ELSE 'partial'
        END AS match
      FROM manifest
      JOIN symbols ON symbols.parse_key = manifest.parse_key
      LEFT JOIN documents_fts
        ON documents_fts.worktree_id = manifest.worktree_id
        AND documents_fts.path = manifest.path
      WHERE manifest.worktree_id = ?
        AND instr(lower(symbols.name), lower(?)) > 0
      ORDER BY
        CASE
          WHEN symbols.name = ? THEN 0
          WHEN lower(symbols.name) = lower(?) THEN 1
          ELSE 2
        END,
        manifest.path,
        symbols.line_start,
        symbols.name
      LIMIT ?
    `).all(
      value,
      value,
      this.repository.worktreeId,
      value,
      value,
      value,
      limitValue(limit),
    ).map(({ content, ...row }) => ({
      ...evidenceRow({
        ...row,
        line: row.line || firstLine(content || '', row.name),
        lineEnd: row.lineEnd || firstLine(content || '', row.name),
      }),
      exported: Boolean(row.exported),
    }));
  }

  listEdges(query = '', { limit = 20 } = {}) {
    const value = String(query || '').trim();
    return this.database.prepare(`
      SELECT path, kind, sourceSymbol, target, line, metadataJson
      FROM (
        SELECT
          manifest.path,
          edges.kind,
          edges.source_symbol AS sourceSymbol,
          edges.target,
          edges.line,
          edges.metadata_json AS metadataJson,
          edges.edge_index AS edgeIndex
        FROM manifest
        JOIN edges ON edges.parse_key = manifest.parse_key
        WHERE manifest.worktree_id = ?
        UNION ALL
        SELECT
          path_edges.path,
          path_edges.kind,
          path_edges.source_symbol AS sourceSymbol,
          path_edges.target,
          path_edges.line,
          path_edges.metadata_json AS metadataJson,
          path_edges.edge_index AS edgeIndex
        FROM path_edges
        WHERE path_edges.worktree_id = ?
      )
      WHERE ? = ''
        OR instr(lower(COALESCE(sourceSymbol, '')), lower(?)) > 0
        OR instr(lower(target), lower(?)) > 0
        OR instr(lower(path), lower(?)) > 0
      ORDER BY path, edgeIndex
      LIMIT ?
    `).all(
      this.repository.worktreeId,
      this.repository.worktreeId,
      value,
      value,
      value,
      value,
      limitValue(limit),
    ).map(evidenceRow);
  }

  findTests(query, { limit = 20 } = {}) {
    const value = String(query || '').trim();
    if (!value) return [];
    return this.database.prepare(`
      SELECT
        path,
        kind,
        source_symbol AS sourceSymbol,
        target,
        line,
        metadata_json AS metadataJson
      FROM path_edges
      WHERE worktree_id = ?
        AND kind = 'tests'
        AND (
          target = ?
          OR instr(lower(target), lower(?)) > 0
          OR instr(lower(path), lower(?)) > 0
        )
      ORDER BY CASE WHEN target = ? THEN 0 ELSE 1 END, path, line
      LIMIT ?
    `).all(
      this.repository.worktreeId,
      value,
      value,
      value,
      value,
      limitValue(limit),
    ).map(evidenceRow);
  }

  searchText(query, { limit = 20 } = {}) {
    const expression = ftsQuery(query);
    if (!expression) return [];
    return this.database.prepare(`
      SELECT
        path,
        content,
        snippet(documents_fts, 2, '<mark>', '</mark>', '…', 24) AS snippet,
        bm25(documents_fts) AS rank
      FROM documents_fts
      WHERE documents_fts MATCH ? AND worktree_id = ?
      ORDER BY rank, path
      LIMIT ?
    `).all(
      expression,
      this.repository.worktreeId,
      limitValue(limit),
    ).map(({ content, ...row }) => ({
      ...row,
      line: firstLine(content, query),
    }));
  }

  close() {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }
}

function classifyOpenError(error) {
  if (
    error?.errcode === 11
    || error?.errcode === 26
    || /(?:database disk image is malformed|file is not a database|malformed)/i.test(
      error?.message || '',
    )
  ) {
    return fallback('ATLAS_INDEX_CORRUPT', 'Atlas index is corrupt');
  }
  return fallback('ATLAS_INDEX_UNAVAILABLE', error?.message || 'Atlas index is unavailable');
}

export function openAtlasRetrieval(projectRoot, options = {}) {
  assertAtlasRuntime();
  let repository = options.repository;
  if (!repository) {
    try {
      repository = resolveRepositoryIdentity(projectRoot, {
        cacheRoot: options.cacheRoot,
        spawn: options.spawn,
      });
    } catch (error) {
      return fallback('ATLAS_PROJECT_UNAVAILABLE', error.message);
    }
  }
  if (repository.state !== 'ready') {
    return fallback('ATLAS_PROJECT_UNAVAILABLE', repository.reason);
  }

  let cachePath;
  try {
    cachePath = assertSafeAtlasCachePath(repository);
  } catch (error) {
    return fallback('ATLAS_INDEX_UNSAFE', error.message);
  }
  if (!fs.existsSync(cachePath)) {
    return fallback(
      'ATLAS_INDEX_ABSENT',
      'Atlas index does not exist for this repository',
    );
  }
  const stat = fs.lstatSync(cachePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return fallback('ATLAS_INDEX_UNSAFE', 'Atlas index path is not a regular file');
  }

  let database;
  try {
    database = new DatabaseSync(cachePath, { readOnly: true });
    const version = Number(database.prepare('PRAGMA user_version').get().user_version);
    if (version !== ATLAS_SCHEMA_VERSION) {
      database.close();
      return fallback(
        'ATLAS_INDEX_INCOMPATIBLE',
        `Atlas index schema ${version} is incompatible with ${ATLAS_SCHEMA_VERSION}`,
      );
    }
    if (options.verifyIntegrity) {
      options.onIntegrityCheck?.(cachePath);
      const integrity = database.prepare('PRAGMA quick_check').get().quick_check;
      if (integrity !== 'ok') {
        database.close();
        return fallback('ATLAS_INDEX_CORRUPT', 'Atlas index is corrupt');
      }
    }
    const snapshot = snapshotRow(database, repository.worktreeId);
    if (!snapshot) {
      database.close();
      return fallback(
        'ATLAS_INDEX_ABSENT',
        'Atlas index has no snapshot for this worktree',
      );
    }
    const retrieval = new AtlasRetrieval(database, repository, snapshot);
    retrieval.freshness = currentFreshness(repository, snapshot, options);
    return retrieval;
  } catch (error) {
    try {
      database?.close();
    } catch {
      // The primary diagnostic wins.
    }
    return classifyOpenError(error);
  }
}
