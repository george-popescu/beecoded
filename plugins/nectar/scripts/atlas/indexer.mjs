import crypto from "node:crypto";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

import { CONTENT_TIERS } from "./constants.mjs";
import {
  discoverRepository,
  normalizeDiscoveryPolicy,
} from "./discovery.mjs";
import {
  normalizeParserConcurrency,
  parseFilesInWorkerPool,
} from "./parse-worker.mjs";
import {
  attachTestRelationships,
  parserIdentityForPath,
} from "./parsers/index.mjs";
import { createAtlasProgress } from "./progress.mjs";
import { openAtlasStore } from "./store.mjs";
import {
  gitWorktreeState,
  resolveRepositoryIdentity,
} from "./paths.mjs";

function git(root, args, { allowFailure = false, trim = true } = {}) {
  try {
    const output = execFileSync("git", [
      "--no-optional-locks",
      "-c",
      "core.fsmonitor=false",
      ...args,
    ], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return trim ? output.trim() : output;
  } catch (error) {
    if (allowFailure) return null;
    throw error;
  }
}

function changedPathsSince(
  root,
  previousSnapshot,
  repositoryState,
  currentFiles,
) {
  if (!previousSnapshot) {
    return new Set(currentFiles.map((file) => file.path));
  }
  if (previousSnapshot.dirty && !Array.isArray(previousSnapshot.dirtyFiles)) {
    return new Set(currentFiles.map((file) => file.path));
  }
  const changed = new Set([
    ...(previousSnapshot.dirtyFiles || []),
    ...repositoryState.dirtyFiles,
  ]);
  if (previousSnapshot.head !== repositoryState.head) {
    if (!previousSnapshot.head || !repositoryState.head) {
      return new Set(currentFiles.map((file) => file.path));
    }
    const diff = git(
      root,
      [
        "diff",
        "--name-only",
        "-z",
        previousSnapshot.head,
        repositoryState.head,
        "--",
      ],
      { allowFailure: true, trim: false },
    );
    if (diff === null) return new Set(currentFiles.map((file) => file.path));
    for (const filePath of diff.split("\0").filter(Boolean))
      changed.add(filePath);
  }
  return changed;
}

function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function enclosingSymbol(record, call) {
  const candidates = record.symbols
    .filter((symbol) => (
      ["function", "method", "variable"].includes(symbol.kind)
      && Number.isInteger(symbol.startLine)
      && Number.isInteger(symbol.endLine)
      && symbol.startLine <= call.startLine
      && symbol.endLine >= call.endLine
    ))
    .sort((left, right) => (
      (left.endLine - left.startLine) - (right.endLine - right.startLine)
      || right.startLine - left.startLine
      || left.name.localeCompare(right.name)
    ));
  return candidates[0]?.name || null;
}

function storeParseRecord(record) {
  if (!record || record.status !== "parsed") return null;
  const exportsByLocalName = new Map(
    record.exports.map((entry) => [entry.localName || entry.name, entry]),
  );
  return {
    language: record.language,
    parserIdentity: parserIdentityForPath(record.path),
    symbols: record.symbols.map((symbol) => ({
      ...symbol,
      exported: exportsByLocalName.has(symbol.name),
      ...(exportsByLocalName.get(symbol.name)?.qualifiedName
        ? {
            metadata: {
              ...(symbol.metadata || {}),
              qualifiedName: exportsByLocalName.get(symbol.name).qualifiedName,
            },
          }
        : {}),
    })),
    edges: [
      ...record.imports.map((entry) => ({
        kind: "imports",
        target: entry.source,
        line: entry.startLine,
        metadata: { names: entry.names },
      })),
      ...record.calls.map((entry) => ({
        kind: "calls",
        sourceSymbol: enclosingSymbol(record, entry),
        target: entry.name,
        line: entry.startLine,
      })),
      ...record.inheritance.map((entry) => ({
        kind: entry.relation,
        sourceSymbol: entry.symbol,
        target: entry.target,
        line: entry.startLine,
      })),
      ...record.routeHints.map((entry) => ({
        kind: "route",
        sourceSymbol: entry.handler,
        target: `${entry.method} ${entry.path}`,
        line: entry.startLine,
      })),
    ],
  };
}

function pathEdges(record) {
  return (record?.testHints || []).map((entry) => ({
    kind: "tests",
    sourceSymbol: entry.testPath,
    target: entry.sourcePath,
    line: entry.startLine,
  }));
}

function relationshipRecord(file) {
  if (!file.parse) return null;
  return {
    path: file.path,
    language: file.parse.language,
    status: "parsed",
    imports: file.parse.edges
      .filter((edge) => edge.kind === "imports")
      .map((edge) => ({
        source: edge.target,
        names: edge.metadata?.names || [],
        startLine: edge.line,
        endLine: edge.line,
      })),
    exports: file.parse.symbols
      .filter((symbol) => symbol.exported)
      .map((symbol) => ({
        name: symbol.name,
        qualifiedName: symbol.metadata?.qualifiedName,
      })),
    testHints: [],
  };
}

function isTestPath(filePath) {
  return (
    /(?:^|\/)__tests__(?:\/|$)/.test(filePath) ||
    /\.(?:test|spec)\.[^.]+$/i.test(filePath) ||
    /Test\.php$/i.test(filePath)
  );
}

function parseFailure(record) {
  if (!record?.failure) return null;
  return {
    code: "PARSE_ERROR",
    message: record.failure.message,
    details: {
      kind: record.failure.kind,
      startLine: record.failure.startLine,
      endLine: record.failure.endLine,
    },
  };
}

function tierCounts(discovery) {
  const counts = {
    astFts: 0,
    ftsOnly: 0,
    metadataOnly: 0,
    reused: 0,
    skipped: discovery.skipped.length,
    failed: 0,
  };
  for (const file of discovery.files) {
    if (file.tier === CONTENT_TIERS.AST_FTS) counts.astFts += 1;
    if (file.tier === CONTENT_TIERS.FTS_ONLY) counts.ftsOnly += 1;
    if (file.tier === CONTENT_TIERS.METADATA_ONLY) counts.metadataOnly += 1;
  }
  return counts;
}

function manifestMatchesDiscovery(manifest, files) {
  if (manifest.length !== files.length) return false;
  const byPath = new Map(manifest.map((file) => [file.path, file]));
  return files.every((file) => {
    const previous = byPath.get(file.path);
    return (
      previous &&
      previous.size === file.size &&
      previous.tier === file.tier &&
      previous.skipReason === file.skipReason
    );
  });
}

function policiesMatch(left, right) {
  return (
    left?.astMaxBytes === right.astMaxBytes &&
    left?.ftsMaxBytes === right.ftsMaxBytes &&
    left?.sampleBytes === right.sampleBytes
  );
}

export async function indexRepository(projectRoot, options = {}) {
  const startedAt = Date.now();
  const parserConcurrency = normalizeParserConcurrency(
    options.parserConcurrency,
  );
  const progress = createAtlasProgress({ onEvent: options.onEvent });
  let store;
  try {
    progress.update("scanning");
    const repository = resolveRepositoryIdentity(projectRoot, {
      cacheRoot: options.cacheRoot,
    });
    if (repository.state !== "ready") {
      progress.fail(new Error(repository.reason), {
        durationMs: Date.now() - startedAt,
      });
      return {
        state: "fallback",
        reason: repository.reason,
        repository,
      };
    }

    const repositoryState = gitWorktreeState(repository.root);
    store = openAtlasStore(repository, {
      recoverCorrupt: true,
    });
    const recoveredCorrupt = Boolean(store.quarantinePath);
    const previousSnapshot = store.getSnapshot(repository.worktreeId);
    const previousManifest = store.getManifest(repository.worktreeId);
    const policy = normalizeDiscoveryPolicy(options.policy);
    const changedPaths = changedPathsSince(
      repository.root,
      previousSnapshot,
      repositoryState,
      previousManifest,
    );
    for (const file of previousManifest) {
      if (
        file.tier === CONTENT_TIERS.AST_FTS
        && parserIdentityForPath(file.path)
        && !file.parseKey
      ) {
        changedPaths.add(file.path);
      }
    }
    if (previousSnapshot && !policiesMatch(previousSnapshot.policy, policy)) {
      for (const file of previousManifest) changedPaths.add(file.path);
    }
    const discovery = discoverRepository(projectRoot, {
      cacheRoot: options.cacheRoot,
      policy,
      repository,
      previousManifest,
      changedPaths,
    });
    if (discovery.state !== "ready") {
      progress.fail(new Error(discovery.reason), {
        durationMs: Date.now() - startedAt,
      });
      return {
        state: "fallback",
        reason: discovery.reason,
        repository: discovery.repository,
      };
    }

    const total = discovery.files.length + discovery.skipped.length;
    const counts = tierCounts(discovery);
    progress.update("classifying", {
      completed: total,
      total,
      counts,
    });

    const isWarmNoOp =
      previousSnapshot &&
      previousSnapshot.worktreeFingerprint ===
        repositoryState.worktreeFingerprint &&
      previousSnapshot.head === repositoryState.head &&
      previousSnapshot.branch === repositoryState.branch &&
      policiesMatch(previousSnapshot.policy, policy) &&
      manifestMatchesDiscovery(previousManifest, discovery.files);
    if (isWarmNoOp) {
      counts.reused = discovery.files.length;
      progress.update("parsing", { counts });
      progress.update("graph", { counts });
      progress.update("persistence", { counts });
      store.close();
      const durationMs = Date.now() - startedAt;
      const terminal = progress.complete({
        counts,
        commit: repositoryState.head,
        dirtyFiles: repositoryState.dirtyFiles,
        durationMs,
      });
      return {
        state: "indexed",
        repository: discovery.repository,
        writeResult: {
          filesWritten: 0,
          filesDeleted: 0,
          parseRecordsCreated: 0,
          parseRecordsReused: discovery.files.length,
          batchSizes: [],
        },
        summary: {
          cold: false,
          commit: repositoryState.head,
          branch: repositoryState.branch,
          dirtyFiles: repositoryState.dirtyFiles,
          durationMs,
          counts: terminal.counts,
          parserConcurrency,
          parserWorkerThreadIds: [],
          recoveredCorrupt,
        },
      };
    }

    const indexedFiles = [];
    const parserInputs = [];
    const reusableFiles = new Map(
      store.getStoredFilesForRelationships(discovery.repository.worktreeId)
        .map((file) => [file.path, file]),
    );
    const changedFilePaths = new Set();
    const previousByPath = new Map(
      previousManifest.map((file) => [file.path, file]),
    );
    for (const file of discovery.files) {
      const previous = previousByPath.get(file.path);
      const reusable =
        previous &&
        !changedPaths.has(file.path) &&
        previous.size === file.size &&
        previous.tier === file.tier &&
        previous.skipReason === file.skipReason;
      if (reusable) {
        const stored = reusableFiles.get(file.path);
        if (stored) {
          indexedFiles.push(stored);
          counts.reused += 1;
          continue;
        }
      }

      changedFilePaths.add(file.path);
      const indexed = {
        path: file.path,
        size: file.size,
        tier: file.tier,
        skipReason: file.skipReason,
        contentHash: null,
      };
      if (file.tier !== CONTENT_TIERS.METADATA_ONLY) {
        const content = (options.readFile || fs.readFileSync)(
          file.absolutePath,
          "utf8",
        );
        indexed.contentHash = hashContent(content);
        indexed.text = content;
        if (file.tier === CONTENT_TIERS.AST_FTS) {
          const parserIdentity = parserIdentityForPath(file.path);
          const cachedParse =
            parserIdentity && !isTestPath(file.path)
              ? store.getParseRecord(indexed.contentHash, parserIdentity)
              : null;
          if (cachedParse) {
            indexed.parse = cachedParse;
            counts.reused += 1;
          } else {
            parserInputs.push({
              path: file.path,
              tier: file.tier,
              content,
            });
          }
        }
      }
      indexedFiles.push(indexed);
    }

    const parserRun = await parseFilesInWorkerPool(parserInputs, {
      concurrency: parserConcurrency,
    });
    const parseRecords = parserRun.records;
    const recordsByPath = new Map(
      parseRecords.map((record) => [record.path, record]),
    );
    for (const file of indexedFiles) {
      const record = recordsByPath.get(file.path);
      const parse = storeParseRecord(record);
      if (parse && !file.parse) file.parse = parse;
      const failure = parseFailure(record);
      if (failure) {
        file.failure = failure;
        counts.failed += 1;
      }
    }
    const relationshipRecords = indexedFiles
      .map(relationshipRecord)
      .filter(Boolean);
    attachTestRelationships(relationshipRecords);
    const relationshipsByPath = new Map(
      relationshipRecords.map((record) => [record.path, pathEdges(record)]),
    );
    for (const file of indexedFiles) {
      const relationships = relationshipsByPath.get(file.path) || [];
      if (relationships.length) file.pathEdges = relationships;
      else delete file.pathEdges;
    }
    progress.update("parsing", { counts });
    progress.update("graph", { counts });

    const finalRepositoryState = gitWorktreeState(repository.root);
    if (
      finalRepositoryState.worktreeFingerprint !==
        repositoryState.worktreeFingerprint
    ) {
      const error = new Error(
        "Git worktree changed while Atlas was building the snapshot",
      );
      error.code = "ATLAS_WORKTREE_CHANGED_DURING_INDEX";
      throw error;
    }

    let writeResult;
    try {
      writeResult = store.writeSnapshot(
        {
          worktreeId: discovery.repository.worktreeId,
          head: repositoryState.head,
          branch: repositoryState.branch,
          dirty: repositoryState.dirty,
          dirtyFiles: repositoryState.dirtyFiles,
          worktreeFingerprint: repositoryState.worktreeFingerprint,
          policy: discovery.policy,
          files: indexedFiles,
        },
        {
          batchSize: options.batchSize,
          incremental: Boolean(previousSnapshot),
          changedPaths: [...changedFilePaths],
        },
      );
    } finally {
      store.close();
    }
    progress.update("persistence", { counts });

    const durationMs = Date.now() - startedAt;
    const terminal = progress.complete({
      counts,
      commit: repositoryState.head,
      dirtyFiles: repositoryState.dirtyFiles,
      durationMs,
    });
    return {
      state: "indexed",
      repository: discovery.repository,
      writeResult,
      summary: {
        cold: !previousSnapshot,
        commit: repositoryState.head,
        branch: repositoryState.branch,
        dirtyFiles: repositoryState.dirtyFiles,
        durationMs,
        counts: terminal.counts,
        parserConcurrency: parserRun.concurrency,
        parserWorkerThreadIds: parserRun.threadIds,
        recoveredCorrupt,
      },
    };
  } catch (error) {
    store?.close();
    progress.fail(error, {
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}
