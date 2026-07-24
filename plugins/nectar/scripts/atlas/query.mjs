import { openAtlasRetrieval } from './retrieval-store.mjs';

export const ATLAS_OPERATIONS = Object.freeze([
  'overview',
  'find-symbol',
  'find-related',
  'trace-flow',
  'find-tests',
  'context-for-task',
]);

const OPERATION_SET = new Set(ATLAS_OPERATIONS);
const DEFAULT_BUDGET = 6_000;
const MAX_BUDGET = 100_000;

function codedTypeError(code, message) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

function validateOperation(operation) {
  if (!OPERATION_SET.has(operation)) {
    throw codedTypeError(
      'ATLAS_INVALID_OPERATION',
      `Unknown Atlas operation: ${operation || ''}`,
    );
  }
  return operation;
}

function validateBudget(value = DEFAULT_BUDGET) {
  if (!Number.isInteger(value) || value <= 0 || !Number.isFinite(value)) {
    throw codedTypeError(
      'ATLAS_INVALID_BUDGET',
      'Atlas packet budget must be a positive finite integer',
    );
  }
  return Math.min(value, MAX_BUDGET);
}

function validateLimit(value = 20) {
  if (!Number.isInteger(value) || value <= 0 || !Number.isFinite(value)) {
    throw codedTypeError(
      'ATLAS_INVALID_LIMIT',
      'Atlas result limit must be a positive finite integer',
    );
  }
  return Math.min(value, 100);
}

function words(value) {
  return String(value || '')
    .normalize('NFKC')
    .match(/[\p{L}\p{N}_./-]+/gu)
    ?.filter((word) => word.length > 1)
    .slice(0, 12) || [];
}

function cleanSnippet(value) {
  if (typeof value !== 'string') return undefined;
  return value.replaceAll(/[\r\n\t]+/g, ' ').replaceAll(/\s+/g, ' ').trim().slice(0, 240);
}

function pathEvidence(entry) {
  return {
    path: entry.path,
    line: entry.line || 1,
    lineEnd: entry.line || 1,
    kind: 'path',
    name: entry.path,
    reason: entry.match === 'exact' ? 'exact-path' : 'path-match',
    confidence: entry.match === 'exact' ? 'high' : 'medium',
    score: entry.match === 'exact' ? 110 : 75,
  };
}

function manifestEvidence(entry) {
  return {
    path: entry.path,
    line: 1,
    lineEnd: 1,
    kind: 'file',
    name: entry.path,
    reason: 'project-file',
    confidence: 'medium',
    score: 60 - Math.min(entry.path.split('/').length, 20),
  };
}

function symbolEvidence(entry) {
  const exact = entry.match === 'exact';
  return {
    path: entry.path,
    line: entry.line || 1,
    lineEnd: entry.lineEnd || entry.line || 1,
    kind: entry.kind || 'symbol',
    name: entry.name,
    exported: Boolean(entry.exported),
    reason: exact ? 'exact-symbol' : 'symbol-match',
    confidence: exact ? 'high' : 'medium',
    score: exact ? 120 : entry.match === 'case-insensitive' ? 105 : 85,
  };
}

function edgeEvidence(entry) {
  return {
    path: entry.path,
    line: entry.line || 1,
    lineEnd: entry.line || 1,
    kind: 'relation',
    relation: entry.kind,
    ...(entry.sourceSymbol ? { name: entry.sourceSymbol } : {}),
    target: entry.target,
    reason: 'graph-relation',
    confidence: 'high',
    score: entry.kind === 'tests' ? 100 : 95,
  };
}

function lexicalEvidence(entry) {
  return {
    path: entry.path,
    line: entry.line || 1,
    lineEnd: entry.line || 1,
    kind: 'text',
    snippet: cleanSnippet(entry.snippet),
    reason: 'fts-match',
    confidence: 'low',
    score: 45,
  };
}

function evidenceKey(entry) {
  return [
    entry.path,
    entry.line,
    entry.kind,
    entry.relation || '',
    entry.name || '',
    entry.target || '',
  ].join('\0');
}

function compareEvidence(left, right) {
  return right.score - left.score
    || left.path.localeCompare(right.path)
    || left.line - right.line
    || left.kind.localeCompare(right.kind)
    || String(left.name || left.target || '').localeCompare(
      String(right.name || right.target || ''),
    );
}

function deduplicate(entries) {
  const selected = new Map();
  for (const entry of entries) {
    const key = evidenceKey(entry);
    const previous = selected.get(key);
    if (!previous || compareEvidence(entry, previous) < 0) selected.set(key, entry);
  }
  return [...selected.values()].sort(compareEvidence);
}

function boundedSource(load, limit) {
  const rows = load(Math.min(limit + 1, 101));
  return {
    rows: rows.slice(0, limit),
    truncated: rows.length > limit,
  };
}

function collection(entries = [], upstreamTruncated = false) {
  return { entries, upstreamTruncated };
}

function mergeCollections(...sources) {
  return collection(
    sources.flatMap((source) => source.entries),
    sources.some((source) => source.upstreamTruncated),
  );
}

function overview(retrieval, limit) {
  const source = boundedSource(
    (sourceLimit) => retrieval.manifest({ limit: sourceLimit }),
    limit,
  );
  return collection(source.rows.map(manifestEvidence), source.truncated);
}

function findSymbol(retrieval, query, limit) {
  const paths = boundedSource(
    (sourceLimit) => retrieval.findPaths(query, { limit: sourceLimit }),
    limit,
  );
  const symbols = boundedSource(
    (sourceLimit) => retrieval.findSymbols(query, { limit: sourceLimit }),
    limit,
  );
  const lexical = boundedSource(
    (sourceLimit) => retrieval.searchText(query, { limit: sourceLimit }),
    limit,
  );
  return mergeCollections(
    collection(paths.rows.map(pathEvidence), paths.truncated),
    collection(symbols.rows.map(symbolEvidence), symbols.truncated),
    collection(lexical.rows.map(lexicalEvidence), lexical.truncated),
  );
}

function related(retrieval, query, limit) {
  const base = findSymbol(retrieval, query, limit);
  const edgeLimit = Math.min(limit * 3, 100);
  const edges = boundedSource(
    (sourceLimit) => retrieval.listEdges(query, { limit: sourceLimit }),
    edgeLimit,
  );
  return mergeCollections(
    base,
    collection(edges.rows.map(edgeEvidence), edges.truncated),
  );
}

function traceFlow(retrieval, query, limit) {
  let frontier = words(query);
  const visited = new Set();
  const chosen = [];
  let upstreamTruncated = false;
  for (let depth = 0; depth < 3 && frontier.length > 0; depth += 1) {
    const next = [];
    for (const term of frontier) {
      const normalizedTerm = term.toLocaleLowerCase();
      if (visited.has(normalizedTerm)) continue;
      if (visited.size >= 40) {
        upstreamTruncated = true;
        continue;
      }
      visited.add(normalizedTerm);
      const edgeLimit = Math.min(Math.max(limit * 4, 20), 100);
      const matches = boundedSource(
        (sourceLimit) => retrieval.listEdges(term, { limit: sourceLimit }),
        edgeLimit,
      );
      upstreamTruncated ||= matches.truncated;
      for (const edge of matches.rows) {
        chosen.push(edgeEvidence(edge));
        for (const word of words(`${edge.sourceSymbol || ''} ${edge.target}`)) {
          const normalized = word.toLocaleLowerCase();
          if (!visited.has(normalized)) next.push(word);
        }
      }
    }
    const uniqueNext = [...new Set(next)];
    const remainingTerms = Math.max(40 - visited.size, 0);
    if (uniqueNext.length > remainingTerms) upstreamTruncated = true;
    frontier = uniqueNext.slice(0, remainingTerms);
  }
  if (frontier.length > 0) upstreamTruncated = true;
  const symbols = boundedSource(
    (sourceLimit) => retrieval.findSymbols(query, { limit: sourceLimit }),
    limit,
  );
  const lexical = boundedSource(
    (sourceLimit) => retrieval.searchText(query, { limit: sourceLimit }),
    limit,
  );
  return mergeCollections(
    collection(symbols.rows.map(symbolEvidence), symbols.truncated),
    collection(chosen, upstreamTruncated),
    collection(lexical.rows.map(lexicalEvidence), lexical.truncated),
  );
}

function findTests(retrieval, query, limit) {
  const pathMatches = boundedSource(
    (sourceLimit) => retrieval.findPaths(query, { limit: sourceLimit }),
    limit,
  );
  const symbolMatches = boundedSource(
    (sourceLimit) => retrieval.findSymbols(query, { limit: sourceLimit }),
    limit,
  );
  const paths = new Set([
    query,
    ...pathMatches.rows.map((entry) => entry.path),
    ...symbolMatches.rows.map((entry) => entry.path),
  ].filter(Boolean));
  const entries = [];
  let upstreamTruncated = pathMatches.truncated || symbolMatches.truncated;
  for (const filePath of paths) {
    const tests = boundedSource(
      (sourceLimit) => retrieval.findTests(filePath, { limit: sourceLimit }),
      limit,
    );
    entries.push(...tests.rows.map(edgeEvidence));
    upstreamTruncated ||= tests.truncated;
  }
  const lexical = boundedSource(
    (sourceLimit) => retrieval.searchText(query, { limit: sourceLimit }),
    limit,
  );
  return mergeCollections(
    collection(entries, upstreamTruncated),
    collection(lexical.rows.map(lexicalEvidence), lexical.truncated),
  );
}

function contextForTask(retrieval, query, limit) {
  const entries = [];
  let upstreamTruncated = false;
  const terms = words(query);
  for (const term of terms) {
    for (const [load, map] of [
      [(sourceLimit) => retrieval.findPaths(term, { limit: sourceLimit }), pathEvidence],
      [(sourceLimit) => retrieval.findSymbols(term, { limit: sourceLimit }), symbolEvidence],
      [(sourceLimit) => retrieval.listEdges(term, { limit: sourceLimit }), edgeEvidence],
      [(sourceLimit) => retrieval.findTests(term, { limit: sourceLimit }), edgeEvidence],
    ]) {
      const source = boundedSource(load, limit);
      entries.push(...source.rows.map(map));
      upstreamTruncated ||= source.truncated;
    }
  }
  const lexical = boundedSource(
    (sourceLimit) => retrieval.searchText(query, { limit: sourceLimit }),
    limit,
  );
  entries.push(...lexical.rows.map(lexicalEvidence));
  return collection(entries, upstreamTruncated || lexical.truncated);
}

function operationEvidence(retrieval, operation, query, limit) {
  if (operation === 'overview') return overview(retrieval, limit);
  if (operation === 'find-symbol') return findSymbol(retrieval, query, limit);
  if (operation === 'find-related') return related(retrieval, query, limit);
  if (operation === 'trace-flow') return traceFlow(retrieval, query, limit);
  if (operation === 'find-tests') return findTests(retrieval, query, limit);
  return contextForTask(retrieval, query, limit);
}

function fallbackPacket(operation, query, budget, diagnostic) {
  return {
    schema: 1,
    state: 'fallback',
    operation,
    query,
    fallback: true,
    snapshot: null,
    freshness: null,
    evidence: [],
    truncated: false,
    omitted: 0,
    omittedIsLowerBound: false,
    budget: { characters: budget, used: 0 },
    diagnostic,
  };
}

function applyBudget(entries, budget, limit, onEvidence) {
  const evidence = [];
  let used = 0;
  for (const entry of entries) {
    if (evidence.length >= limit) break;
    const { score: _rankingScore, ...publicEntry } = entry;
    const size = JSON.stringify(publicEntry).length;
    if (used + size > budget) break;
    evidence.push(publicEntry);
    used += size;
    onEvidence?.(publicEntry, evidence.length - 1);
  }
  return {
    evidence,
    used,
    omitted: entries.length - evidence.length,
    truncated: evidence.length < entries.length,
  };
}

export function queryAtlas(projectRoot, options = {}) {
  const operation = validateOperation(options.operation);
  const query = String(options.query || '').trim();
  const budget = validateBudget(options.budget);
  const limit = validateLimit(options.limit);
  const retrieval = openAtlasRetrieval(projectRoot, {
    cacheRoot: options.cacheRoot,
    repository: options.repository,
    spawn: options.spawn,
  });
  if (retrieval.state !== 'ready') {
    return fallbackPacket(operation, query, budget, {
      code: retrieval.code,
      reason: retrieval.reason,
    });
  }

  try {
    if (retrieval.freshness.state !== 'fresh') {
      return fallbackPacket(operation, query, budget, {
        code: 'ATLAS_INDEX_STALE',
        reason: retrieval.freshness.reason,
      });
    }
    const operationResult = operationEvidence(retrieval, operation, query, limit);
    const candidates = deduplicate(operationResult.entries);
    const bounded = applyBudget(candidates, budget, limit, options.onEvidence);
    const upstreamOmitted = operationResult.upstreamTruncated ? 1 : 0;
    return {
      schema: 1,
      state: 'ready',
      operation,
      query,
      fallback: false,
      snapshot: {
        repositoryId: retrieval.repository.repositoryId,
        worktreeId: retrieval.repository.worktreeId,
        head: retrieval.snapshot.head,
        branch: retrieval.snapshot.branch,
        updatedAt: retrieval.snapshot.updatedAt,
      },
      freshness: retrieval.freshness,
      evidence: bounded.evidence,
      truncated: bounded.truncated || operationResult.upstreamTruncated,
      omitted: bounded.omitted + upstreamOmitted,
      omittedIsLowerBound: operationResult.upstreamTruncated,
      budget: {
        characters: budget,
        used: bounded.used,
      },
      diagnostic: null,
    };
  } finally {
    retrieval.close();
  }
}
