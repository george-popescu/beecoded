import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { openAtlasStore } from "./store.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(currentDirectory, "../..");

function git(root, ...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function repositoryFixture(t, files = {}) {
  const parent = fs.mkdtempSync(
    path.join(os.tmpdir(), "nectar-atlas-indexer-"),
  );
  const root = path.join(parent, "repository");
  const cacheRoot = path.join(parent, "cache");
  fs.mkdirSync(root);
  git(root, "init", "--quiet");
  git(root, "config", "user.name", "Nectar Tests");
  git(root, "config", "user.email", "nectar@example.invalid");
  write(root, ".gitignore", "*.ignored\n");
  for (const [relativePath, content] of Object.entries(files)) {
    write(root, relativePath, content);
  }
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "fixture");
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { parent, root, cacheRoot };
}

async function loadIndexer() {
  try {
    return await import("./indexer.mjs");
  } catch (error) {
    assert.fail(
      `Atlas index orchestrator is not implemented: ${error.message}`,
    );
  }
}

test("cold index persists adaptive content, symbols, graph, and progress outside the repository", async (t) => {
  const { root, cacheRoot } = repositoryFixture(t, {
    "src/service.ts": [
      "export class Service {",
      "  run() { return true; }",
      "}",
      "",
    ].join("\n"),
    "src/controller.ts": [
      "import { Service } from './service';",
      "export function controller() {",
      "  return new Service().run();",
      "}",
      "",
    ].join("\n"),
    "docs/medium.txt": `${"searchable atlas phrase\n".repeat(40)}x`,
    "docs/huge.txt": `${"metadata only\n".repeat(100)}x`,
  });
  const beforeStatus = git(root, "status", "--short");
  const events = [];
  const { indexRepository } = await loadIndexer();

  const result = await indexRepository(root, {
    cacheRoot,
    policy: {
      astMaxBytes: 512,
      ftsMaxBytes: 1_024,
    },
    onEvent(event) {
      events.push(event);
    },
  });

  assert.equal(result.state, "indexed");
  assert.equal(result.summary.cold, true);
  assert.equal(result.summary.counts.astFts >= 2, true);
  assert.equal(result.summary.counts.ftsOnly >= 1, true);
  assert.equal(result.summary.counts.metadataOnly >= 1, true);
  assert.equal(events.at(-1).terminal, true);
  assert.equal(events.at(-1).summary.status, "complete");
  assert.equal(git(root, "status", "--short"), beforeStatus);
  assert.equal(fs.existsSync(path.join(root, ".atlas")), false);

  const store = openAtlasStore(root, { cacheRoot });
  t.after(() => store.close());
  const manifest = store.getManifest(result.repository.worktreeId);
  assert.equal(
    manifest.some((file) => file.path === "src/controller.ts"),
    true,
  );
  assert.equal(
    store
      .search("searchable", { worktreeId: result.repository.worktreeId })
      .some((match) => match.path === "docs/medium.txt"),
    true,
  );
  assert.equal(
    store
      .listEdges(result.repository.worktreeId)
      .some(
        (edge) =>
          edge.path === "src/controller.ts" && edge.target === "./service",
      ),
    true,
  );
});

test("indexes anonymous PHP classes without persisting unnamed identities", async (t) => {
  const { root, cacheRoot } = repositoryFixture(t, {
    "app/Facades/Sms.php": [
      "<?php",
      "use App\\Contracts\\BaseFake;",
      "$plain = new class {",
      "    public function run() { return plainHelper(); }",
      "};",
      "$extended = new class extends BaseFake {",
      "    public function run() { return extendedHelper(); }",
      "};",
      "",
    ].join("\n"),
  });
  const { indexRepository } = await loadIndexer();

  const result = await indexRepository(root, { cacheRoot });

  assert.equal(result.state, "indexed");
  const store = openAtlasStore(root, { cacheRoot });
  t.after(() => store.close());
  const stored = store.getStoredFile(
    result.repository.worktreeId,
    "app/Facades/Sms.php",
  );
  assert.deepEqual(stored.parse.symbols, []);
  assert.deepEqual(
    stored.parse.edges.map((edge) => ({
      kind: edge.kind,
      target: edge.target,
    })),
    [
      {
        kind: "imports",
        target: "App\\Contracts\\BaseFake",
      },
      {
        kind: "calls",
        target: "plainHelper",
      },
      {
        kind: "calls",
        target: "extendedHelper",
      },
    ],
  );
});

test("warm no-op index performs zero content reads and preserves the stored snapshot", async (t) => {
  const { root, cacheRoot } = repositoryFixture(t, {
    "src/service.ts": "export const warmSnapshotToken = true;\n",
  });
  const { indexRepository } = await loadIndexer();
  const cold = await indexRepository(root, { cacheRoot });

  let contentReads = 0;
  const openedProjectFiles = [];
  const realRoot = fs.realpathSync(root);
  const originalOpenSync = fs.openSync;
  fs.openSync = function trackedOpenSync(filePath, ...args) {
    if (
      typeof filePath === "string" &&
      path.relative(realRoot, path.resolve(filePath)) === "src/service.ts"
    ) {
      openedProjectFiles.push(filePath);
    }
    return originalOpenSync.call(this, filePath, ...args);
  };
  let warm;
  try {
    warm = await indexRepository(root, {
      cacheRoot,
      readFile() {
        contentReads += 1;
        assert.fail("unchanged warm files must not be opened");
      },
    });
  } finally {
    fs.openSync = originalOpenSync;
  }

  assert.equal(warm.state, "indexed");
  assert.equal(warm.summary.cold, false);
  assert.equal(warm.summary.counts.reused, cold.writeResult.filesWritten);
  assert.equal(contentReads, 0);
  assert.deepEqual(openedProjectFiles, []);

  const store = openAtlasStore(root, { cacheRoot });
  t.after(() => store.close());
  assert.equal(
    store.search("warmSnapshotToken", {
      worktreeId: warm.repository.worktreeId,
    }).length,
    1,
  );
});

test("incremental index reads only changed and added content while cleaning deletes and renames", async (t) => {
  const { root, cacheRoot } = repositoryFixture(t, {
    "src/changed.ts": 'export const changedToken = "before";\n',
    "src/unchanged.ts": "export const durableUnchangedToken = true;\n",
    "src/deleted.ts": "export const deletedToken = true;\n",
    "src/renamed.ts": "export const renamedToken = true;\n",
  });
  const { indexRepository } = await loadIndexer();
  await indexRepository(root, { cacheRoot });

  write(root, "src/changed.ts", 'export const changedToken = "after";\n');
  write(root, "src/untracked.ts", "export const untrackedToken = true;\n");
  fs.rmSync(path.join(root, "src/deleted.ts"));
  fs.renameSync(
    path.join(root, "src/renamed.ts"),
    path.join(root, "src/moved.ts"),
  );
  const readPaths = [];
  const realRoot = fs.realpathSync(root);

  const result = await indexRepository(root, {
    cacheRoot,
    readFile(absolutePath, encoding) {
      readPaths.push(
        path.relative(realRoot, absolutePath).split(path.sep).join("/"),
      );
      return fs.readFileSync(absolutePath, encoding);
    },
  });

  assert.equal(result.summary.cold, false);
  assert.deepEqual(readPaths.sort(), [
    "src/changed.ts",
    "src/moved.ts",
    "src/untracked.ts",
  ]);
  assert.equal(result.writeResult.filesWritten, 3);
  assert.equal(result.writeResult.filesDeleted, 2);
  assert.equal(result.summary.counts.reused >= 2, true);

  const store = openAtlasStore(root, { cacheRoot });
  t.after(() => store.close());
  const paths = store
    .getManifest(result.repository.worktreeId)
    .map((file) => file.path);
  assert.equal(paths.includes("src/deleted.ts"), false);
  assert.equal(paths.includes("src/renamed.ts"), false);
  assert.equal(paths.includes("src/moved.ts"), true);
  assert.equal(
    store.search("durableUnchangedToken", {
      worktreeId: result.repository.worktreeId,
    }).length,
    1,
  );
});

test("consecutive identical dirty snapshots are no-ops and reverted paths refresh", async (t) => {
  const original = 'export const dirtySnapshotToken = "original";\n';
  const changed = 'export const dirtySnapshotToken = "changed!";\n';
  const { root, cacheRoot } = repositoryFixture(t, {
    "src/changed.ts": original,
    "src/unchanged.ts": "export const dirtyUnchangedToken = true;\n",
  });
  const { indexRepository } = await loadIndexer();
  await indexRepository(root, { cacheRoot });

  write(root, "src/changed.ts", changed);
  await indexRepository(root, { cacheRoot });

  const realRoot = fs.realpathSync(root);
  const secondDirtyReads = [];
  await indexRepository(root, {
    cacheRoot,
    readFile(absolutePath, encoding) {
      secondDirtyReads.push(
        path.relative(realRoot, absolutePath).split(path.sep).join("/"),
      );
      return fs.readFileSync(absolutePath, encoding);
    },
  });
  assert.deepEqual(secondDirtyReads, []);

  write(root, "src/changed.ts", original);
  const revertedReads = [];
  const reverted = await indexRepository(root, {
    cacheRoot,
    readFile(absolutePath, encoding) {
      revertedReads.push(
        path.relative(realRoot, absolutePath).split(path.sep).join("/"),
      );
      return fs.readFileSync(absolutePath, encoding);
    },
  });
  assert.deepEqual(revertedReads, ["src/changed.ts"]);

  const store = openAtlasStore(root, { cacheRoot });
  t.after(() => store.close());
  assert.equal(
    store.search("original", { worktreeId: reverted.repository.worktreeId })
      .length,
    1,
  );
  assert.equal(
    store.search("changed", { worktreeId: reverted.repository.worktreeId })
      .length,
    0,
  );
});

test("stores a stable content-sensitive fingerprint for dirty snapshots", async (t) => {
  const { root, cacheRoot } = repositoryFixture(t, {
    "src/service.ts": "export const fingerprintToken = 'clean';\n",
  });
  const { indexRepository } = await loadIndexer();
  write(root, "src/service.ts", "export const fingerprintToken = 'dirty';\n");

  const first = await indexRepository(root, { cacheRoot });
  const store = openAtlasStore(root, { cacheRoot });
  const firstSnapshot = store.getSnapshot(first.repository.worktreeId);
  store.close();

  assert.equal(firstSnapshot.dirty, true);
  assert.equal(typeof firstSnapshot.worktreeFingerprint, "string");
  assert.ok(firstSnapshot.worktreeFingerprint.length > 0);

  const second = await indexRepository(root, { cacheRoot });
  const reopened = openAtlasStore(root, { cacheRoot });
  t.after(() => reopened.close());
  assert.equal(
    reopened.getSnapshot(second.repository.worktreeId).worktreeFingerprint,
    firstSnapshot.worktreeFingerprint,
  );
});

test("persists enclosing callable ownership on call graph edges", async (t) => {
  const { root, cacheRoot } = repositoryFixture(t, {
    "src/flow.ts": [
      "export function Caller() { return Callee(); }",
      "export function Callee() { return true; }",
      "",
    ].join("\n"),
  });
  const { indexRepository } = await loadIndexer();
  const result = await indexRepository(root, { cacheRoot });

  const store = openAtlasStore(root, { cacheRoot });
  t.after(() => store.close());
  assert.ok(store.listEdges(result.repository.worktreeId).some((edge) => (
    edge.kind === "calls"
    && edge.sourceSymbol === "Caller"
    && edge.target === "Callee"
  )));
});

test("reparses unchanged AST files after the v7 cache invalidation migration", async (t) => {
  const { root, cacheRoot } = repositoryFixture(t, {
    "src/migrated.ts": "export function MigratedSymbol() { return true; }\n",
  });
  const { indexRepository } = await loadIndexer();
  const initial = await indexRepository(root, { cacheRoot });
  const database = new DatabaseSync(initial.repository.cachePath);
  database.exec("PRAGMA user_version = 6");
  database.close();

  const refreshed = await indexRepository(root, { cacheRoot });
  const store = openAtlasStore(root, { cacheRoot });
  t.after(() => store.close());
  const migrated = store.getStoredFile(
    refreshed.repository.worktreeId,
    "src/migrated.ts",
  );

  assert.equal(refreshed.writeResult.parseRecordsCreated >= 1, true);
  assert.equal(migrated.parse.symbols[0].name, "MigratedSymbol");
});

test("real Git worktrees keep separate manifests in one repository cache and reuse parsed content", async (t) => {
  const { parent, root, cacheRoot } = repositoryFixture(t, {
    "src/shared.ts": "export class SharedAcrossWorktrees {}\n",
  });
  const linkedWorktree = path.join(parent, "linked-worktree");
  git(
    root,
    "worktree",
    "add",
    "--quiet",
    "-b",
    "linked-branch",
    linkedWorktree,
  );
  const { indexRepository } = await loadIndexer();

  const primary = await indexRepository(root, { cacheRoot });
  const linked = await indexRepository(linkedWorktree, { cacheRoot });

  assert.notEqual(primary.repository.worktreeId, linked.repository.worktreeId);
  assert.equal(primary.repository.cachePath, linked.repository.cachePath);
  assert.equal(linked.writeResult.parseRecordsReused >= 1, true);

  const store = openAtlasStore(root, { cacheRoot });
  t.after(() => store.close());
  assert.equal(
    store.getManifest(primary.repository.worktreeId).length > 0,
    true,
  );
  assert.equal(
    store.getManifest(linked.repository.worktreeId).length > 0,
    true,
  );
  assert.equal(store.counts().parseRecords >= 1, true);
});

test("branch switch reindexes same-size committed changes without reopening unchanged files", async (t) => {
  const { root, cacheRoot } = repositoryFixture(t, {
    "src/changed.ts": 'export const branchToken = "before";\n',
    "src/unchanged.ts": "export const branchUnchangedToken = true;\n",
  });
  const { indexRepository } = await loadIndexer();
  await indexRepository(root, { cacheRoot });

  git(root, "checkout", "--quiet", "-b", "alternate");
  write(root, "src/changed.ts", 'export const branchToken = "after!";\n');
  git(root, "add", "src/changed.ts");
  git(root, "commit", "--quiet", "-m", "same-size branch change");
  const readPaths = [];
  const realRoot = fs.realpathSync(root);

  const result = await indexRepository(root, {
    cacheRoot,
    readFile(absolutePath, encoding) {
      readPaths.push(
        path.relative(realRoot, absolutePath).split(path.sep).join("/"),
      );
      return fs.readFileSync(absolutePath, encoding);
    },
  });

  assert.equal(result.summary.cold, false);
  assert.equal(result.summary.branch, "alternate");
  assert.deepEqual(readPaths, ["src/changed.ts"]);
  const store = openAtlasStore(root, { cacheRoot });
  t.after(() => store.close());
  assert.equal(
    store.search("after", { worktreeId: result.repository.worktreeId }).length,
    1,
  );
  assert.deepEqual(
    store.search("before", { worktreeId: result.repository.worktreeId }),
    [],
  );
});

test("a discovery policy change invalidates reused file classifications", async (t) => {
  const { root, cacheRoot } = repositoryFixture(t, {
    "docs/policy.txt": `${"policy token\n".repeat(20)}x`,
  });
  const { indexRepository } = await loadIndexer();
  await indexRepository(root, {
    cacheRoot,
    policy: {
      astMaxBytes: 1_024,
      ftsMaxBytes: 2_048,
    },
  });

  const changedPolicy = await indexRepository(root, {
    cacheRoot,
    policy: {
      astMaxBytes: 64,
      ftsMaxBytes: 1_024,
    },
  });

  assert.equal(changedPolicy.writeResult.filesWritten > 0, true);
  const store = openAtlasStore(root, { cacheRoot });
  t.after(() => store.close());
  assert.equal(
    store
      .getManifest(changedPolicy.repository.worktreeId)
      .find((file) => file.path === "docs/policy.txt").tier,
    "fts-only",
  );
});

test("parser worker pool uses real worker threads and enforces the adaptive concurrency ceiling", async (t) => {
  const files = Object.fromEntries(
    Array.from({ length: 8 }, (_, index) => [
      `src/worker-${index}.ts`,
      `export const workerToken${index} = ${index};\n`,
    ]),
  );
  const { root, cacheRoot } = repositoryFixture(t, files);
  const { indexRepository } = await loadIndexer();
  const expectedConcurrency = Math.min(
    4,
    Math.max(1, os.availableParallelism() - 1),
  );

  const result = await indexRepository(root, {
    cacheRoot,
    parserConcurrency: 99,
  });

  assert.equal(result.summary.parserConcurrency, expectedConcurrency);
  assert.equal(result.summary.parserWorkerThreadIds.length > 0, true);
  assert.equal(
    result.summary.parserWorkerThreadIds.length <= expectedConcurrency,
    true,
  );
  assert.equal(
    result.summary.parserWorkerThreadIds.every(
      (threadId) => Number.isInteger(threadId) && threadId > 0,
    ),
    true,
  );
});

test("worker-parsed source and test files retain their cross-file test relationship", async (t) => {
  const { root, cacheRoot } = repositoryFixture(t, {
    "src/service.ts": "export function linkedService() { return true; }\n",
    "src/service.test.ts": [
      "import { linkedService } from './service';",
      "linkedService();",
      "",
    ].join("\n"),
  });
  const { indexRepository } = await loadIndexer();
  const result = await indexRepository(root, { cacheRoot });

  const store = openAtlasStore(root, { cacheRoot });
  t.after(() => store.close());
  assert.equal(
    store
      .listEdges(result.repository.worktreeId)
      .some(
        (edge) =>
          edge.kind === "tests" &&
          edge.path === "src/service.test.ts" &&
          edge.target === "src/service.ts",
      ),
    true,
  );
});

test("persists aliased and reference-default JavaScript symbols as exported", async (t) => {
  const { root, cacheRoot } = repositoryFixture(t, {
    "src/exports.js": [
      "const aliasedLocal = true;",
      "const defaultLocal = true;",
      "export { aliasedLocal as publicAlias };",
      "export default defaultLocal;",
      "export const declarationExport = true;",
      "",
    ].join("\n"),
  });
  const { indexRepository } = await loadIndexer();
  const result = await indexRepository(root, { cacheRoot });

  const store = openAtlasStore(root, { cacheRoot });
  t.after(() => store.close());
  const symbols = store.getStoredFile(
    result.repository.worktreeId,
    "src/exports.js",
  ).parse.symbols;
  assert.equal(
    symbols.find((symbol) => symbol.name === "aliasedLocal").exported,
    true,
  );
  assert.equal(
    symbols.find((symbol) => symbol.name === "defaultLocal").exported,
    true,
  );
  assert.equal(
    symbols.find((symbol) => symbol.name === "declarationExport").exported,
    true,
  );
});

test("content-addressed parse reuse keeps language identity separate", async (t) => {
  const { root, cacheRoot } = repositoryFixture(t, {
    "src/empty.js": "",
    "src/empty.php": "",
  });
  const { indexRepository } = await loadIndexer();
  const result = await indexRepository(root, { cacheRoot });

  const store = openAtlasStore(root, { cacheRoot });
  t.after(() => store.close());
  assert.equal(
    store.getStoredFile(result.repository.worktreeId, "src/empty.js").parse
      .language,
    "javascript",
  );
  assert.equal(
    store.getStoredFile(result.repository.worktreeId, "src/empty.php").parse
      .language,
    "php",
  );
  assert.equal(store.counts().parseRecords >= 2, true);
});

test("content-addressed parse reuse keeps JavaScript dialect identity separate", async (t) => {
  const { root, cacheRoot } = repositoryFixture(t, {
    "src/dialect.ts": "export type DialectOnly = string;\n",
  });
  const { indexRepository } = await loadIndexer();
  await indexRepository(root, { cacheRoot });

  fs.renameSync(
    path.join(root, "src/dialect.ts"),
    path.join(root, "src/dialect.js"),
  );
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", "rename TypeScript syntax to JavaScript");
  const result = await indexRepository(root, { cacheRoot });

  const store = openAtlasStore(root, { cacheRoot });
  t.after(() => store.close());
  const javascript = store.getStoredFile(
    result.repository.worktreeId,
    "src/dialect.js",
  );
  assert.equal(javascript.parse, undefined);
  assert.equal(javascript.failure.code, "PARSE_ERROR");
});

test("content-preserving test moves rebuild path-dependent relationships", async (t) => {
  const { root, cacheRoot } = repositoryFixture(t, {
    "src/service.ts": "export function movedTestService() { return true; }\n",
    "tests/service.test.ts": [
      "import { movedTestService } from '../src/service';",
      "movedTestService();",
      "",
    ].join("\n"),
  });
  const { indexRepository } = await loadIndexer();
  await indexRepository(root, { cacheRoot });

  fs.mkdirSync(path.join(root, "spec"));
  fs.renameSync(
    path.join(root, "tests/service.test.ts"),
    path.join(root, "spec/service.test.ts"),
  );
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", "move test without changing content");
  const result = await indexRepository(root, { cacheRoot });

  const store = openAtlasStore(root, { cacheRoot });
  t.after(() => store.close());
  const testEdges = store
    .listEdges(result.repository.worktreeId)
    .filter((edge) => edge.kind === "tests");
  assert.deepEqual(testEdges, [
    {
      path: "spec/service.test.ts",
      kind: "tests",
      sourceSymbol: "spec/service.test.ts",
      target: "src/service.ts",
      line: 1,
      metadata: null,
    },
  ]);
});

test("unchanged tests drop relationships to renamed sources without being reread", async (t) => {
  const { root, cacheRoot } = repositoryFixture(t, {
    "src/service.ts": "export function renamedSourceService() { return true; }\n",
    "tests/service.test.ts": [
      "import { renamedSourceService } from '../src/service';",
      "renamedSourceService();",
      "",
    ].join("\n"),
  });
  const { indexRepository } = await loadIndexer();
  await indexRepository(root, { cacheRoot });

  fs.renameSync(
    path.join(root, "src/service.ts"),
    path.join(root, "src/renamed.ts"),
  );
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", "rename source only");
  const readPaths = [];
  const realRoot = fs.realpathSync(root);
  const result = await indexRepository(root, {
    cacheRoot,
    readFile(absolutePath, encoding) {
      readPaths.push(
        path.relative(realRoot, absolutePath).split(path.sep).join("/"),
      );
      return fs.readFileSync(absolutePath, encoding);
    },
  });

  assert.deepEqual(readPaths, ["src/renamed.ts"]);
  const store = openAtlasStore(root, { cacheRoot });
  t.after(() => store.close());
  assert.deepEqual(
    store
      .listEdges(result.repository.worktreeId)
      .filter((edge) => edge.kind === "tests"),
    [],
  );
});

test("unchanged tests gain relationships when their imported source appears", async (t) => {
  const { root, cacheRoot } = repositoryFixture(t, {
    "tests/later.test.ts": [
      "import { laterSource } from '../src/later-source';",
      "laterSource();",
      "",
    ].join("\n"),
  });
  const { indexRepository } = await loadIndexer();
  await indexRepository(root, { cacheRoot });

  write(
    root,
    "src/later-source.ts",
    "export function laterSource() { return true; }\n",
  );
  git(root, "add", "src/later-source.ts");
  git(root, "commit", "--quiet", "-m", "add imported source");
  const readPaths = [];
  const realRoot = fs.realpathSync(root);
  const result = await indexRepository(root, {
    cacheRoot,
    readFile(absolutePath, encoding) {
      readPaths.push(
        path.relative(realRoot, absolutePath).split(path.sep).join("/"),
      );
      return fs.readFileSync(absolutePath, encoding);
    },
  });

  assert.deepEqual(readPaths, ["src/later-source.ts"]);
  const store = openAtlasStore(root, { cacheRoot });
  t.after(() => store.close());
  assert.equal(
    store
      .listEdges(result.repository.worktreeId)
      .some(
        (edge) =>
          edge.kind === "tests" &&
          edge.path === "tests/later.test.ts" &&
          edge.target === "src/later-source.ts",
      ),
    true,
  );
});

test("one malformed source is isolated while valid files and a bounded failure persist", async (t) => {
  const { root, cacheRoot } = repositoryFixture(t, {
    "src/valid.ts": "export const validAlongsideFailure = true;\n",
    "src/broken.ts": "export function broken( {\n",
  });
  const { indexRepository } = await loadIndexer();

  const result = await indexRepository(root, { cacheRoot });

  assert.equal(result.state, "indexed");
  assert.equal(result.summary.counts.failed, 1);
  const store = openAtlasStore(root, { cacheRoot });
  t.after(() => store.close());
  assert.equal(
    store.search("validAlongsideFailure", {
      worktreeId: result.repository.worktreeId,
    }).length,
    1,
  );
  const failures = store.getFailures(result.repository.worktreeId);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].path, "src/broken.ts");
  assert.equal(failures[0].message.length <= 240, true);
});

test("corrupt external cache is quarantined and rebuilt without changing project files", async (t) => {
  const { root, cacheRoot } = repositoryFixture(t, {
    "src/recovery.ts": "export const recoveredCacheToken = true;\n",
  });
  const { indexRepository } = await loadIndexer();
  const first = await indexRepository(root, { cacheRoot });
  const beforeStatus = git(root, "status", "--short");
  fs.rmSync(`${first.repository.cachePath}-wal`, { force: true });
  fs.rmSync(`${first.repository.cachePath}-shm`, { force: true });
  fs.writeFileSync(first.repository.cachePath, "not a sqlite database");

  const recovered = await indexRepository(root, { cacheRoot });

  assert.equal(recovered.state, "indexed");
  assert.equal(recovered.summary.recoveredCorrupt, true);
  assert.equal(git(root, "status", "--short"), beforeStatus);
  const cacheEntries = fs.readdirSync(path.dirname(first.repository.cachePath));
  assert.equal(
    cacheEntries.some((entry) => entry.startsWith("atlas.sqlite.corrupt-")),
    true,
  );
  const store = openAtlasStore(root, { cacheRoot });
  t.after(() => store.close());
  assert.equal(
    store.search("recoveredCacheToken", {
      worktreeId: recovered.repository.worktreeId,
    }).length,
    1,
  );
});

test("the Nectar package test gate includes the recursive Atlas suite", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8"),
  );

  assert.match(packageJson.scripts.test, /scripts\/atlas\/\*\.test\.mjs/);
});

test("a read race emits one failed terminal summary and leaves no false completed snapshot", async (t) => {
  const { root, cacheRoot } = repositoryFixture(t, {
    "src/race.ts": "export const readRaceToken = true;\n",
  });
  const { indexRepository } = await loadIndexer();
  const events = [];

  await assert.rejects(
    () =>
      indexRepository(root, {
        cacheRoot,
        onEvent(event) {
          events.push(event);
        },
        readFile() {
          throw new Error("source changed during Atlas read");
        },
      }),
    /source changed during Atlas read/,
  );

  const terminal = events.filter((event) => event.terminal);
  assert.equal(terminal.length, 1);
  assert.equal(terminal[0].summary.status, "failed");
  assert.equal(
    events.some((event) => event.summary?.status === "complete"),
    false,
  );
  const store = openAtlasStore(root, { cacheRoot });
  t.after(() => store.close());
  assert.equal(store.getSnapshot(store.repository.worktreeId), null);
});
