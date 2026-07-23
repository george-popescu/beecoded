import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  parseDoctorArguments,
  runDoctor,
} from '../run-doctor.mjs';

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-doctor-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

test('parses an optional doctor token, project path, JSON, and help', () => {
  assert.deepEqual(parseDoctorArguments(['doctor', '--json', '../project']), {
    projectPath: '../project',
    json: true,
    help: false,
  });
  assert.equal(parseDoctorArguments(['--help']).help, true);
  assert.throws(() => parseDoctorArguments(['one', 'two']), /one project path/);
  assert.throws(() => parseDoctorArguments(['--wat']), /Unknown option/);
});

test('returns concise clean human output and exit zero', () => {
  const outcome = runDoctor({
    argv: [],
    cwd: process.cwd(),
    inspect: () => ({
      version: 1,
      projectRoot: process.cwd(),
      workRoot: 'docs/work',
      diagnostics: [],
      topics: [{ path: 'docs/work/2026-07-16-search', kind: 'direct', status: 'done' }],
    }),
  });

  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.output, 'Nectar doctor: clean (1 topic)');
});

test('returns stable JSON and exit one for blocking diagnostics', (t) => {
  const root = fixture(t, {
    'docs/work/2026-07-16-checkout/design.md': '# Checkout — Design\n\n## Topics\n1. `02-api/` — API; depends on: none\n',
    'docs/work/2026-07-16-checkout/02-api/design.md': '# API — Design\n',
  });

  const outcome = runDoctor({
    argv: ['--json', root],
    cwd: process.cwd(),
  });
  const report = JSON.parse(outcome.output);

  assert.equal(outcome.exitCode, 1);
  assert.ok(report.diagnostics.length > 0);
  assert.deepEqual(
    report.diagnostics,
    [...report.diagnostics].sort((left, right) => (
      left.path.localeCompare(right.path)
      || left.code.localeCompare(right.code)
      || left.message.localeCompare(right.message)
    )),
  );
});

test('inspects an explicit relative project path', (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-doctor-parent-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  fs.mkdirSync(path.join(parent, 'project', 'docs', 'work'), { recursive: true });

  const outcome = runDoctor({
    argv: ['project'],
    cwd: parent,
  });

  assert.equal(outcome.exitCode, 0);
  assert.match(outcome.output, /clean/);
  assert.equal(outcome.report.projectRoot, path.join(parent, 'project'));
});

test('returns usage exit two for a missing project path', () => {
  const outcome = runDoctor({
    argv: ['/definitely/missing/nectar-project'],
    cwd: process.cwd(),
  });

  assert.equal(outcome.exitCode, 2);
  assert.match(outcome.output, /does not exist/);
});

test('CLI inspection leaves inspected files untouched', (t) => {
  const root = fixture(t, {
    'docs/work/2026-07-16-search/design.md': '# Search — Design\n',
  });
  const target = path.join(root, 'docs/work/2026-07-16-search/design.md');
  const before = {
    content: fs.readFileSync(target, 'utf8'),
    mtimeMs: fs.statSync(target).mtimeMs,
  };

  runDoctor({ argv: [root], cwd: process.cwd() });

  assert.deepEqual({
    content: fs.readFileSync(target, 'utf8'),
    mtimeMs: fs.statSync(target).mtimeMs,
  }, before);
});
