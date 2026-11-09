import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { inspectDebt, runDebt } from './run-debt.mjs';

function fixture(t, files = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-debt-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return root;
}

test('debt separates comment candidates from existing ignored backlog and preserves files', t => {
  const root = fixture(t, {
    '.gitignore': 'ignored.js\ndocs/work/\n',
    'tracked.js': '// TODO: limit: 100 rows; revisit when: batch exceeds 100\nconst message = "// FIXME: not a comment";\n',
    'new.py': '# FIXME: retry loses the original error\n',
    'ignored.js': '// TODO: ignored source\n',
    'docs/work/backlog.md': '# Backlog\n- 2026-11-06 Revisit exports (context: imports; revisit when: needed)\n',
  });
  execFileSync('git', ['-C', root, 'add', 'tracked.js']);
  const target = path.join(root, 'tracked.js');
  const before = fs.statSync(target).mtimeMs;
  const report = inspectDebt(root);
  assert.equal(report.entries.length, 3);
  assert.deepEqual(report.entries.map(e => e.origin), ['comment', 'comment', 'backlog']);
  const recorded = report.entries.find(e => e.path === 'tracked.js');
  assert.equal(recorded.line, 1);
  assert.equal(recorded.limit, '100 rows');
  assert.equal(recorded.revisit, 'batch exceeds 100');
  assert.equal(report.entries.find(e => e.path === 'new.py').revisit, null);
  assert.equal(fs.statSync(target).mtimeMs, before);
  assert.equal(fs.existsSync(path.join(root, '.nectar')), false);
});

test('debt excludes secrets, symlinks, binary and oversized source and redacts diagnostic values', t => {
  const root = fixture(t, {
    '.env.js': '// TODO: password=NeverExposeThisValue\n',
    'secrets/key.js': '// TODO: hidden\n',
    'binary.js': Buffer.from('// TODO: hidden\0binary'),
    'large.js': '// TODO: hidden\n' + 'x'.repeat(256 * 1024),
    'safe.js': '// shortcut: password=NeverExposeThisValue\n',
  });
  const external = fixture(t, { 'outside.js': '// FIXME: outside root\n' });
  fs.symlinkSync(path.join(external, 'outside.js'), path.join(root, 'linked.js'));
  fs.symlinkSync(external, path.join(root, 'linked'));
  const report = inspectDebt(root);
  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].path, 'safe.js');
  assert.ok(report.skipped.symlink >= 1);
  assert.equal(report.skipped.binary, 1);
  assert.equal(report.skipped.oversized, 1);
  assert.ok(!JSON.stringify(report).includes('NeverExposeThisValue'));
  assert.ok(!JSON.stringify(report).includes('outside root'));
});

test('debt reports no candidates without asserting health and rejects invalid roots/options', t => {
  const root = fixture(t, { 'main.js': 'export const value = 1;\n' });
  const result = runDebt({ argv: ['--json', root] });
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(result.output).entries.length, 0);
  assert.ok(result.report.limitations.length > 0);
  assert.equal(runDebt({ argv: ['--invalid'] }).exitCode, 2);
  assert.equal(runDebt({ argv: [path.join(root, 'main.js')] }).exitCode, 2);
  const link = path.join(root, 'linked-root');
  fs.symlinkSync(root, link);
  assert.equal(runDebt({ argv: [link] }).exitCode, 2);
});
