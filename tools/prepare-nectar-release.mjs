#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageName = '@beecoded/nectar';

function fingerprint(packageRoot, files) {
  const hash = crypto.createHash('sha256');
  for (const { path: relative } of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const absolute = path.resolve(packageRoot, relative);
    const inside = path.relative(packageRoot, absolute);
    if (!inside || inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) {
      throw new Error(`Invalid package member: ${relative}`);
    }
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile()) throw new Error(`Package member must be a normal file: ${relative}`);
    hash.update(JSON.stringify([relative, stat.mode & 0o777, stat.size]));
    hash.update(fs.readFileSync(absolute));
  }
  return hash.digest('hex');
}

// Prepare only. Publication remains a separately authorized action on the returned
// tarball, never a fresh pack of a potentially changed workspace.
export function summarizeLog(content, failed) {
  const lines = content.split(/\r?\n/);
  const totals = lines.filter((line) => /^# (?:tests|pass|fail|cancelled|skipped|duration_ms) /.test(line)).slice(-6);
  const firstFailure = lines.findIndex((line) => /^\s*not ok \d|^(?:Error:|npm error|FAIL\b)/.test(line));
  const excerpt = failed
    ? (firstFailure < 0 ? lines.slice(-25) : lines.slice(firstFailure, firstFailure + 30))
    : (totals.length ? [] : lines.filter(Boolean).slice(-5));
  return [...excerpt, ...totals].filter(Boolean).join('\n').slice(0, 5000);
}

export function prepareNectarRelease({
  repoRoot = defaultRepoRoot,
  execute = spawnSync,
  temporaryRoot = os.tmpdir(),
  report = console.log,
} = {}) {
  let output;
  const verification = [];
  const run = (args, json = false) => {
    const log = json ? null : path.join(output, `${args[1].replace(/[^a-zA-Z0-9_-]/g, '-')}.log`);
    const descriptor = log ? fs.openSync(log, 'wx', 0o600) : null;
    const startedAt = Date.now();
    let result;
    try {
      result = execute('npm', args, {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: json ? ['ignore', 'pipe', 'inherit'] : ['ignore', descriptor, descriptor],
      });
    } finally {
      if (descriptor !== null) fs.closeSync(descriptor);
    }
    if (log) {
      const failed = Boolean(result.error || result.status !== 0);
      const elapsedMs = Date.now() - startedAt;
      verification.push({ command: ['npm', ...args], result: failed ? 'failed' : 'passed', elapsedMs, log });
      report(`[nectar-release] npm ${args.join(' ')}: ${failed ? 'failed' : 'passed'} (${elapsedMs} ms)\n${summarizeLog(fs.readFileSync(log, 'utf8'), failed)}\nFull log: ${log}`);
    }
    if (result.error || result.status !== 0) {
      throw new Error(`npm ${args.join(' ')} failed: ${result.error?.message || result.signal || result.status}`);
    }
    return json ? JSON.parse(result.stdout) : null;
  };
  const packArgs = ['pack', '--workspace', packageName, '--ignore-scripts', '--json'];
  const [inventory] = run([...packArgs, '--dry-run'], true);
  if (inventory.name !== packageName) throw new Error('Unexpected package in release inventory');
  const packageRoot = path.join(repoRoot, 'plugins', 'nectar');
  const sourceHash = fingerprint(packageRoot, inventory.files);
  const gates = [['run', 'test:nectar'], ['run', 'validate']];
  output = fs.mkdtempSync(path.join(temporaryRoot, 'nectar-release-'));
  try {
    for (const gate of gates) run(gate);
    if (fingerprint(packageRoot, inventory.files) !== sourceHash) {
      throw new Error('Package inputs changed during validation; prepare again from the intended state');
    }
    const [packed] = run([...packArgs, '--pack-destination', output], true);
    if (packed.name !== inventory.name || packed.version !== inventory.version
      || fingerprint(packageRoot, packed.files) !== sourceHash) {
      throw new Error('Package inputs changed during packing; archive is not validated');
    }
    if (path.basename(packed.filename) !== packed.filename || !packed.filename.endsWith('.tgz')) {
      throw new Error('Unexpected release archive filename');
    }
    const archive = path.join(output, packed.filename);
    const integrity = `sha512-${crypto.createHash('sha512').update(fs.readFileSync(archive)).digest('base64')}`;
    if (integrity !== packed.integrity) throw new Error('Release archive integrity mismatch');
    const result = {
      package: packed.name,
      version: packed.version,
      archive,
      integrity,
      sourceHash,
      verifiedAt: new Date().toISOString(),
      verification,
    };
    fs.writeFileSync(path.join(output, 'release.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
    return result;
  } catch (error) {
    // Keep diagnostic logs, but never leave an unvalidated release artifact.
    for (const entry of fs.readdirSync(output, { withFileTypes: true })) {
      if (entry.isFile() && (entry.name.endsWith('.tgz') || entry.name === 'release.json')) {
        fs.unlinkSync(path.join(output, entry.name));
      }
    }
    throw new Error(`${error.message}\nLogs retained at: ${output}`, { cause: error });
  }
}

if (process.argv[1]
  && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: node tools/prepare-nectar-release.mjs');
    console.log(JSON.stringify(prepareNectarRelease(), null, 2));
  } catch (error) {
    console.error(`[nectar-release] ${error.message}`);
    process.exitCode = 1;
  }
}
