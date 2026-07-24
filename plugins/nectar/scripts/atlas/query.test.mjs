import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-atlas-query-'));
  const root = path.join(parent, 'repository');
  const cacheRoot = path.join(parent, 'cache');
  fs.mkdirSync(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'atlas@example.test']);
  git(root, ['config', 'user.name', 'Atlas Test']);
  write(root, 'src/OrderService.ts', [
    'import { AuditLog } from "./audit";',
    'export class OrderService {',
    '  placeOrder() { return AuditLog.record("order-context-word"); }',
    '}',
    '',
  ].join('\n'));
  write(root, 'src/audit.ts', [
    'import { OrderService } from "./OrderService";',
    'export class AuditLog {',
    '  static record(value: string) { return value; }',
    '  static circular(service: OrderService) { return service.placeOrder(); }',
    '}',
    '',
  ].join('\n'));
  write(root, 'src/OrderService.test.ts', [
    'import { OrderService } from "./OrderService";',
    'export function orderTest() { return new OrderService().placeOrder(); }',
    '',
  ].join('\n'));
  write(root, 'app/BillingService.php', [
    '<?php',
    'namespace App;',
    'final class BillingService {',
    '    public function charge(): string { return "billing-context-word"; }',
    '}',
    '',
  ].join('\n'));
  write(root, 'README.md', '# Project\n\norder-context-word appears in documentation too.\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'fixture']);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { root, cacheRoot };
}

async function queryModule() {
  return import('./query.mjs');
}

test('serves all six operations through one evidence packet contract', async (t) => {
  const { root, cacheRoot } = fixture(t);
  await indexRepository(root, { cacheRoot });
  const { queryAtlas, ATLAS_OPERATIONS } = await queryModule();

  const inputs = {
    overview: '',
    'find-symbol': 'OrderService',
    'find-related': 'OrderService',
    'trace-flow': 'OrderService',
    'find-tests': 'src/OrderService.ts',
    'context-for-task': 'change OrderService billing',
  };
  assert.deepEqual([...ATLAS_OPERATIONS], Object.keys(inputs));

  for (const [operation, query] of Object.entries(inputs)) {
    const packet = queryAtlas(root, { operation, query, cacheRoot });
    assert.equal(packet.schema, 1);
    assert.equal(packet.state, 'ready');
    assert.equal(packet.operation, operation);
    assert.equal(packet.fallback, false);
    assert.equal(packet.freshness.state, 'fresh');
    assert.ok(packet.snapshot.repositoryId);
    assert.ok(packet.snapshot.worktreeId);
    assert.ok(packet.evidence.length > 0, operation);
    assert.ok(packet.evidence.every((entry) => (
      typeof entry.path === 'string'
      && Number.isInteger(entry.line)
      && entry.line >= 1
      && typeof entry.reason === 'string'
      && ['high', 'medium', 'low'].includes(entry.confidence)
    )));
  }
});

test('ranks exact and graph evidence before lexical matches with stable reasons', async (t) => {
  const { root, cacheRoot } = fixture(t);
  await indexRepository(root, { cacheRoot });
  const { queryAtlas } = await queryModule();

  const symbols = queryAtlas(root, {
    operation: 'find-symbol',
    query: 'OrderService',
    cacheRoot,
  });
  assert.equal(symbols.evidence[0].reason, 'exact-symbol');
  assert.equal(symbols.evidence[0].path, 'src/OrderService.ts');
  assert.ok(symbols.evidence.every((entry) => !Object.hasOwn(entry, 'score')));
  const lexicalIndex = symbols.evidence.findIndex((entry) => entry.reason === 'fts-match');
  assert.ok(lexicalIndex === -1 || lexicalIndex > 0);

  const related = queryAtlas(root, {
    operation: 'find-related',
    query: 'OrderService',
    cacheRoot,
  });
  const graphIndex = related.evidence.findIndex((entry) => entry.reason === 'graph-relation');
  const relatedLexicalIndex = related.evidence.findIndex((entry) => entry.reason === 'fts-match');
  assert.ok(graphIndex >= 0);
  assert.ok(relatedLexicalIndex === -1 || graphIndex < relatedLexicalIndex);
});

test('deduplicates cyclic graph evidence and produces deterministic packets', async (t) => {
  const { root, cacheRoot } = fixture(t);
  await indexRepository(root, { cacheRoot });
  const { queryAtlas } = await queryModule();
  const options = {
    operation: 'trace-flow',
    query: 'OrderService',
    cacheRoot,
    limit: 50,
  };

  const first = queryAtlas(root, options);
  const second = queryAtlas(root, options);
  assert.deepEqual(first, second);
  const keys = first.evidence.map((entry) => (
    [
      entry.path,
      entry.line,
      entry.kind,
      entry.relation || '',
      entry.name || '',
      entry.target || '',
    ].join(':')
  ));
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(first.evidence.length <= 50);
});

test('keeps distinct same-line graph relations with different targets', async (t) => {
  const { root, cacheRoot } = fixture(t);
  write(root, 'src/multiple.ts', [
    'interface FirstContract {}',
    'interface SecondContract {}',
    'export class MultipleRelations implements FirstContract, SecondContract {}',
    '',
  ].join('\n'));
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'multiple relations']);
  await indexRepository(root, { cacheRoot });
  const { queryAtlas } = await queryModule();

  const packet = queryAtlas(root, {
    operation: 'find-related',
    query: 'MultipleRelations',
    cacheRoot,
    limit: 50,
  });
  const targets = packet.evidence
    .filter((entry) => entry.reason === 'graph-relation')
    .map((entry) => entry.target);

  assert.ok(targets.includes('FirstContract'));
  assert.ok(targets.includes('SecondContract'));
});

test('trace-flow finds relevant graph edges beyond the first global 100', async (t) => {
  const { root, cacheRoot } = fixture(t);
  write(root, 'src/many-calls.ts', [
    ...Array.from({ length: 110 }, (_, index) => `decoy${index}();`),
    'LateTarget();',
    '',
  ].join('\n'));
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'many calls']);
  await indexRepository(root, { cacheRoot });
  const { queryAtlas } = await queryModule();

  const packet = queryAtlas(root, {
    operation: 'trace-flow',
    query: 'LateTarget',
    cacheRoot,
    limit: 50,
  });

  assert.ok(packet.evidence.some((entry) => (
    entry.reason === 'graph-relation'
    && entry.target === 'LateTarget'
  )));
});

test('trace-flow traverses outbound calls from the queried caller for two hops', async (t) => {
  const { root, cacheRoot } = fixture(t);
  write(root, 'src/flow.ts', [
    'export function FlowEntry() { return FlowMiddle(); }',
    'export function FlowMiddle() { return FlowEnd(); }',
    'export function FlowEnd() { return true; }',
    '',
  ].join('\n'));
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'call flow']);
  await indexRepository(root, { cacheRoot });
  const { queryAtlas } = await queryModule();

  const packet = queryAtlas(root, {
    operation: 'trace-flow',
    query: 'FlowEntry',
    cacheRoot,
    limit: 50,
  });
  const relations = packet.evidence.filter((entry) => entry.reason === 'graph-relation');

  assert.ok(relations.some((entry) => (
    entry.name === 'FlowEntry' && entry.target === 'FlowMiddle'
  )));
  assert.ok(relations.some((entry) => (
    entry.name === 'FlowMiddle' && entry.target === 'FlowEnd'
  )));
});

test('trace-flow marks a pending frontier beyond the traversal cap as truncated', async (t) => {
  const { root, cacheRoot } = fixture(t);
  write(root, 'src/deep-flow.ts', [
    ...Array.from({ length: 7 }, (_, index) => (
      `export function DeepFlow${index}() { return DeepFlow${index + 1}(); }`
    )),
    'export function DeepFlow7() { return true; }',
    '',
  ].join('\n'));
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'deep call flow']);
  await indexRepository(root, { cacheRoot });
  const { queryAtlas } = await queryModule();

  const packet = queryAtlas(root, {
    operation: 'trace-flow',
    query: 'DeepFlow0',
    cacheRoot,
    limit: 100,
    budget: 100_000,
  });

  assert.ok(packet.evidence.some((entry) => entry.target === 'DeepFlow3'));
  assert.equal(packet.truncated, true);
  assert.ok(packet.omitted > 0);
  assert.equal(packet.omittedIsLowerBound, true);
});

test('reports bounded upstream truncation instead of claiming completeness', async (t) => {
  const { root, cacheRoot } = fixture(t);
  for (let index = 0; index < 105; index += 1) {
    write(root, `many/file-${String(index).padStart(3, '0')}.md`, `# File ${index}\n`);
  }
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'many files']);
  await indexRepository(root, { cacheRoot });
  const { queryAtlas } = await queryModule();

  const packet = queryAtlas(root, {
    operation: 'overview',
    cacheRoot,
    limit: 100,
    budget: 100_000,
  });

  assert.equal(packet.evidence.length, 100);
  assert.equal(packet.truncated, true);
  assert.ok(packet.omitted > 0);
  assert.equal(packet.omittedIsLowerBound, true);
});

test('enforces character and result budgets with explicit truncation metadata', async (t) => {
  const { root, cacheRoot } = fixture(t);
  await indexRepository(root, { cacheRoot });
  const { queryAtlas } = await queryModule();

  const packet = queryAtlas(root, {
    operation: 'context-for-task',
    query: 'OrderService order billing context',
    cacheRoot,
    budget: 900,
    limit: 2,
  });

  assert.ok(packet.evidence.length <= 2);
  assert.equal(packet.budget.characters, 900);
  assert.ok(packet.budget.used <= packet.budget.characters);
  assert.equal(packet.truncated, true);
  assert.ok(packet.omitted > 0);
});

test('returns stable empty fallback packets for absent and stale indexes', async (t) => {
  const absent = fixture(t);
  const { queryAtlas } = await queryModule();

  const missing = queryAtlas(absent.root, {
    operation: 'overview',
    cacheRoot: absent.cacheRoot,
  });
  assert.equal(missing.state, 'fallback');
  assert.equal(missing.diagnostic.code, 'ATLAS_INDEX_ABSENT');
  assert.deepEqual(missing.evidence, []);

  const stale = fixture(t);
  await indexRepository(stale.root, { cacheRoot: stale.cacheRoot });
  write(stale.root, 'src/OrderService.ts', 'export class Changed {}\n');
  const outdated = queryAtlas(stale.root, {
    operation: 'find-symbol',
    query: 'OrderService',
    cacheRoot: stale.cacheRoot,
  });
  assert.equal(outdated.state, 'fallback');
  assert.equal(outdated.diagnostic.code, 'ATLAS_INDEX_STALE');
  assert.deepEqual(outdated.evidence, []);
});

test('rejects invalid operations and budgets without touching repository files', async (t) => {
  const { root, cacheRoot } = fixture(t);
  await indexRepository(root, { cacheRoot });
  const before = fs.statSync(path.join(root, 'src/OrderService.ts')).mtimeMs;
  const { queryAtlas } = await queryModule();

  assert.throws(() => queryAtlas(root, {
    operation: 'delete-everything',
    cacheRoot,
  }), { code: 'ATLAS_INVALID_OPERATION' });
  for (const budget of [0, -1, Infinity, 1.5, '900']) {
    assert.throws(() => queryAtlas(root, {
      operation: 'overview',
      cacheRoot,
      budget,
    }), { code: 'ATLAS_INVALID_BUDGET' });
  }
  assert.equal(fs.statSync(path.join(root, 'src/OrderService.ts')).mtimeMs, before);
});
