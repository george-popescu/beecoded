import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { indexRepository } from './atlas/indexer.mjs';
import { queryAtlas } from './atlas/query.mjs';
import { renderAtlasControl, renderAtlasPacket } from './run-atlas.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runner = path.join(packageRoot, 'scripts', 'run-atlas.mjs');
const installer = path.join(packageRoot, 'bin', 'install.mjs');

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function fixture(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-atlas-cli-'));
  const root = path.join(parent, 'repository');
  const cacheRoot = path.join(parent, 'cache');
  fs.mkdirSync(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'atlas@example.test']);
  git(root, ['config', 'user.name', 'Atlas Test']);
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(
    path.join(root, 'src', 'service.ts'),
    'export class CliService { run() { return "cli-context"; } }\n',
  );
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'fixture']);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { root, cacheRoot };
}

test('routes public Atlas help through the Nectar binary', () => {
  const result = spawnSync(process.execPath, [installer, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /nectar atlas <operation>/);
  assert.match(result.stdout, /find-symbol/);
});

test('CLI JSON is the exact shared query packet and human output stays concise', async (t) => {
  const { root, cacheRoot } = fixture(t);
  await indexRepository(root, { cacheRoot });
  const args = [
    runner,
    'find-symbol',
    'CliService',
    '--path',
    root,
    '--json',
  ];
  const environment = { ...process.env, XDG_CACHE_HOME: path.dirname(cacheRoot) };
  const expected = queryAtlas(root, {
    operation: 'find-symbol',
    query: 'CliService',
    cacheRoot,
  });
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    env: { ...environment, NECTAR_ATLAS_CACHE_ROOT: cacheRoot },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), expected);
  assert.equal(result.stderr, '');

  const human = spawnSync(process.execPath, args.slice(0, -1), {
    encoding: 'utf8',
    env: { ...environment, NECTAR_ATLAS_CACHE_ROOT: cacheRoot },
  });
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /src\/service\.ts:1/);
  assert.match(human.stdout, /exact-symbol/);
});

test('CLI uses stable usage and fallback exit codes with diagnostics on stderr', (t) => {
  const { root, cacheRoot } = fixture(t);
  const fallback = spawnSync(process.execPath, [
    runner,
    'overview',
    '--path',
    root,
    '--json',
  ], {
    encoding: 'utf8',
    env: { ...process.env, NECTAR_ATLAS_CACHE_ROOT: cacheRoot },
  });
  assert.equal(fallback.status, 1);
  assert.equal(JSON.parse(fallback.stdout).diagnostic.code, 'ATLAS_INDEX_ABSENT');
  assert.match(fallback.stderr, /ATLAS_INDEX_ABSENT/);

  const invalid = spawnSync(process.execPath, [runner, 'nope'], { encoding: 'utf8' });
  assert.equal(invalid.status, 2);
  assert.equal(invalid.stdout, '');
  assert.match(invalid.stderr, /Unknown Atlas operation/);
});

test('human status and explain expose the decision and index state', (t) => {
  const { root, cacheRoot } = fixture(t);
  const beecodedHome = path.join(path.dirname(cacheRoot), 'home');
  const environment = {
    ...process.env,
    NECTAR_ATLAS_CACHE_ROOT: cacheRoot,
    BEECODED_HOME: beecodedHome,
    NECTAR_ATLAS_AUTO_MIN_FILES: '1',
  };
  const status = spawnSync(process.execPath, [
    runner,
    'status',
    '--path',
    root,
  ], { encoding: 'utf8', env: environment });
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /disabled \(choice pending\); index absent/);

  const explain = spawnSync(process.execPath, [
    runner,
    'explain',
    '--path',
    root,
  ], { encoding: 'utf8', env: environment });
  assert.equal(explain.status, 0, explain.stderr);
  assert.match(explain.stdout, /optional per-project local index/);
  assert.match(explain.stdout, /clear removes only this worktree snapshot/);
});

test('human rendering strips repository-controlled terminal escape sequences', () => {
  const hostile = '\u001b]8;;https://example.test\u0007forged\u001b]8;;\u0007';
  const query = renderAtlasPacket({
    state: 'ready',
    operation: 'find-symbol',
    evidence: [{
      path: `src/${hostile}.ts`,
      line: 1,
      reason: hostile,
      name: hostile,
    }],
    truncated: false,
  });
  const control = renderAtlasControl('explain', {
    state: 'ready',
    message: hostile,
  });

  for (const output of [query, control]) {
    assert.doesNotMatch(output.replaceAll('\n', ''), /[\u0000-\u001f\u007f-\u009f]/);
    assert.match(output, /forged/);
  }
});
