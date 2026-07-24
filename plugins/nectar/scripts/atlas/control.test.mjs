import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  atlasStatus,
  chooseAtlas,
  clearAtlas,
  enableAtlas,
  refreshAtlas,
} from './control.mjs';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function fixture(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-atlas-control-'));
  const root = path.join(parent, 'repository');
  fs.mkdirSync(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'atlas@example.test']);
  git(root, ['config', 'user.name', 'Atlas Test']);
  fs.writeFileSync(path.join(root, 'service.ts'), 'export class ControlledService {}\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'fixture']);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return {
    root,
    options: {
      cacheRoot: path.join(parent, 'cache'),
      beecodedHome: path.join(parent, 'home'),
    },
  };
}

test('keeps one reversible per-worktree choice outside the repository', (t) => {
  const { root, options } = fixture(t);
  const initial = atlasStatus(root, { ...options, autoMinFiles: 1 });
  assert.equal(initial.preference.mode, 'auto');
  assert.equal(initial.preference.shouldPrompt, true);
  assert.equal(initial.recommendation.recommended, true);
  assert.equal(initial.prompt.required, true);
  assert.deepEqual(initial.prompt.choices, ['enable', 'not-now', 'never']);
  assert.equal(initial.index.state, 'absent');

  assert.equal(chooseAtlas(root, 'not-now', options).shouldPrompt, false);
  assert.equal(
    atlasStatus(root, { ...options, autoMinFiles: 1 }).prompt.required,
    false,
  );
  assert.equal(chooseAtlas(root, 'never', options).mode, 'off');
  assert.equal(chooseAtlas(root, 'auto', options).shouldPrompt, true);
  assert.deepEqual(fs.readdirSync(root).sort(), ['.git', 'service.ts']);
});

test('auto recommends only after the project crosses the cheap eligible-file threshold', (t) => {
  const { root, options } = fixture(t);
  const small = atlasStatus(root, { ...options, autoMinFiles: 2 });
  assert.equal(small.recommendation.eligibleFiles, 1);
  assert.equal(small.prompt.required, false);

  fs.writeFileSync(path.join(root, 'second.ts'), 'export const second = true;\n');
  const grown = atlasStatus(root, { ...options, autoMinFiles: 2 });
  assert.equal(grown.recommendation.eligibleFiles, 2);
  assert.equal(grown.prompt.required, true);
});

test('enable, refresh, disable, and clear own only the active worktree state', async (t) => {
  const { root, options } = fixture(t);
  const enabled = await enableAtlas(root, options);
  assert.equal(enabled.state, 'enabled');
  assert.equal(atlasStatus(root, options).index.freshness.state, 'fresh');

  chooseAtlas(root, 'disable', options);
  assert.equal(atlasStatus(root, options).preference.effective, 'disabled');
  const refreshed = await refreshAtlas(root, options);
  assert.equal(refreshed.state, 'indexed');
  assert.equal(clearAtlas(root, options).removed, true);
  assert.equal(atlasStatus(root, options).index.state, 'absent');
  assert.equal(atlasStatus(root, options).preference.mode, 'off');
});

test('failed enable leaves the previous preference unchanged', async (t) => {
  const { root, options } = fixture(t);
  const invalidCacheRoot = path.join(path.dirname(options.cacheRoot), 'cache-file');
  fs.writeFileSync(invalidCacheRoot, 'not a directory');

  await assert.rejects(
    () => enableAtlas(root, { ...options, cacheRoot: invalidCacheRoot }),
    /ENOTDIR|not a directory/,
  );
  const status = atlasStatus(root, options);
  assert.equal(status.preference.mode, 'auto');
  assert.equal(status.preference.decision, 'unasked');
});
