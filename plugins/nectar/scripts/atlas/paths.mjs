import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { MANDATORY_EXCLUDED_DIRECTORIES } from './constants.mjs';
import { redactDiagnostic } from '../diagnostics.mjs';

function git(projectRoot, args, options = {}) {
  const spawn = options.spawn || spawnSync;
  return spawn('git', [
    '--no-optional-locks',
    '-c',
    'core.fsmonitor=false',
    ...args,
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function successfulGit(projectRoot, args, options = {}) {
  const result = git(projectRoot, args, options);
  if (result.status === 0) return result.stdout;
  const detail = redactDiagnostic(result.stderr || result.error?.message).trim().slice(0, 240);
  const error = new Error(`Unable to read Git worktree state: git ${args[0]}${detail ? `: ${detail}` : ''}`);
  error.code = 'ATLAS_GIT_STATE_UNAVAILABLE';
  throw error;
}

export function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function pathSegments(relativePath) {
  return relativePath.split(/[\\/]/).filter(Boolean);
}

export function mandatoryPathExclusionReason(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.includes('\0')) {
    return 'invalid-path';
  }
  if (path.isAbsolute(relativePath)) return 'outside-root';
  const segments = pathSegments(relativePath);
  if (!segments.length || segments.includes('..')) return 'outside-root';
  if (segments.some((segment) => MANDATORY_EXCLUDED_DIRECTORIES.has(segment.toLowerCase()))) {
    return 'excluded-path';
  }
  return null;
}

export function isSecretFilename(relativePath) {
  const base = path.posix.basename(relativePath.replaceAll('\\', '/')).toLowerCase();
  return base === '.env'
    || base.startsWith('.env.')
    || ['.netrc', '.npmrc', '.pypirc'].includes(base)
    || /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/.test(base)
    || /^(?:credentials?|secrets?)(?:\.[^.]+)?$/.test(base)
    || /\.(?:jks|key|keystore|p12|pem|pfx)$/.test(base);
}

function dirtyEntries(status) {
  const records = status.split('\0').filter(Boolean);
  const entries = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const statusCode = record.slice(0, 2);
    entries.push({ statusCode, path: record.slice(3) });
    if (/[RC]/.test(statusCode) && records[index + 1]) {
      entries.push({ statusCode: `${statusCode}:source`, path: records[index + 1] });
      index += 1;
    }
  }
  return entries
    .filter((entry) => (
      !mandatoryPathExclusionReason(entry.path)
      && !isSecretFilename(entry.path)
    ))
    .sort((left, right) => (
      left.path.localeCompare(right.path)
      || left.statusCode.localeCompare(right.statusCode)
    ));
}

function flaggedEntries(listing) {
  return listing.split('\0').filter(Boolean)
    .map((record) => ({
      tag: record[0],
      path: record.slice(2),
    }))
    .filter((entry) => (
      /^[a-z]$/.test(entry.tag) || entry.tag === 'S'
    ))
    .filter((entry) => (
      !mandatoryPathExclusionReason(entry.path)
      && !isSecretFilename(entry.path)
    ))
    .map((entry) => ({
      statusCode: `flag:${entry.tag}`,
      path: entry.path,
    }))
    .sort((left, right) => (
      left.path.localeCompare(right.path)
      || left.statusCode.localeCompare(right.statusCode)
    ));
}

function worktreeObjectFingerprint(projectRoot, relativePath) {
  const root = fs.realpathSync(projectRoot);
  const absolutePath = path.resolve(root, relativePath);
  if (!isPathInside(root, absolutePath)) return 'outside-root';

  let current = root;
  for (const segment of pathSegments(relativePath)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code === 'ENOENT') return 'missing';
      throw error;
    }
    if (stat.isSymbolicLink()) {
      return crypto.createHash('sha256')
        .update('symlink\0')
        .update(path.relative(root, current))
        .update('\0')
        .update(fs.readlinkSync(current))
        .digest('hex');
    }
  }

  let stat;
  try {
    stat = fs.lstatSync(absolutePath);
  } catch (error) {
    if (error.code === 'ENOENT') return 'missing';
    throw error;
  }
  const fingerprint = crypto.createHash('sha256')
    .update(`${stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other'}\0`)
    .update(`${stat.mode & 0o777}\0`);
  if (stat.isFile()) {
    fingerprint.update(fs.readFileSync(absolutePath));
  } else {
    fingerprint.update(`${stat.size}\0${stat.mtimeMs}`);
  }
  return fingerprint.digest('hex');
}

export function gitWorktreeState(projectRoot, options = {}) {
  const revision = successfulGit(
    projectRoot,
    ['rev-parse', 'HEAD', '--abbrev-ref', 'HEAD'],
    options,
  ).trim().split('\n');
  const head = revision[0];
  const branch = revision[1] && revision[1] !== 'HEAD' ? revision[1] : null;
  const status = successfulGit(projectRoot, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  ], options);
  const flags = successfulGit(projectRoot, ['ls-files', '-v', '-z'], options);
  const entries = [...dirtyEntries(status), ...flaggedEntries(flags)]
    .sort((left, right) => (
      left.path.localeCompare(right.path)
      || left.statusCode.localeCompare(right.statusCode)
    ));
  const fingerprint = crypto.createHash('sha256');
  fingerprint.update(`head\0${head}\0`);
  for (const entry of entries) {
    fingerprint.update(entry.statusCode);
    fingerprint.update('\0');
    fingerprint.update(entry.path);
    fingerprint.update('\0');
    fingerprint.update(worktreeObjectFingerprint(projectRoot, entry.path));
    fingerprint.update('\0');
  }
  const dirtyFiles = [...new Set(entries.map((entry) => entry.path))].sort();
  return {
    head,
    branch,
    dirtyFiles,
    dirty: dirtyFiles.length > 0,
    worktreeFingerprint: fingerprint.digest('hex'),
  };
}

export function containsSymlink(root, relativePath) {
  let current = root;
  for (const segment of pathSegments(relativePath)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) return true;
  }
  return false;
}

function stableId(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function canonicalFuturePath(value) {
  let existing = path.resolve(value);
  const missing = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(fs.realpathSync(existing), ...missing);
}

export function defaultAtlasCacheRoot({
  env = process.env,
  homeDirectory = os.homedir(),
  platform = process.platform,
} = {}) {
  if (env.XDG_CACHE_HOME) {
    return path.resolve(env.XDG_CACHE_HOME, 'beecoded', 'nectar', 'atlas');
  }
  if (platform === 'darwin') {
    return path.join(homeDirectory, 'Library', 'Caches', 'Beecoded', 'Nectar', 'Atlas');
  }
  if (platform === 'win32' && env.LOCALAPPDATA) {
    return path.resolve(env.LOCALAPPDATA, 'Beecoded', 'Nectar', 'Atlas');
  }
  return path.join(homeDirectory, '.cache', 'beecoded', 'nectar', 'atlas');
}

export function resolveRepositoryIdentity(projectRoot, {
  cacheRoot,
  spawn,
} = {}) {
  const requestedRoot = path.resolve(projectRoot);
  const requestedStat = fs.lstatSync(requestedRoot);
  if (requestedStat.isSymbolicLink()) {
    return {
      state: 'unsafe-root',
      reason: 'symlink-root',
      requestedRoot,
    };
  }
  if (!requestedStat.isDirectory()) {
    return {
      state: 'unsafe-root',
      reason: 'root-not-directory',
      requestedRoot,
    };
  }

  const identity = git(requestedRoot, [
    'rev-parse',
    '--show-toplevel',
    '--path-format=absolute',
    '--git-dir',
    '--git-common-dir',
  ], { spawn });
  if (identity.status !== 0) {
    return {
      state: 'not-git',
      reason: 'not-a-git-worktree',
      requestedRoot,
    };
  }

  const [topLevel, gitDirectory, commonDirectory, ...unexpected] = identity.stdout
    .trim()
    .split('\n');
  if (!topLevel || !commonDirectory || !gitDirectory || unexpected.length > 0) {
    return {
      state: 'not-git',
      reason: 'unreadable-git-identity',
      requestedRoot,
    };
  }
  const root = fs.realpathSync(topLevel);
  const gitDir = fs.realpathSync(gitDirectory);
  const commonGitDir = fs.realpathSync(commonDirectory);
  const resolvedCacheRoot = canonicalFuturePath(cacheRoot || defaultAtlasCacheRoot());
  if (isPathInside(root, resolvedCacheRoot)) {
    return {
      state: 'unsafe-cache',
      reason: 'cache-inside-worktree',
      requestedRoot,
      root,
      cacheRoot: resolvedCacheRoot,
    };
  }

  const repositoryId = stableId(commonGitDir);
  const worktreeId = stableId(root);
  return {
    state: 'ready',
    root,
    gitDir,
    commonGitDir,
    repositoryId,
    worktreeId,
    cacheRoot: resolvedCacheRoot,
    cachePath: path.join(resolvedCacheRoot, repositoryId, 'atlas.sqlite'),
  };
}

export function assertSafeAtlasCachePath(repository) {
  if (!repository || repository.state !== 'ready') {
    throw new Error('Atlas database requires a ready repository identity');
  }

  const expectedPath = path.join(
    repository.cacheRoot,
    repository.repositoryId,
    'atlas.sqlite',
  );
  const cachePath = canonicalFuturePath(repository.cachePath);
  const safeCachePath = canonicalFuturePath(expectedPath);
  if (
    cachePath !== safeCachePath
    || !isPathInside(repository.cacheRoot, cachePath)
    || isPathInside(repository.root, cachePath)
  ) {
    throw new Error('Atlas database path is outside the safe Beecoded cache path');
  }

  return cachePath;
}
