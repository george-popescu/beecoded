import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { gitWorktreeState, resolveRepositoryIdentity } from './paths.mjs';

test('failed Git probes retain the cause without truncated quoted credentials', () => {
  assert.throws(() => gitWorktreeState(process.cwd(), {
    spawn: () => ({ status: 1, stdout: '', stderr: 'repository unavailable password="two word secret\nretry later' }),
  }), (error) => {
    assert.match(error.message, /repository unavailable/);
    assert.doesNotMatch(error.message, /two word secret/);
    return error.code === 'ATLAS_GIT_STATE_UNAVAILABLE';
  });
});

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

test('worktree probes never execute a repository-configured FSMonitor hook', (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-atlas-paths-'));
  const root = path.join(parent, 'repository');
  const hook = path.join(parent, 'fsmonitor.sh');
  const marker = path.join(parent, 'invoked');
  fs.mkdirSync(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'atlas@example.test']);
  git(root, ['config', 'user.name', 'Atlas Test']);
  fs.writeFileSync(path.join(root, 'tracked.js'), 'export const tracked = true;\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'fixture']);
  fs.writeFileSync(hook, `#!/bin/sh\nprintf invoked > ${JSON.stringify(marker)}\n`);
  fs.chmodSync(hook, 0o700);
  git(root, ['config', 'core.fsmonitor', hook]);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));

  const state = gitWorktreeState(root);

  assert.equal(state.head, git(root, ['rev-parse', 'HEAD']));
  assert.equal(fs.existsSync(marker), false);
});

test('repository identity resolves through one hardened Git process', (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-atlas-identity-'));
  const root = path.join(parent, 'repository');
  const cacheRoot = path.join(parent, 'cache');
  fs.mkdirSync(root);
  git(root, ['init', '-q']);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));

  const calls = [];
  const identity = resolveRepositoryIdentity(root, {
    cacheRoot,
    spawn(command, args, options) {
      calls.push({ command, args });
      return spawnSync(command, args, options);
    },
  });

  assert.equal(identity.state, 'ready');
  assert.equal(calls.length, 1);
  assert.deepEqual(
    calls[0].args.slice(-4),
    ['--show-toplevel', '--path-format=absolute', '--git-dir', '--git-common-dir'],
  );
});

test('dirty fingerprints stay content-sensitive without one Git process per file', (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-atlas-fingerprint-'));
  const root = path.join(parent, 'repository');
  fs.mkdirSync(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'atlas@example.test']);
  git(root, ['config', 'user.name', 'Atlas Test']);
  fs.writeFileSync(path.join(root, 'a.js'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(root, 'b.js'), 'export const b = 1;\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'fixture']);
  fs.writeFileSync(path.join(root, 'a.js'), 'export const a = 2;\n');
  fs.writeFileSync(path.join(root, 'b.js'), 'export const b = 2;\n');
  fs.writeFileSync(path.join(root, 'untracked.js'), 'export const c = 1;\n');
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));

  const calls = [];
  const options = {
    spawn(command, args, spawnOptions) {
      calls.push({ command, args });
      return spawnSync(command, args, spawnOptions);
    },
  };
  const before = gitWorktreeState(root, options);

  assert.equal(calls.length, 3);
  assert.deepEqual(before.dirtyFiles, ['a.js', 'b.js', 'untracked.js']);

  calls.length = 0;
  fs.writeFileSync(path.join(root, 'a.js'), 'export const a = 3;\n');
  const after = gitWorktreeState(root, options);

  assert.equal(calls.length, 3);
  assert.notEqual(after.worktreeFingerprint, before.worktreeFingerprint);
});
