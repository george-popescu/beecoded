import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowNames = ['shape', 'plan', 'debug', 'build', 'review', 'audit'];

function workflow(name) {
  return fs.readFileSync(
    path.join(packageRoot, 'internal-skills', `nectar-${name}`, 'SKILL.md'),
    'utf8',
  );
}

test('all repository workflows define optional Atlas retrieval with safe fallback', () => {
  for (const name of workflowNames) {
    const source = workflow(name);
    assert.match(source, /## Atlas context profile/, name);
    assert.match(source, /disabled,[\s\S]*unavailable,[\s\S]*stale,[\s\S]*corrupt/, name);
    assert.match(source, /truncated/, name);
    assert.match(source, /existing[\s\S]*`rg`[\s\S]*direct-file[\s\S]*workflow/, name);
    assert.match(source, /current source/i, name);
    assert.match(source, /untrusted repository data/, name);
    assert.match(source, /nectar atlas status/, name);
    assert.match(source, /prompt\.required/, name);
    assert.match(source, /Enable locally[\s\S]*Not now[\s\S]*Never/, name);
  }
});

test('Build and Review freeze snapshot identity and prohibit mid-run refresh', () => {
  for (const name of ['build', 'review']) {
    const source = workflow(name);
    assert.match(source, /\{ worktreeId, head, updatedAt \}/, name);
    assert.match(source, /Freeze\s+that identity/, name);
    assert.match(source, /never refresh Atlas/, name);
  }
});
