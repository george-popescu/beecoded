import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { prepareNectarRelease, summarizeLog } from './prepare-nectar-release.mjs';

test('the release CLI runs through a symlink and rejects unexpected arguments before any gates', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-release-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const launcher = path.join(root, 'prepare.mjs');
  fs.symlinkSync(fileURLToPath(new URL('./prepare-nectar-release.mjs', import.meta.url)), launcher);
  const result = spawnSync(process.execPath, [launcher, 'unexpected'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[nectar-release\] Usage:/);
  assert.equal(result.stdout, '');
  assert.deepEqual(fs.readdirSync(root), ['prepare.mjs']);
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-release-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'project');
  const temporaryRoot = path.join(root, 'output');
  const packageRoot = path.join(repoRoot, 'plugins', 'nectar');
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.mkdirSync(temporaryRoot);
  fs.writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify({
    private: true,
    workspaces: ['plugins/nectar'],
    scripts: { 'test:nectar': 'node gate.cjs test', validate: 'node gate.cjs validate' },
  }));
  fs.writeFileSync(path.join(repoRoot, 'gate.cjs'), `
    const fs = require('node:fs');
    const gate = process.argv[2];
    fs.appendFileSync('gates.log', gate + '\\n');
    console.log('fixture gate: ' + gate);
    if (fs.existsSync('fail-gate') && fs.readFileSync('fail-gate', 'utf8') === gate) process.exit(1);
  `);
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({
    name: '@beecoded/nectar', version: '0.0.0-fixture', files: ['*.mjs'],
    scripts: { prepack: 'node -e "process.exit(42)"' },
  }));
  fs.writeFileSync(path.join(packageRoot, 'index.mjs'), 'export const value = 1;\n');
  const calls = [];
  const execute = (command, args, options) => {
    calls.push([command, ...args]);
    return spawnSync(command, args, args[0] === 'pack'
      ? { ...options, stdio: ['ignore', 'pipe', 'pipe'] }
      : options);
  };
  const reports = [];
  return { repoRoot, packageRoot, temporaryRoot, execute, calls, reports, report: (message) => reports.push(message) };
}

function assertOnlyDiagnosticLogs(item) {
  const outputs = fs.readdirSync(item.temporaryRoot);
  assert.equal(outputs.length, 1);
  const files = fs.readdirSync(path.join(item.temporaryRoot, outputs[0]));
  assert.ok(files.length > 0);
  assert.ok(files.every((file) => file.endsWith('.log')));
}

test('summarizes long passing output and exposes an early failure without losing its full log', () => {
  const body = Array.from({ length: 1000 }, (_, index) => `ok ${index + 1} - case`).join('\n');
  const totals = '\n# tests 1000\n# pass 1000\n# fail 0\n# duration_ms 1234\n';
  assert.equal(summarizeLog(body + totals, false), totals.trim());
  const failed = summarizeLog(`not ok 1 - regression\n  error: wrong amount\n${body}${totals}`, true);
  assert.match(failed, /wrong amount/);
  assert.ok(failed.length < 5000);
});

test('prepares one real npm archive after one pass of each gate, without lifecycle reruns or publication', (t) => {
  const item = fixture(t);
  const result = prepareNectarRelease(item);
  assert.equal(fs.readFileSync(path.join(item.repoRoot, 'gates.log'), 'utf8'), 'test\nvalidate\n');
  assert.equal(item.calls.filter(([, command, ...args]) => command === 'pack' && !args.includes('--dry-run')).length, 1);
  assert.equal(item.calls.some(([, command]) => command === 'publish'), false);
  assert.equal(result.integrity, `sha512-${crypto.createHash('sha512').update(fs.readFileSync(result.archive)).digest('base64')}`);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(path.dirname(result.archive), 'release.json'), 'utf8')), result);
  assert.equal(result.verification.length, 2);
  assert.ok(result.verification.every((gate) => gate.result === 'passed'));
  assert.equal(item.reports.length, 2);
  for (const gate of result.verification) {
    assert.match(fs.readFileSync(gate.log, 'utf8'), /fixture gate:/);
    assert.ok(gate.elapsedMs >= 0);
  }
});

test('failed validation stops before packing and does not leave a release artifact', async (t) => {
  for (const gate of ['test', 'validate']) {
    await t.test(gate, (subtest) => {
      const item = fixture(subtest);
      fs.writeFileSync(path.join(item.repoRoot, 'fail-gate'), gate);
      assert.throws(() => prepareNectarRelease(item), /failed/);
      assertOnlyDiagnosticLogs(item);
      assert.equal(item.calls.some(([, command, ...args]) => command === 'pack' && !args.includes('--dry-run')), false);
      assert.equal(fs.readFileSync(path.join(item.repoRoot, 'gates.log'), 'utf8'), gate === 'test' ? 'test\n' : 'test\nvalidate\n');
    });
  }
});

test('rejects changed package inputs or a corrupted archive instead of claiming validated output', async (t) => {
  for (const mutation of ['during-validation', 'new-packed-file', 'archive-bytes']) {
    await t.test(mutation, (subtest) => {
      const item = fixture(subtest);
      const execute = (command, args, options) => {
        const packing = args[0] === 'pack' && !args.includes('--dry-run');
        if (mutation === 'new-packed-file' && packing) {
          fs.writeFileSync(path.join(item.packageRoot, 'extra.mjs'), 'export const added = true;\n');
        }
        const result = item.execute(command, args, options);
        if (mutation === 'during-validation' && args[0] === 'run' && args[1] === 'validate') {
          fs.writeFileSync(path.join(item.packageRoot, 'index.mjs'), 'export const value = 2;\n');
        }
        if (mutation === 'archive-bytes' && packing && result.status === 0) {
          const [pack] = JSON.parse(result.stdout);
          const destination = args[args.indexOf('--pack-destination') + 1];
          fs.appendFileSync(path.join(destination, pack.filename), 'corruption');
        }
        return result;
      };
      assert.throws(() => prepareNectarRelease({ ...item, execute }), /changed|integrity mismatch/);
      assertOnlyDiagnosticLogs(item);
    });
  }
});
