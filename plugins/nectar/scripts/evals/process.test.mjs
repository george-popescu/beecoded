import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

import { evalEnvironment, runCommand } from './process.mjs';

test('returns the child exit status when it closes stdin before consuming a large prompt', async () => {
  const result = await runCommand(
    process.execPath,
    ['-e', 'process.exit(3)'],
    { input: 'x'.repeat(8 * 1024 * 1024) },
  );

  assert.equal(result.status, 3);
  assert.equal(result.error, null);
});

test('caps buffered output and escalates to SIGKILL when a child ignores SIGTERM', async () => {
  const script = [
    "process.on('SIGTERM', () => {});",
    "setInterval(() => process.stdout.write('x'.repeat(65536)), 1);",
  ].join('');
  const started = Date.now();
  const result = await runCommand(
    process.execPath,
    ['-e', script],
    { maxBuffer: 1_024, timeout: 5_000, killGraceMs: 20 },
  );

  assert.equal(result.error?.code, 'ENOBUFS');
  assert.ok(Buffer.byteLength(result.stdout) <= 1_024);
  assert.equal(result.signal, 'SIGKILL');
  assert.ok(Date.now() - started < 2_000);
});

test('kills a silent hung child after the configured timeout', async () => {
  const script = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);";
  const result = await runCommand(
    process.execPath,
    ['-e', script],
    { timeout: 200, killGraceMs: 20 },
  );

  assert.equal(result.error?.code, 'ETIMEDOUT');
  assert.equal(result.signal, 'SIGKILL');
});

test('terminates descendants that inherit the timed-out child process pipes', {
  skip: process.platform === 'win32',
}, async () => {
  const grandchild = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);";
  const parent = [
    "const { spawn } = require('node:child_process');",
    `spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'inherit' });`,
    "process.on('SIGTERM', () => {});",
    'setInterval(() => {}, 1000);',
  ].join('');
  const started = Date.now();
  const result = await runCommand(
    process.execPath,
    ['-e', parent],
    { timeout: 200, killGraceMs: 20 },
  );

  assert.equal(result.error?.code, 'ETIMEDOUT');
  assert.equal(result.signal, 'SIGKILL');
  assert.ok(Date.now() - started < 2_000);
});

test('keeps hard escalation armed after the direct child exits', {
  skip: process.platform === 'win32',
}, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-process-tree-'));
  const pidFile = path.join(root, 'grandchild.pid');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const grandchild = [
    `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
    "process.on('SIGTERM', () => {});",
    'setInterval(() => {}, 1000);',
  ].join('');
  const parent = [
    "const { spawn } = require('node:child_process');",
    `spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' });`,
    'setInterval(() => {}, 1000);',
  ].join('');
  const result = await runCommand(
    process.execPath,
    ['-e', parent],
    { timeout: 200, killGraceMs: 100 },
  );
  const grandchildPid = Number(fs.readFileSync(pidFile, 'utf8'));
  let alive = true;
  const reapDeadline = Date.now() + 1_000;
  while (alive && Date.now() < reapDeadline) {
    try { process.kill(grandchildPid, 0); } catch { alive = false; }
    if (alive) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (alive) {
    try { process.kill(grandchildPid, 'SIGKILL'); } catch {}
  }

  assert.equal(result.error?.code, 'ETIMEDOUT');
  assert.equal(alive, false);
});

test('does not buffer output emitted during timeout termination grace', async () => {
  const script = [
    "process.on('SIGTERM', () => {",
    "  setInterval(() => process.stdout.write('x'.repeat(65536)), 1);",
    '});',
    'setInterval(() => {}, 1000);',
  ].join('');
  const result = await runCommand(
    process.execPath,
    ['-e', script],
    { maxBuffer: 1_024, timeout: 200, killGraceMs: 100 },
  );

  assert.equal(result.error?.code, 'ETIMEDOUT');
  assert.ok(Buffer.byteLength(result.stdout) <= 1_024);
});

test('parent SIGINT cleans up detached eval children', {
  skip: process.platform === 'win32',
}, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-process-signal-'));
  const pidFile = path.join(root, 'child.pid');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const childScript = [
    `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
    'setInterval(() => {}, 1000);',
  ].join('');
  const moduleUrl = new URL('./process.mjs', import.meta.url).href;
  const workerScript = [
    `const { runCommand } = await import(${JSON.stringify(moduleUrl)});`,
    `await runCommand(process.execPath, ['-e', ${JSON.stringify(childScript)}], { timeout: 60000 });`,
  ].join('');
  const worker = spawn(
    process.execPath,
    ['--input-type=module', '-e', workerScript],
    { stdio: 'ignore' },
  );

  const deadline = Date.now() + 2_000;
  while (!fs.existsSync(pidFile) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(fs.existsSync(pidFile), 'worker child publishes its pid');
  const childPid = Number(fs.readFileSync(pidFile, 'utf8'));
  worker.kill('SIGINT');
  await new Promise((resolve) => worker.once('close', resolve));

  let alive = true;
  const cleanupDeadline = Date.now() + 1_000;
  while (alive && Date.now() < cleanupDeadline) {
    try { process.kill(childPid, 0); } catch { alive = false; }
    if (alive) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (alive) {
    try { process.kill(childPid, 'SIGKILL'); } catch {}
  }
  assert.equal(alive, false);
});

test('evaluation environments exclude ambient secrets unless explicitly allowlisted', () => {
  const environment = evalEnvironment({
    PATH: '/bin',
    HOME: '/tmp/home',
    OPENAI_API_KEY: 'secret',
    CUSTOM_TOKEN: 'custom-secret',
    NECTAR_EVAL_PASSTHROUGH_ENV: 'CUSTOM_TOKEN',
  });

  assert.deepEqual(environment, {
    PATH: '/bin',
    HOME: '/tmp/home',
    CUSTOM_TOKEN: 'custom-secret',
  });
});
