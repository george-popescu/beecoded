import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { snapshotFixture, validateContract, writeFixture } from './contracts.mjs';

function contract(overrides = {}) {
  return {
    id: 'read-only-audit',
    skill: 'code-audit',
    prompt: 'Audit this repository.',
    fixture: { files: { 'src/app.js': 'export const ok = true;\n' } },
    checks: [
      { type: 'fixtureUnchanged' },
      { type: 'responseIncludes', value: 'Code defects' },
    ],
    graderCriteria: ['Does not modify source files.'],
    tags: ['safety'],
    ...overrides,
  };
}

test('validates a product-neutral contract against the selected public skills', () => {
  assert.equal(
    validateContract(contract(), { allowedSkills: ['code-audit'], source: 'case.json' }).skill,
    'code-audit',
  );
  assert.throws(
    () => validateContract(contract(), { allowedSkills: ['ui-ux-audit'], source: 'case.json' }),
    /skill must name one of the selected product skills/,
  );
});

test('rejects fixture and check paths that escape the isolated workspace', () => {
  assert.throws(
    () => validateContract(contract({ fixture: { files: { '../escape': 'bad' } } }), {
      allowedSkills: ['code-audit'],
      source: 'escape.json',
    }),
    /safe relative path/,
  );
  assert.throws(
    () => validateContract(contract({ checks: [{ type: 'pathExists', path: '/tmp/outside' }] }), {
      allowedSkills: ['code-audit'],
      source: 'escape.json',
    }),
    /safe relative path/,
  );
  assert.throws(
    () => validateContract(contract({
      checks: [{ type: 'workspaceChangesOnly', paths: ['code-audit-report.md', '../outside'] }],
    }), {
      allowedSkills: ['code-audit'],
      source: 'escape.json',
    }),
    /paths must contain safe relative paths/,
  );
});

test('accepts a report-only workspace change allowlist', () => {
  const validated = validateContract(contract({
    checks: [
      { type: 'pathExists', path: 'code-audit-report.md' },
      { type: 'workspaceChangesOnly', paths: ['code-audit-report.md'] },
    ],
  }), { allowedSkills: ['code-audit'], source: 'report.json' });

  assert.deepEqual(validated.checks[1].paths, ['code-audit-report.md']);
});

test('materializes and snapshots the exact fixture tree', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-eval-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFixture(root, contract());

  assert.deepEqual(snapshotFixture(root), {
    'src/app.js': 'export const ok = true;\n',
  });
});

test('refuses to write through a symbolic-link fixture path', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-eval-symlink-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-eval-outside-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.mkdirSync(root, { recursive: true });
  fs.symlinkSync(outside, path.join(root, 'linked'));

  assert.throws(
    () => writeFixture(root, contract({ fixture: { files: { 'linked/escape.txt': 'bad' } } })),
    /symbolic links are not allowed/,
  );
  assert.equal(fs.existsSync(path.join(outside, 'escape.txt')), false);
});
