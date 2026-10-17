import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { TextDecoder } from 'node:util';

import { classifyContextImpact } from './context/state.mjs';
import { inspectWorkTree } from './doctor/inspect.mjs';

const TOKEN_DOMAIN = Buffer.from('NECTAR_CLOSE_TOKEN_V1\0', 'utf8');
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_TOKEN_LENGTH = 16_384;
const fatalUtf8 = new TextDecoder('utf-8', { fatal: true });
const SCHEMA = 1;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function strictText(bytes, label) {
  try {
    return fatalUtf8.decode(bytes);
  } catch {
    throw new Error(`${label} must contain valid UTF-8`);
  }
}

function identity(stat) {
  return { dev: String(stat.dev), ino: String(stat.ino), mode: String(stat.mode) };
}

function sameIdentity(left, right) {
  return Boolean(left && right)
    && left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode;
}

function normalProjectRoot(projectRoot) {
  const requested = path.resolve(projectRoot);
  const before = fs.lstatSync(requested, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink()) throw new Error('project root must be a normal directory');
  const resolved = fs.realpathSync(requested);
  const after = fs.lstatSync(resolved, { bigint: true });
  if (!sameIdentity(identity(before), identity(after))) throw new Error('project root identity changed');
  return resolved;
}

function rootBinding(root) {
  return { identity: identity(fs.lstatSync(root, { bigint: true })), path: root };
}

function assertRootBinding(projectRoot, binding) {
  const root = normalProjectRoot(projectRoot);
  if (binding?.path !== root || !sameIdentity(binding?.identity, rootBinding(root).identity)) {
    throw new Error('token root replay or identity mismatch');
  }
  return root;
}

function encodeToken(kind, payload) {
  const body = stableJson({ kind, payload, version: SCHEMA });
  const checksum = sha256(Buffer.concat([TOKEN_DOMAIN, Buffer.from(body)]));
  return Buffer.from(stableJson({ body, checksum })).toString('base64url');
}

function decodeToken(token, expectedKind) {
  if (typeof token !== 'string' || token.length < 8 || token.length > MAX_TOKEN_LENGTH || !TOKEN_PATTERN.test(token)) {
    throw new Error('token must be bounded canonical base64url');
  }
  const decoded = Buffer.from(token, 'base64url');
  if (decoded.toString('base64url') !== token) throw new Error('token is not canonical base64url');
  let wrapper;
  try { wrapper = JSON.parse(strictText(decoded, 'token')); } catch { throw new Error('token JSON is invalid'); }
  if (stableJson(wrapper) !== strictText(decoded, 'token')) throw new Error('token wrapper is not canonical');
  if (typeof wrapper.body !== 'string'
    || wrapper.checksum !== sha256(Buffer.concat([TOKEN_DOMAIN, Buffer.from(wrapper.body)]))) {
    throw new Error('token checksum mismatch');
  }
  let body;
  try { body = JSON.parse(wrapper.body); } catch { throw new Error('token body is invalid'); }
  if (stableJson(body) !== wrapper.body || body.version !== SCHEMA || body.kind !== expectedKind) {
    throw new Error(`token kind/version mismatch: expected ${expectedKind}`);
  }
  return body.payload;
}

function safeRelative(value, label = 'path') {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) throw new Error(`${label} must be relative`);
  const posix = value.replaceAll('\\', '/').replace(/\/$/, '');
  if (posix.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`${label} must not traverse directories`);
  }
  return posix;
}

function noFollow(root, relative, expected = null) {
  let current = root;
  for (const [index, part] of safeRelative(relative).split('/').entries()) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { bigint: true });
    if (stat.isSymbolicLink()) throw new Error(`symbolic link is not allowed: ${relative}`);
    const leaf = index === relative.split('/').length - 1;
    if (!leaf && !stat.isDirectory()) throw new Error(`non-directory ancestor: ${relative}`);
    if (leaf && expected === 'file' && !stat.isFile()) throw new Error(`normal file required: ${relative}`);
    if (leaf && expected === 'directory' && !stat.isDirectory()) throw new Error(`normal directory required: ${relative}`);
  }
  return current;
}

function fsyncDirectory(directory) {
  const descriptor = fs.openSync(directory, 'r');
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function ensureNormalDirectory(parent, name, mode = 0o700) {
  const target = path.join(parent, name);
  if (!fs.existsSync(target)) fs.mkdirSync(target, { mode });
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${target} must be a normal directory`);
  return target;
}

function existingClosuresRoot(root) {
  const nectar = path.join(root, '.nectar');
  if (!fs.existsSync(nectar)) return null;
  const nectarStat = fs.lstatSync(nectar);
  if (nectarStat.isSymbolicLink() || !nectarStat.isDirectory()) throw new Error('.nectar must be a normal directory');
  const closures = path.join(nectar, 'closures');
  if (!fs.existsSync(closures)) return null;
  const closuresStat = fs.lstatSync(closures);
  if (closuresStat.isSymbolicLink() || !closuresStat.isDirectory()) throw new Error('.nectar/closures must be a normal directory');
  return closures;
}

function ensureClosuresLayout(root) {
  const nectar = ensureNormalDirectory(root, '.nectar');
  const closures = ensureNormalDirectory(nectar, 'closures');
  fs.chmodSync(closures, 0o700);
  return {
    archive: ensureNormalDirectory(closures, 'archive'),
    cancelled: ensureNormalDirectory(closures, 'cancelled'),
    closures,
    pending: ensureNormalDirectory(closures, 'pending'),
  };
}

function openState(layout) {
  const databasePath = path.join(layout.closures, 'state.sqlite');
  if (!fs.existsSync(databasePath)) {
    const descriptor = fs.openSync(databasePath, 'wx', 0o600);
    fs.closeSync(descriptor);
  }
  const before = fs.lstatSync(databasePath, { bigint: true });
  if (before.isSymbolicLink() || !before.isFile()) throw new Error('state.sqlite must be a normal file');
  const database = new DatabaseSync(databasePath, {
    allowExtension: false,
    enableForeignKeyConstraints: true,
    timeout: 1_000,
  });
  const after = fs.lstatSync(databasePath, { bigint: true });
  if (!sameIdentity(identity(before), identity(after))) {
    database.close();
    throw new Error('state.sqlite identity changed while opening');
  }
  fs.chmodSync(databasePath, 0o600);
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA journal_mode = DELETE');
  database.exec('PRAGMA synchronous = FULL');
  database.exec(`CREATE TABLE IF NOT EXISTS closure_state (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    current_id TEXT,
    manifest_hash TEXT,
    phase TEXT NOT NULL
  ) STRICT`);
  database.exec("INSERT OR IGNORE INTO closure_state(singleton, phase) VALUES (1, 'idle')");
  return database;
}

function transaction(database, callback) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const value = callback();
    database.exec('COMMIT');
    return value;
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK');
    throw error;
  }
}

function capabilityProbe(layout) {
  const root = path.join(layout.closures, `.probe-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  fs.mkdirSync(root, { mode: 0o700 });
  const file = path.join(root, 'file');
  const descriptor = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeSync(descriptor, Buffer.from('probe'));
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  fsyncDirectory(root);
  const source = path.join(root, 'source');
  const target = path.join(root, 'target');
  fs.mkdirSync(source);
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'occupied'), 'x');
  let refused = false;
  try { fs.renameSync(source, target); } catch { refused = true; }
  if (!refused) throw new Error('filesystem replaces non-empty directories during rename');
  fs.rmdirSync(source);
  fs.unlinkSync(path.join(target, 'occupied'));
  fs.rmdirSync(target);
  fs.unlinkSync(file);
  fs.rmdirSync(root);
}

function runGit(root, args, { buffer = false, allowFailure = false } = {}) {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (name.startsWith('GIT_')) delete environment[name];
  }
  environment.GIT_OPTIONAL_LOCKS = '0';
  const result = spawnSync('git', [
    '--no-optional-locks',
    '-c',
    'core.fsmonitor=false',
    ...args,
  ], {
    cwd: root,
    encoding: buffer ? null : 'utf8',
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw new Error(`git ${args[0]} failed: ${(result.stderr || result.error?.message || '').toString().trim()}`);
  }
  return result;
}

function headCommit(root) {
  return runGit(root, ['rev-parse', 'HEAD']).stdout.trim();
}

function trackingClass(root, relative) {
  if (runGit(root, ['ls-files', '--error-unmatch', '--', relative], { allowFailure: true }).status === 0) return 'tracked';
  if (runGit(root, ['check-ignore', '-q', '--no-index', '--', relative], { allowFailure: true }).status === 0) return 'ignored';
  return 'untracked';
}

function scanNormalFile(root, relative, owner) {
  const absolute = noFollow(root, relative, 'file');
  const before = fs.lstatSync(absolute, { bigint: true });
  const bytes = fs.readFileSync(absolute);
  strictText(bytes, relative);
  const after = fs.lstatSync(absolute, { bigint: true });
  if (!sameIdentity(identity(before), identity(after))) throw new Error(`identity changed while reading: ${relative}`);
  return {
    bytes: bytes.toString('base64'),
    identity: identity(after),
    owner,
    path: relative,
    sha256: sha256(bytes),
    size: Number(after.size),
    tracking: trackingClass(root, relative),
    type: 'file',
  };
}

function scanTree(root, relative, owner = 'topic') {
  const absolute = noFollow(root, relative, 'directory');
  const records = [];
  const visit = (directory, prefix) => {
    const directoryStat = fs.lstatSync(directory, { bigint: true });
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new Error(`normal directory required: ${prefix}`);
    records.push({ identity: identity(directoryStat), path: prefix, type: 'directory' });
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const childRelative = `${prefix}/${entry.name}`;
      const child = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`symbolic link is not allowed: ${childRelative}`);
      if (entry.isDirectory()) visit(child, childRelative);
      else if (entry.isFile()) records.push(scanNormalFile(root, childRelative, owner));
      else throw new Error(`special file is not allowed: ${childRelative}`);
    }
  };
  visit(absolute, relative);
  return records;
}

function scanImmutableTree(root, relative) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) {
    const snapshot = { path: relative, records: [], state: 'absent' };
    return { ...snapshot, hash: sha256(Buffer.from(stableJson(snapshot))) };
  }
  noFollow(root, relative, 'directory');
  const records = [];
  const visit = (directory, prefix) => {
    const directoryStat = fs.lstatSync(directory, { bigint: true });
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      throw new Error(`immutable root must contain only normal directories: ${prefix}`);
    }
    records.push({ identity: identity(directoryStat), path: prefix, type: 'directory' });
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const childRelative = `${prefix}/${entry.name}`;
      const child = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`immutable root contains symbolic link: ${childRelative}`);
      if (entry.isDirectory()) visit(child, childRelative);
      else if (entry.isFile()) {
        const before = fs.lstatSync(child, { bigint: true });
        const bytes = fs.readFileSync(child);
        const after = fs.lstatSync(child, { bigint: true });
        if (!sameIdentity(identity(before), identity(after))) {
          throw new Error(`immutable file identity changed while reading: ${childRelative}`);
        }
        records.push({
          identity: identity(after),
          path: childRelative,
          sha256: sha256(bytes),
          size: Number(after.size),
          type: 'file',
        });
      } else throw new Error(`immutable root contains special file: ${childRelative}`);
    }
  };
  visit(absolute, relative);
  const snapshot = { path: relative, records, state: 'present' };
  return { ...snapshot, hash: sha256(Buffer.from(stableJson(snapshot))) };
}

function assertImmutableSnapshot(root, expected) {
  const current = scanImmutableTree(root, expected.path);
  if (current.hash !== expected.hash) throw new Error(`${expected.path} immutable snapshot changed`);
}

function trackedTopicPathsAtHead(root, topicPath, head) {
  const output = runGit(
    root,
    ['ls-tree', '-r', '-z', '--name-only', head, '--', topicPath],
    { buffer: true },
  ).stdout;
  return nulPaths(output).sort();
}

function includeAbsentTrackedTopicRecords(root, topicPath, head, records) {
  const present = new Set(records.map((record) => record.path));
  const additions = [];
  for (const relative of trackedTopicPathsAtHead(root, topicPath, head)) {
    if (present.has(relative) || fs.existsSync(path.join(root, relative))) continue;
    const bytes = blobBytesAt(root, head, relative);
    if (!bytes) throw new Error(`tracked topic path is absent from both HEAD and worktree: ${relative}`);
    strictText(bytes, relative);
    additions.push({
      bytes: bytes.toString('base64'),
      identity: null,
      owner: 'topic',
      path: relative,
      sha256: sha256(bytes),
      size: bytes.length,
      state: 'absent',
      tracking: 'tracked',
      type: 'file',
    });
  }
  return [...records, ...additions].sort((left, right) => left.path.localeCompare(right.path));
}

function topicToken(root, topicPath) {
  return encodeToken('topic', { root: rootBinding(root), topicPath });
}

function supportToken(root, relative, record) {
  return encodeToken('support', {
    path: relative,
    root: rootBinding(root),
    sha256: record.sha256,
  });
}

function diagnosticsFor(report, topicPath) {
  return report.diagnostics.filter((diagnostic) => (
    diagnostic.severity === 'error'
    && (diagnostic.path === topicPath || diagnostic.path.startsWith(`${topicPath}/`))
  ));
}

export function discoverCloseTopics({ projectRoot = process.cwd() } = {}) {
  const root = normalProjectRoot(projectRoot);
  const report = inspectWorkTree(root);
  const entries = [];
  for (const topic of report.topics) {
    let closable = false;
    let reason = null;
    if (topic.kind === 'nested') reason = 'nested topics are parent-owned and cannot close independently';
    else if (topic.status !== 'done') reason = `topic status is ${topic.status || 'unknown'}`;
    else if (diagnosticsFor(report, topic.path).length) reason = 'topic has blocking structural diagnostics';
    else if ([...stagedPaths(root)].some((relative) => (
      relative === topic.path || relative.startsWith(`${topic.path}/`)
    ))) reason = 'topic has staged index state and cannot be closed safely';
    else {
      try {
        scanTree(root, topic.path);
        closable = topic.kind === 'direct' || topic.kind === 'legacy' || topic.kind === 'parent';
        if (!closable) reason = `unsupported topic kind: ${topic.kind}`;
      } catch (error) { reason = error.message; }
    }
    entries.push({
      closable,
      displayPath: topic.path,
      kind: topic.kind,
      reason,
      status: topic.status,
      token: closable ? topicToken(root, topic.path) : null,
    });
  }
  return { diagnostics: report.diagnostics, entries };
}

function releaseBatchToken(root, topicPaths, assetsHash) {
  return encodeToken('release-batch', {
    assetsHash,
    root: rootBinding(root),
    topicPaths,
  });
}

export function discoverReleaseBatch({ projectRoot = process.cwd() } = {}) {
  const root = normalProjectRoot(projectRoot);
  const ordinary = discoverCloseTopics({ projectRoot: root });
  const rejected = [];
  const discrepancies = [];
  const eligible = [];
  for (const entry of ordinary.entries) {
    if (!entry.closable) {
      const destination = /staged index/i.test(entry.reason || '') ? discrepancies : rejected;
      destination.push({ displayPath: entry.displayPath, reason: entry.reason });
      continue;
    }
    if (entry.kind === 'legacy') {
      rejected.push({ displayPath: entry.displayPath, reason: 'release batch does not adjudicate legacy roots' });
      continue;
    }
    try {
      const records = scanTree(root, entry.displayPath);
      const tracking = trackingSummary(records);
      if (tracking !== 'ignored-or-untracked-only') {
        rejected.push({ displayPath: entry.displayPath, reason: `release batch requires ignored/untracked-only roots, found ${tracking}` });
        continue;
      }
      eligible.push({ ...entry, records, tracking });
    } catch (error) {
      discrepancies.push({ displayPath: entry.displayPath, reason: error.message });
    }
  }
  eligible.sort((left, right) => left.displayPath.localeCompare(right.displayPath));
  for (const [index, entry] of eligible.entries()) {
    for (const other of eligible.slice(index + 1)) {
      if (entry.displayPath.startsWith(`${other.displayPath}/`)
        || other.displayPath.startsWith(`${entry.displayPath}/`)) {
        discrepancies.push({
          displayPath: entry.displayPath,
          reason: `release batch topic roots overlap: ${entry.displayPath}, ${other.displayPath}`,
        });
      }
    }
  }
  let assets = null;
  try { assets = scanImmutableTree(root, 'assets'); }
  catch (error) { discrepancies.push({ displayPath: 'assets', reason: error.message }); }
  if (eligible.length < 2) discrepancies.push({
    displayPath: 'docs/work',
    reason: 'release batch requires at least two eligible roots',
  });
  const eligiblePaths = eligible.map((entry) => entry.displayPath);
  return {
    assets,
    batchToken: discrepancies.length || !assets
      ? null
      : releaseBatchToken(root, eligiblePaths, assets.hash),
    discrepancies,
    eligiblePaths,
    rejected,
  };
}

export function discoverCloseSupport({ projectRoot = process.cwd() } = {}) {
  const root = normalProjectRoot(projectRoot);
  const candidates = new Set(['CHANGELOG.md', 'docs/work/backlog.md']);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || ['.git', '.nectar', 'docs', 'node_modules'].includes(entry.name)) continue;
    candidates.add(`${entry.name}/CHANGELOG.md`);
  }
  const entries = [];
  const discrepancies = [];
  for (const relative of [...candidates].sort()) {
    if (!fs.existsSync(path.join(root, relative))) continue;
    try {
      const record = scanNormalFile(root, relative, 'support');
      entries.push({ displayPath: relative, token: supportToken(root, relative, record), tracking: record.tracking });
    } catch (error) { discrepancies.push({ displayPath: relative, error: error.message }); }
  }
  return { discrepancies, entries };
}

function topicFromToken(root, token) {
  const payload = decodeToken(token, 'topic');
  assertRootBinding(root, payload.root);
  const discovered = discoverCloseTopics({ projectRoot: root });
  const entry = discovered.entries.find((candidate) => candidate.token === token);
  if (!entry?.closable || entry.displayPath !== payload.topicPath) throw new Error('topic token is not current close discovery membership');
  return entry;
}

function supportsFromTokens(root, tokens) {
  const discovered = discoverCloseSupport({ projectRoot: root });
  return tokens.map((token) => {
    const payload = decodeToken(token, 'support');
    assertRootBinding(root, payload.root);
    const entry = discovered.entries.find((candidate) => candidate.token === token);
    if (!entry || entry.displayPath !== payload.path) throw new Error('support token is not current discovery membership');
    return scanNormalFile(root, entry.displayPath, 'support');
  }).sort((a, b) => a.path.localeCompare(b.path));
}

function batchFromToken(root, token) {
  const payload = decodeToken(token, 'release-batch');
  assertRootBinding(root, payload.root);
  const discovered = discoverReleaseBatch({ projectRoot: root });
  if (!discovered.batchToken
    || discovered.batchToken !== token
    || discovered.assets?.hash !== payload.assetsHash
    || stableJson(discovered.eligiblePaths) !== stableJson(payload.topicPaths)) {
    throw new Error('release batch token is not current release batch discovery membership');
  }
  const ordinary = discoverCloseTopics({ projectRoot: root });
  const entries = payload.topicPaths.map((topicPath) => {
    const entry = ordinary.entries.find((candidate) => candidate.displayPath === topicPath);
    if (!entry?.closable || entry.kind === 'legacy') throw new Error(`release batch member is no longer eligible: ${topicPath}`);
    return entry;
  });
  return { assets: discovered.assets, entries };
}

function planFiles(root, topic) {
  const rootPath = noFollow(root, topic.displayPath, 'directory');
  const candidates = [];
  if (topic.kind === 'parent') {
    for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
      if (entry.isDirectory() && /^\d{2}-/.test(entry.name)) candidates.push(`${topic.displayPath}/${entry.name}/plan.md`);
    }
  } else candidates.push(`${topic.displayPath}/plan.md`);
  const files = new Set();
  for (const relative of candidates) {
    const content = strictText(fs.readFileSync(noFollow(root, relative, 'file')), relative);
    for (const file of declaredFiles(content)) files.add(file);
  }
  return [...files].sort();
}

function declaredFiles(content) {
  const files = new Set();
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*- files:\s*(.+)$/);
    if (!match) continue;
    for (const item of match[1].matchAll(/`([^`]+)`/g)) files.add(safeRelative(item[1], 'plan file'));
  }
  return [...files].sort();
}

function activeOwnershipOverlap(root, selectedTopics, selectedFiles) {
  const report = inspectWorkTree(root);
  const selected = new Set(selectedFiles);
  const selectedPaths = (Array.isArray(selectedTopics) ? selectedTopics : [selectedTopics])
    .map((topic) => topic.displayPath);
  const overlaps = [];
  for (const topic of report.topics) {
    if (selectedPaths.some((selectedPath) => (
      topic.path === selectedPath
      || topic.path.startsWith(`${selectedPath}/`)
      || selectedPath.startsWith(`${topic.path}/`)
    ))
      || topic.kind === 'parent'
      || topic.status === 'done'
      || topic.status === 'legacy-needing-adjudication') continue;
    const planRelative = `${topic.path}/plan.md`;
    if (!fs.existsSync(path.join(root, planRelative))) continue;
    let owned;
    try {
      const content = strictText(fs.readFileSync(noFollow(root, planRelative, 'file')), planRelative);
      owned = declaredFiles(content);
    } catch (error) {
      throw new Error(`unsafe active plan prevents ownership proof: ${planRelative}: ${error.message}`);
    }
    const shared = owned.filter((relative) => selected.has(relative));
    if (shared.length) overlaps.push({ files: shared, topic: topic.path });
  }
  return overlaps;
}

function nulPaths(buffer) {
  return buffer.toString('utf8').split('\0').filter(Boolean).map((entry) => entry.replaceAll('\\', '/'));
}

function dirtyPaths(root) {
  return new Set([
    ...nulPaths(runGit(root, [
      'diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', 'HEAD', '--',
    ], { buffer: true }).stdout),
    ...nulPaths(runGit(root, ['ls-files', '--others', '--exclude-standard', '-z'], { buffer: true }).stdout),
  ]);
}

function stagedPaths(root) {
  return new Set(nulPaths(runGit(
    root,
    ['diff', '--no-ext-diff', '--no-textconv', '--cached', '--name-only', '-z', '--'],
    { buffer: true },
  ).stdout));
}

function snapshotDelivery(root, files) {
  const dirty = dirtyPaths(root);
  return files.map((relative) => {
    const requiresCommit = dirty.has(relative);
    if (!fs.existsSync(path.join(root, relative))) {
      assertDeliveryAbsenceHistory(root, headCommit(root), relative);
      return { owner: 'delivery', path: relative, requiresCommit, state: 'absent' };
    }
    return { ...scanNormalFile(root, relative, 'delivery'), requiresCommit, state: 'present' };
  });
}

function citedContextPaths(root) {
  const values = new Set();
  for (const relative of ['.nectar/CONTEXT.md', '.nectar/CONVENTIONS.md']) {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) continue;
    const content = strictText(fs.readFileSync(noFollow(root, relative, 'file')), relative);
    for (const match of content.matchAll(/source:\s+([^:\n]+):\d+\b/g)) values.add(match[1].trim());
  }
  return [...values];
}

function trackingSummary(records) {
  const values = new Set(records.filter((record) => record.type === 'file').map((record) => record.tracking));
  if (values.has('tracked') && values.size > 1) return 'mixed';
  if (values.has('tracked')) return 'tracked-only';
  return 'ignored-or-untracked-only';
}

function manifestHash(manifest) {
  return sha256(Buffer.from(`${stableJson(manifest)}\n`));
}

function writeFileDurable(file, bytes) {
  const descriptor = fs.openSync(file, 'wx', 0o600);
  try {
    let offset = 0;
    while (offset < bytes.length) offset += fs.writeSync(descriptor, bytes, offset);
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
}

function removeUnpublishedStage(stage, expectedManifestBytes, pendingDirectory) {
  if (!fs.existsSync(stage)) return;
  const stat = fs.lstatSync(stage);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('unpublished close stage is not a normal directory');
  const entries = fs.readdirSync(stage);
  if (stableJson(entries.sort()) !== stableJson(['manifest.json'])) {
    throw new Error(`unpublished close stage changed; retained recovery path: ${stage}`);
  }
  const manifestPath = path.join(stage, 'manifest.json');
  const manifestStat = fs.lstatSync(manifestPath);
  if (manifestStat.isSymbolicLink() || !manifestStat.isFile()
    || sha256(fs.readFileSync(manifestPath)) !== sha256(expectedManifestBytes)) {
    throw new Error(`unpublished close stage manifest changed; retained recovery path: ${stage}`);
  }
  fs.unlinkSync(manifestPath);
  fs.rmdirSync(stage);
  fsyncDirectory(pendingDirectory);
}

function readPendingAt(root, current) {
  const manifestPath = path.join(current, 'manifest.json');
  const before = fs.lstatSync(manifestPath, { bigint: true });
  if (before.isSymbolicLink() || !before.isFile()) throw new Error('pending manifest must be a normal file');
  const bytes = fs.readFileSync(manifestPath);
  const after = fs.lstatSync(manifestPath, { bigint: true });
  if (!sameIdentity(identity(before), identity(after))) throw new Error('pending manifest identity changed while reading');
  const manifest = JSON.parse(strictText(bytes, 'pending manifest'));
  if (stableJson(manifest) !== strictText(bytes, 'pending manifest').trim()) throw new Error('pending manifest is not canonical');
  return {
    manifest,
    manifestBytes: bytes,
    manifestHash: sha256(bytes),
    manifestIdentity: identity(after),
    manifestPath,
  };
}

function assertPendingManifestUnchanged(pendingState) {
  const current = readPendingAt(pendingState.root, pendingState.pending.pendingPath);
  if (current.manifestHash !== pendingState.manifestHash
    || !sameIdentity(current.manifestIdentity, pendingState.manifestIdentity)
    || !current.manifestBytes.equals(pendingState.manifestBytes)) {
    throw new Error('pending manifest changed after validation');
  }
}

export function inspectPendingClosure({ projectRoot = process.cwd() } = {}) {
  const root = normalProjectRoot(projectRoot);
  const closures = existingClosuresRoot(root);
  if (!closures) return null;
  const current = path.join(closures, 'pending', 'current');
  let location = 'current';
  let pendingPath = current;
  if (!fs.existsSync(current)) {
    const databasePath = path.join(closures, 'state.sqlite');
    if (!fs.existsSync(databasePath)) return null;
    const before = fs.lstatSync(databasePath, { bigint: true });
    if (before.isSymbolicLink() || !before.isFile()) throw new Error('state.sqlite must be a normal file');
    const database = new DatabaseSync(databasePath, { readOnly: true });
    const after = fs.lstatSync(databasePath, { bigint: true });
    if (!sameIdentity(identity(before), identity(after))) {
      database.close();
      throw new Error('state.sqlite identity changed while opening');
    }
    let row;
    try { row = database.prepare('SELECT current_id, manifest_hash, phase FROM closure_state WHERE singleton = 1').get(); }
    finally { database.close(); }
    if (!row?.current_id) {
      const cancelledRoot = path.join(closures, 'cancelled');
      const orphan = fs.readdirSync(cancelledRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(cancelledRoot, entry.name))
        .find((candidate) => fs.existsSync(path.join(candidate, 'cancel-intent.json')));
      if (!orphan) return null;
      location = 'cancelled';
      pendingPath = orphan;
      row = { current_id: path.basename(orphan), phase: 'cancel-recovery' };
    }
    const cancelled = path.join(closures, 'cancelled', row.current_id);
    const archived = path.join(closures, 'archive', row.current_id, 'pending');
    if (fs.existsSync(cancelled)) {
      location = 'cancelled';
      pendingPath = cancelled;
    } else if (fs.existsSync(archived)) {
      location = 'archive';
      pendingPath = archived;
    } else throw new Error(`closure state points to missing evidence: ${row.current_id}`);
  }
  const currentStat = fs.lstatSync(pendingPath);
  if (currentStat.isSymbolicLink() || !currentStat.isDirectory()) throw new Error('pending evidence must be a normal directory');
  const state = readPendingAt(root, pendingPath);
  return {
    id: state.manifest.id,
    location,
    manifestHash: state.manifestHash,
    pendingPath,
    pendingToken: encodeToken('pending', {
      id: state.manifest.id,
      manifestHash: state.manifestHash,
      root: rootBinding(root),
    }),
    phase: state.manifest.phase,
  };
}

function publishPreparedManifest(root, manifest, simulateFailureAfter) {
  const layout = ensureClosuresLayout(root);
  capabilityProbe(layout);
  const database = openState(layout);
  const bytes = Buffer.from(`${stableJson(manifest)}\n`);
  const hash = sha256(bytes);
  const stage = path.join(layout.pending, `.stage-${manifest.id}`);
  fs.mkdirSync(stage, { mode: 0o700 });
  writeFileDurable(path.join(stage, 'manifest.json'), bytes);
  fsyncDirectory(stage);
  const current = path.join(layout.pending, 'current');
  try {
    if (simulateFailureAfter === 'stage-ready') throw new Error('simulated failure after stage ready');
    transaction(database, () => {
      const row = database.prepare('SELECT current_id, manifest_hash, phase FROM closure_state WHERE singleton = 1').get();
      if (row.current_id || fs.existsSync(current)) throw new Error('pending closure already exists');
      fs.renameSync(stage, current);
      fsyncDirectory(layout.pending);
      if (simulateFailureAfter === 'pending-publish') throw new Error('simulated failure after pending publish');
      database.prepare("UPDATE closure_state SET current_id = ?, manifest_hash = ?, phase = 'prepared' WHERE singleton = 1")
        .run(manifest.id, hash);
    });
  } catch (error) {
    try { removeUnpublishedStage(stage, bytes, layout.pending); }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError], cleanupError.message);
    }
    throw error;
  } finally { database.close(); }
  const pendingToken = encodeToken('pending', { id: manifest.id, manifestHash: hash, root: rootBinding(root) });
  return {
    contextImpact: manifest.contextImpact,
    id: manifest.id,
    manifestHash: hash,
    pendingPath: current,
    pendingToken,
    tracking: manifest.tracking,
  };
}

export function prepareClosureFromToken({
  projectRoot = process.cwd(),
  simulateFailureAfter = null,
  supportTokens = [],
  topicToken: selectedTopicToken,
} = {}) {
  const root = normalProjectRoot(projectRoot);
  const existing = inspectPendingClosure({ projectRoot: root });
  if (existing) throw new Error(`pending closure already exists: ${existing.pendingPath}`);
  const topic = topicFromToken(root, selectedTopicToken);
  const preparedHead = headCommit(root);
  const topicRecords = includeAbsentTrackedTopicRecords(
    root,
    topic.displayPath,
    preparedHead,
    scanTree(root, topic.displayPath),
  );
  const supports = supportsFromTokens(root, supportTokens);
  const files = planFiles(root, topic);
  const ownershipOverlap = activeOwnershipOverlap(root, topic, files);
  if (ownershipOverlap.length) {
    throw new Error(`active plan ownership overlaps close scope: ${ownershipOverlap.map((item) => `${item.topic} [${item.files.join(', ')}]`).join('; ')}`);
  }
  const delivery = snapshotDelivery(root, files);
  const changedFiles = [...new Set([...files, ...supports.map((record) => record.path)])];
  const contextImpact = classifyContextImpact({ changedFiles, citedPaths: citedContextPaths(root) });
  const id = crypto.randomBytes(16).toString('hex');
  const manifest = {
    contextImpact,
    createdAt: new Date().toISOString(),
    delivery,
    head: preparedHead,
    id,
    phase: 'prepared',
    planFiles: files,
    ownershipOverlap,
    root: rootBinding(root),
    schema: SCHEMA,
    supports,
    topic: { kind: topic.kind, path: topic.displayPath, records: topicRecords },
    tracking: trackingSummary(topicRecords),
  };
  return publishPreparedManifest(root, manifest, simulateFailureAfter);
}

export function prepareReleaseBatchFromToken({
  batchToken,
  projectRoot = process.cwd(),
  simulateFailureAfter = null,
  supportTokens = [],
} = {}) {
  const root = normalProjectRoot(projectRoot);
  const existing = inspectPendingClosure({ projectRoot: root });
  if (existing) throw new Error(`pending closure already exists: ${existing.pendingPath}`);
  const selected = batchFromToken(root, batchToken);
  const preparedHead = headCommit(root);
  const topics = selected.entries.map((topic) => {
    const records = includeAbsentTrackedTopicRecords(
      root,
      topic.displayPath,
      preparedHead,
      scanTree(root, topic.displayPath),
    );
    const tracking = trackingSummary(records);
    if (tracking !== 'ignored-or-untracked-only') {
      throw new Error(`release batch member tracking changed: ${topic.displayPath} (${tracking})`);
    }
    return { kind: topic.kind, path: topic.displayPath, records, tracking };
  });
  const supports = supportsFromTokens(root, supportTokens);
  const files = [...new Set(selected.entries.flatMap((topic) => planFiles(root, topic)))].sort();
  const ownershipOverlap = activeOwnershipOverlap(root, selected.entries, files);
  if (ownershipOverlap.length) {
    throw new Error(`active plan ownership overlaps close scope: ${ownershipOverlap.map((item) => `${item.topic} [${item.files.join(', ')}]`).join('; ')}`);
  }
  assertImmutableSnapshot(root, selected.assets);
  const delivery = snapshotDelivery(root, files);
  const changedFiles = [...new Set([...files, ...supports.map((record) => record.path)])];
  const contextImpact = classifyContextImpact({ changedFiles, citedPaths: citedContextPaths(root) });
  const manifest = {
    contextImpact,
    createdAt: new Date().toISOString(),
    delivery,
    head: preparedHead,
    id: crypto.randomBytes(16).toString('hex'),
    immutable: { assets: selected.assets },
    mode: 'release-batch',
    ownershipOverlap,
    phase: 'prepared',
    planFiles: files,
    root: rootBinding(root),
    schema: SCHEMA,
    supports,
    topics,
    tracking: 'ignored-or-untracked-only',
  };
  const prepared = publishPreparedManifest(root, manifest, simulateFailureAfter);
  return { ...prepared, topics: topics.map((topic) => topic.path) };
}

function assertRecordCurrent(root, record) {
  if (record.state === 'absent') {
    if (fs.existsSync(path.join(root, record.path))) throw new Error(`prepared absence changed: ${record.path}`);
    return;
  }
  const current = scanNormalFile(root, record.path, record.owner);
  if (current.sha256 !== record.sha256 || current.size !== record.size) throw new Error(`prepared bytes changed: ${record.path}`);
}

function manifestTopics(manifest) {
  if (manifest.mode === 'release-batch') return manifest.topics;
  return [{ ...manifest.topic, tracking: manifest.tracking }];
}

export function cancelPendingClosure({
  pendingToken,
  projectRoot = process.cwd(),
  simulateFailureAfter = null,
} = {}) {
  const payload = decodeToken(pendingToken, 'pending');
  const root = assertRootBinding(projectRoot, payload.root);
  const pending = inspectPendingClosure({ projectRoot: root });
  if (!pending || pending.id !== payload.id || pending.manifestHash !== payload.manifestHash) {
    throw new Error('pending token does not match current closure');
  }
  const current = pending.pendingPath;
  const { manifest } = readPendingAt(root, current);
  for (const topic of manifestTopics(manifest)) {
    for (const record of topic.records.filter((record) => record.type === 'file')) assertRecordCurrent(root, record);
  }
  for (const record of manifest.supports) assertRecordCurrent(root, record);
  const layout = ensureClosuresLayout(root);
  const destination = path.join(layout.cancelled, manifest.id);
  if (fs.existsSync(destination) && path.resolve(current) !== path.resolve(destination)) {
    throw new Error('cancelled closure destination already exists');
  }
  const intentPath = path.join(current, 'cancel-intent.json');
  if (!fs.existsSync(intentPath)) {
    writeFileDurable(
      intentPath,
      Buffer.from(`${stableJson({ id: manifest.id, manifestHash: pending.manifestHash, schema: SCHEMA })}\n`),
    );
    fsyncDirectory(current);
  }
  const database = openState(layout);
  try {
    transaction(database, () => {
      const row = database.prepare('SELECT current_id, manifest_hash FROM closure_state WHERE singleton = 1').get();
      if (!(pending.location === 'cancelled' && !row.current_id)) {
        ensureStateOwnership(database, { manifest, manifestHash: pending.manifestHash, pending });
      }
      if (path.resolve(current) !== path.resolve(destination)) {
        fs.renameSync(current, destination);
        fsyncDirectory(layout.cancelled);
        fsyncDirectory(layout.pending);
      }
      if (simulateFailureAfter === 'cancel-move') throw new Error('simulated failure after cancel move');
      database.prepare("UPDATE closure_state SET current_id = NULL, manifest_hash = NULL, phase = 'idle' WHERE singleton = 1").run();
    });
  } finally { database.close(); }
  const relocatedIntent = path.join(destination, 'cancel-intent.json');
  if (fs.existsSync(relocatedIntent)) fs.renameSync(relocatedIntent, path.join(destination, 'cancelled.json'));
  fsyncDirectory(destination);
  return { cancelledPath: destination, id: manifest.id };
}

function isAncestor(root, ancestor, descendant) {
  return runGit(root, ['merge-base', '--is-ancestor', ancestor, descendant], { allowFailure: true }).status === 0;
}

function blobBytesAt(root, commit, relative) {
  const tree = runGit(root, ['ls-tree', '-z', '--full-tree', commit, '--', relative], { buffer: true, allowFailure: true });
  if (tree.status !== 0 || !tree.stdout.length) return null;
  for (const entry of tree.stdout.toString('utf8').split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t');
    if (tab === -1 || entry.slice(tab + 1) !== relative) continue;
    const metadata = entry.slice(0, tab).split(' ');
    if (metadata[1] !== 'blob' || !metadata[2]) return null;
    const blob = runGit(root, ['cat-file', 'blob', metadata[2]], { buffer: true });
    return blob.stdout;
  }
  return null;
}

function commitRange(root, ancestor, descendant) {
  const output = runGit(root, ['rev-list', '--reverse', `${ancestor}..${descendant}`]).stdout;
  return [ancestor, ...output.split('\n').filter(Boolean)];
}

function deletedPaths(root, ancestor, descendant) {
  return new Set(nulPaths(runGit(
    root,
    [
      'diff', '--no-ext-diff', '--no-textconv', '--diff-filter=D',
      '--name-only', '-z', ancestor, descendant, '--',
    ],
    { buffer: true },
  ).stdout));
}

function assertTrackedHistory(root, manifest, currentHead) {
  const commits = commitRange(root, manifest.head, currentHead);
  const deleted = deletedPaths(root, manifest.head, currentHead);
  const tracked = manifestTopics(manifest)
    .flatMap((topic) => topic.records)
    .filter((record) => record.type === 'file' && record.tracking === 'tracked');
  for (const record of tracked) {
    const preserved = commits.some((commit) => {
      const bytes = blobBytesAt(root, commit, record.path);
      return bytes && sha256(bytes) === record.sha256;
    });
    if (!preserved) throw new Error(`tracked topic bytes were never committed exactly: ${record.path}`);
    if (blobBytesAt(root, currentHead, record.path) !== null || !deleted.has(record.path)) {
      throw new Error(`tracked topic deletion is not committed: ${record.path}`);
    }
    if (fs.existsSync(path.join(root, record.path))) throw new Error(`tracked topic path remains in worktree: ${record.path}`);
  }
  return tracked;
}

function assertDeliveryAbsenceHistory(root, commit, relative) {
  if (blobBytesAt(root, commit, relative) !== null) return;
  const deletion = runGit(root, ['log', '-1', '--format=%H', '--diff-filter=D', commit, '--', relative]).stdout.trim();
  if (!deletion) throw new Error(`delivery absence has no deletion history: ${relative}`);
}

function assertDeliveryCommitted(root, manifest, currentHead, supportPosts = new Map()) {
  const dirty = dirtyPaths(root);
  for (const record of manifest.delivery) {
    if (dirty.has(record.path)) throw new Error(`delivery path remains dirty: ${record.path}`);
    if (record.state === 'absent') {
      if (blobBytesAt(root, currentHead, record.path) !== null) throw new Error(`delivery absence changed: ${record.path}`);
      assertDeliveryAbsenceHistory(root, currentHead, record.path);
      continue;
    }
    const bytes = blobBytesAt(root, currentHead, record.path);
    if (!bytes || sha256(bytes) !== record.sha256) throw new Error(`delivery prepared bytes are not in current HEAD: ${record.path}`);
  }
  for (const record of manifest.supports.filter((item) => item.tracking === 'tracked')) {
    const expected = supportPosts.get(record.path) || record;
    if (dirty.has(record.path)) throw new Error(`tracked support remains dirty: ${record.path}`);
    const bytes = blobBytesAt(root, currentHead, record.path);
    if (!bytes || sha256(bytes) !== expected.sha256) throw new Error(`tracked support bytes are not in current HEAD: ${record.path}`);
  }
}

function payloadFiles(directory) {
  if (!fs.existsSync(directory)) return null;
  const rootStat = fs.lstatSync(directory, { bigint: true });
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error(`payload root must be a normal directory: ${directory}`);
  const files = [];
  const visit = (current, prefix = '') => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`payload contains symbolic link: ${relative}`);
      if (entry.isDirectory()) visit(absolute, relative);
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(absolute);
        files.push({ path: relative, sha256: sha256(bytes), size: bytes.length });
      } else throw new Error(`payload contains special file: ${relative}`);
    }
  };
  visit(directory);
  return files;
}

function expectedPayload(topic, { residueOnly = false } = {}) {
  const prefix = `${topic.path}/`;
  return topic.records
    .filter((record) => record.type === 'file' && (!residueOnly || record.tracking !== 'tracked'))
    .map((record) => ({
      path: record.path.slice(prefix.length),
      sha256: record.sha256,
      size: record.size,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function assertPayload(directory, expected, label) {
  const current = payloadFiles(directory);
  if (stableJson(current) !== stableJson(expected)) throw new Error(`${label} payload does not match prepared bytes`);
}

function publishArchive(layout, pendingState) {
  const destination = path.join(layout.archive, pendingState.manifest.id);
  if (fs.existsSync(destination)) {
    const existing = fs.readFileSync(noFollow(
      path.dirname(layout.closures),
      `closures/archive/${pendingState.manifest.id}/manifest.json`,
      'file',
    ));
    if (sha256(existing) !== pendingState.manifestHash) throw new Error('archive manifest collision');
    return destination;
  }
  const stage = path.join(layout.archive, `.stage-${pendingState.manifest.id}-${crypto.randomBytes(5).toString('hex')}`);
  fs.mkdirSync(stage, { mode: 0o700 });
  writeFileDurable(path.join(stage, 'manifest.json'), pendingState.manifestBytes);
  writeFileDurable(
    path.join(stage, 'result-pending.json'),
    Buffer.from(`${stableJson({ id: pendingState.manifest.id, manifestHash: pendingState.manifestHash, schema: SCHEMA })}\n`),
  );
  fsyncDirectory(stage);
  try { fs.renameSync(stage, destination); } catch (error) {
    if (!fs.existsSync(destination)) throw error;
    const existing = fs.readFileSync(path.join(destination, 'manifest.json'));
    if (sha256(existing) !== pendingState.manifestHash) throw new Error('archive manifest collision');
  }
  fsyncDirectory(layout.archive);
  return destination;
}

function assertPendingToken(projectRoot, token) {
  const payload = decodeToken(token, 'pending');
  const root = assertRootBinding(projectRoot, payload.root);
  let pending = inspectPendingClosure({ projectRoot: root });
  if (!pending) {
    const archivedPending = path.join(root, '.nectar', 'closures', 'archive', payload.id, 'pending');
    if (fs.existsSync(archivedPending)) {
      const state = readPendingAt(root, archivedPending);
      pending = {
        id: state.manifest.id,
        manifestHash: state.manifestHash,
        pendingPath: archivedPending,
        phase: state.manifest.phase,
      };
    }
  }
  if (!pending || pending.id !== payload.id || pending.manifestHash !== payload.manifestHash) {
    throw new Error('pending token does not match current closure');
  }
  const state = readPendingAt(root, pending.pendingPath);
  return { ...state, pending, root };
}

function ensureStateOwnership(database, pendingState) {
  const row = database.prepare('SELECT current_id, manifest_hash, phase FROM closure_state WHERE singleton = 1').get();
  if (!row.current_id && pendingState.pending.location === 'current') {
    database.prepare("UPDATE closure_state SET current_id = ?, manifest_hash = ?, phase = 'prepared' WHERE singleton = 1")
      .run(pendingState.manifest.id, pendingState.manifestHash);
    return;
  }
  if (row.current_id !== pendingState.manifest.id || row.manifest_hash !== pendingState.manifestHash) {
    throw new Error('closure state does not match pending manifest');
  }
}

function readSupportSeal(pendingState) {
  const sealPath = path.join(pendingState.pending.pendingPath, 'support-seal.json');
  if (!fs.existsSync(sealPath)) return { hash: null, posts: new Map() };
  const stat = fs.lstatSync(sealPath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('support seal must be a normal file');
  const bytes = fs.readFileSync(sealPath);
  const text = strictText(bytes, 'support seal');
  const seal = JSON.parse(text);
  if (stableJson(seal) !== text.trim()
    || seal.id !== pendingState.manifest.id
    || seal.manifestHash !== pendingState.manifestHash
    || seal.schema !== SCHEMA) throw new Error('support seal does not match pending manifest');
  const expectedPaths = pendingState.manifest.supports.map((record) => record.path).sort();
  const actualPaths = seal.supports.map((record) => record.path).sort();
  if (stableJson(actualPaths) !== stableJson(expectedPaths)) throw new Error('support seal path set changed');
  return { hash: sha256(bytes), posts: new Map(seal.supports.map((record) => [record.path, record])) };
}

export function sealPendingSupportFromToken({
  pendingToken,
  projectRoot = process.cwd(),
  simulateFailureAfter = null,
} = {}) {
  const pendingState = assertPendingToken(projectRoot, pendingToken);
  const { manifest, root } = pendingState;
  const sealPath = path.join(pendingState.pending.pendingPath, 'support-seal.json');
  if (fs.existsSync(sealPath)) return { supportSealHash: readSupportSeal(pendingState).hash };
  const supports = manifest.supports.map((record) => {
    const current = scanNormalFile(root, record.path, 'support');
    if (current.tracking !== record.tracking) throw new Error(`support tracking changed: ${record.path}`);
    return current;
  });
  const seal = { id: manifest.id, manifestHash: pendingState.manifestHash, schema: SCHEMA, supports };
  const bytes = Buffer.from(`${stableJson(seal)}\n`);
  const layout = ensureClosuresLayout(root);
  const database = openState(layout);
  try {
    transaction(database, () => {
      ensureStateOwnership(database, pendingState);
      writeFileDurable(sealPath, bytes);
      fsyncDirectory(pendingState.pending.pendingPath);
      if (simulateFailureAfter === 'support-seal-publish') {
        throw new Error('simulated failure after support seal publish');
      }
      database.prepare("UPDATE closure_state SET phase = 'support-sealed' WHERE singleton = 1").run();
    });
  } finally { database.close(); }
  return { supportSealHash: sha256(bytes), supports: supports.map((record) => record.path) };
}

function verifyTopicPreState(root, topic, tracked, archivedTopic) {
  const source = path.join(root, topic.path);
  const tracking = topic.tracking;
  if (tracking === 'tracked-only') {
    if (fs.existsSync(source)) throw new Error('tracked-only topic root must be absent after committed deletion');
    return { expected: [], source, topicResult: 'tracked-deletion-proven' };
  }
  const expected = expectedPayload(topic, { residueOnly: tracking === 'mixed' });
  if (fs.existsSync(source)) {
    assertPayload(source, expected, tracking === 'mixed' ? 'mixed residue' : 'ignored topic');
  } else if (fs.existsSync(archivedTopic)) {
    assertPayload(archivedTopic, expected, 'archived topic');
  } else {
    throw new Error('topic is absent from both prepared source and archive post-state');
  }
  if (tracking === 'mixed' && !tracked.length) throw new Error('mixed topic has no tracked history');
  return {
    expected,
    source,
    topicResult: tracking === 'mixed' ? 'archived-mixed-residue' : 'archived-ignored-or-untracked',
  };
}

function assertTrackingStable(root, manifest) {
  for (const topic of manifestTopics(manifest)) {
    for (const record of topic.records.filter((item) => item.type === 'file' && item.tracking !== 'tracked')) {
      const current = trackingClass(root, record.path);
      if (current !== record.tracking) {
        throw new Error(`topic tracking changed after prepare: ${record.path} (${record.tracking} -> ${current})`);
      }
    }
  }
}

function assertSupportTrackingStable(root, manifest) {
  for (const record of manifest.supports) {
    const current = trackingClass(root, record.path);
    if (current !== record.tracking) {
      throw new Error(`support tracking changed after prepare: ${record.path} (${record.tracking} -> ${current})`);
    }
  }
}

class SimulatedFinalizeFailure extends Error {}

function finalizeInternal({
  beforeArchivePublish,
  pendingToken,
  projectRoot,
  recovered,
  simulateFailureAfter,
}) {
  const initial = assertPendingToken(projectRoot, pendingToken);
  const root = initial.root;
  const manifest = initial.manifest;
  const topics = manifestTopics(manifest);
  const topicReferences = topics.map((topic) => ({ displayPath: topic.path }));
  const supportSeal = readSupportSeal(initial);
  const currentHead = headCommit(root);
  if (currentHead === manifest.head || !isAncestor(root, manifest.head, currentHead)) {
    throw new Error('finalize requires HEAD to change to a commit descended from prepared HEAD');
  }
  if (manifest.immutable?.assets) assertImmutableSnapshot(root, manifest.immutable.assets);
  const ownershipOverlap = activeOwnershipOverlap(root, topicReferences, manifest.planFiles);
  if (ownershipOverlap.length) {
    throw new Error(`active plan ownership overlaps close scope: ${ownershipOverlap.map((item) => `${item.topic} [${item.files.join(', ')}]`).join('; ')}`);
  }
  assertDeliveryCommitted(root, manifest, currentHead, supportSeal.posts);
  const tracked = assertTrackedHistory(root, manifest, currentHead);
  assertTrackingStable(root, manifest);
  assertSupportTrackingStable(root, manifest);
  for (const record of manifest.supports.filter((item) => item.tracking !== 'tracked')) {
    const expected = supportSeal.posts.get(record.path) || record;
    assertRecordCurrent(root, expected);
  }
  const layout = ensureClosuresLayout(root);
  const database = openState(layout);
  let archivePath;
  try {
    return transaction(database, () => {
      ensureStateOwnership(database, initial);
      if (manifest.immutable?.assets) assertImmutableSnapshot(root, manifest.immutable.assets);
      const currentOverlap = activeOwnershipOverlap(root, topicReferences, manifest.planFiles);
      if (currentOverlap.length) {
        throw new Error(`active plan ownership overlaps close scope: ${currentOverlap.map((item) => `${item.topic} [${item.files.join(', ')}]`).join('; ')}`);
      }
      assertDeliveryCommitted(root, manifest, currentHead, supportSeal.posts);
      const trackedNow = assertTrackedHistory(root, manifest, currentHead);
      assertTrackingStable(root, manifest);
      assertSupportTrackingStable(root, manifest);
      const predictedArchive = path.join(layout.archive, manifest.id);
      const predictedTopicRoot = manifest.mode === 'release-batch'
        ? path.join(predictedArchive, 'topics')
        : predictedArchive;
      const topicStates = topics.map((topic) => {
        const archivedTopic = manifest.mode === 'release-batch'
          ? path.join(predictedTopicRoot, path.basename(topic.path))
          : path.join(predictedTopicRoot, 'topic');
        const trackedForTopic = trackedNow.filter((record) => record.path.startsWith(`${topic.path}/`));
        return {
          archivedTopic,
          path: topic.path,
          state: verifyTopicPreState(root, topic, trackedForTopic, archivedTopic),
          tracking: topic.tracking,
        };
      });
      if (beforeArchivePublish !== undefined) {
        if (typeof beforeArchivePublish !== 'function') throw new Error('beforeArchivePublish must be a function');
        beforeArchivePublish();
      }
      assertPendingManifestUnchanged(initial);
      archivePath = publishArchive(layout, initial);
      if (simulateFailureAfter === 'archive-publish') {
        throw new SimulatedFinalizeFailure('simulated failure after archive publish');
      }
      if (manifest.mode === 'release-batch') {
        const topicsRoot = path.join(archivePath, 'topics');
        if (!fs.existsSync(topicsRoot)) {
          fs.mkdirSync(topicsRoot, { mode: 0o700 });
          fsyncDirectory(archivePath);
        }
      }
      for (const [index, topic] of topicStates.entries()) {
        if (topic.tracking !== 'tracked-only') {
          if (fs.existsSync(topic.state.source) && !fs.existsSync(topic.archivedTopic)) {
            if (fs.lstatSync(topic.state.source, { bigint: true }).dev !== fs.lstatSync(archivePath, { bigint: true }).dev) {
              throw new Error('topic and archive are not on the same filesystem');
            }
            fs.renameSync(topic.state.source, topic.archivedTopic);
            fsyncDirectory(path.dirname(topic.state.source));
            fsyncDirectory(path.dirname(topic.archivedTopic));
          }
          if (fs.existsSync(topic.state.source) || !fs.existsSync(topic.archivedTopic)) {
            throw new Error(`ambiguous topic archive state: ${topic.path}`);
          }
          assertPayload(topic.archivedTopic, topic.state.expected, `archived topic ${topic.path}`);
        } else if (fs.existsSync(topic.archivedTopic)) {
          throw new Error(`tracked-only archive must not contain a topic payload: ${topic.path}`);
        }
        if (simulateFailureAfter === 'topic-rename'
          || simulateFailureAfter === `topic-rename:${index}`) {
          throw new SimulatedFinalizeFailure(`simulated failure after topic rename ${index}`);
        }
      }

      const doctor = inspectWorkTree(root);
      const topicResults = topicStates.map((topic) => ({
        archivePath: topic.archivedTopic,
        path: topic.path,
        result: topic.state.topicResult,
        tracking: topic.tracking,
      }));
      const result = {
        archivePath,
        contextImpact: manifest.contextImpact,
        doctor: {
          errors: doctor.diagnostics.filter((item) => item.severity === 'error').length,
          warnings: doctor.diagnostics.filter((item) => item.severity === 'warning').length,
        },
        head: currentHead,
        id: manifest.id,
        manifestHash: initial.manifestHash,
        mode: manifest.mode || 'single',
        recoveryPath: archivePath,
        schema: SCHEMA,
        support: manifest.supports.map((record) => ({
          path: record.path,
          postSha256: (supportSeal.posts.get(record.path) || record).sha256,
          preSha256: record.sha256,
          state: supportSeal.posts.has(record.path) ? 'postimage-proven' : 'preimage-unchanged',
          tracking: record.tracking,
        })),
        topicResult: manifest.mode === 'release-batch'
          ? 'archived-release-batch'
          : topicResults[0].result,
        topics: topicResults,
        trackedFiles: tracked.map((record) => record.path),
      };
      const resultBytes = Buffer.from(`${stableJson(result)}\n`);
      const resultPath = path.join(archivePath, 'result.json');
      if (fs.existsSync(resultPath)) {
        if (sha256(fs.readFileSync(resultPath)) !== sha256(resultBytes)) throw new Error('archive result mismatch');
      } else writeFileDurable(resultPath, resultBytes);
      if (simulateFailureAfter === 'result-write') {
        throw new SimulatedFinalizeFailure('simulated failure after result write');
      }
      const pendingArchive = path.join(archivePath, 'pending');
      if (fs.existsSync(initial.pending.pendingPath)
        && path.resolve(initial.pending.pendingPath) !== path.resolve(pendingArchive)) {
        assertPendingManifestUnchanged(initial);
        if (fs.existsSync(pendingArchive)) throw new Error('archive pending collision');
        fs.renameSync(initial.pending.pendingPath, pendingArchive);
        fsyncDirectory(layout.pending);
        fsyncDirectory(archivePath);
      }
      if (simulateFailureAfter === 'pending-move') throw new SimulatedFinalizeFailure('simulated failure after pending move');
      database.prepare("UPDATE closure_state SET current_id = NULL, manifest_hash = NULL, phase = 'idle' WHERE singleton = 1").run();
      if (simulateFailureAfter === 'db-idle') throw new SimulatedFinalizeFailure('simulated failure after database idle phase');
      return result;
    });
  } catch (error) {
    if (error instanceof SimulatedFinalizeFailure) {
      return {
        archivePath,
        id: manifest.id,
        recoveryRequired: true,
        recoveryPath: archivePath,
      };
    }
    throw error;
  } finally { database.close(); }
}

export function finalizeClosureFromToken({
  beforeArchivePublish,
  pendingToken,
  projectRoot = process.cwd(),
  simulateFailureAfter = null,
} = {}) {
  return finalizeInternal({
    beforeArchivePublish,
    pendingToken,
    projectRoot,
    recovered: false,
    simulateFailureAfter,
  });
}

export function recoverPendingClosure({ pendingToken, projectRoot = process.cwd() } = {}) {
  const result = finalizeInternal({
    beforeArchivePublish: undefined,
    pendingToken,
    projectRoot,
    recovered: true,
    simulateFailureAfter: null,
  });
  return { ...result, recovered: true };
}

export { manifestHash };
