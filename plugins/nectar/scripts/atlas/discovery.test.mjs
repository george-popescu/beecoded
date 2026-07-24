import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function git(root, ...args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function repositoryFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-atlas-discovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '--quiet');
  write(root, '.gitignore', '*.ignored\n');
  write(root, 'src/tracked.js', 'export const tracked = true;\n');
  git(root, 'add', '.gitignore', 'src/tracked.js');
  git(
    root,
    '-c',
    'user.name=Nectar Tests',
    '-c',
    'user.email=nectar@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'fixture',
  );
  return root;
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function loadDiscovery() {
  try {
    return await import('./discovery.mjs');
  } catch (error) {
    assert.fail(`Atlas repository discovery is not implemented: ${error.message}`);
  }
}

test('discovers tracked and eligible untracked files without modifying the repository', async (t) => {
  const root = repositoryFixture(t);
  write(root, 'src/untracked.ts', 'export const untracked = true;\n');
  write(root, 'debug.ignored', 'ignored\n');
  const beforeStatus = git(root, 'status', '--short');

  const { discoverRepository } = await loadDiscovery();
  const result = discoverRepository(root, {
    cacheRoot: path.join(path.dirname(root), 'atlas-cache'),
  });

  assert.equal(result.state, 'ready');
  assert.deepEqual(
    result.files.map((file) => file.path),
    ['.gitignore', 'src/tracked.js', 'src/untracked.ts'],
  );
  assert.equal(result.files.some((file) => file.path === 'debug.ignored'), false);
  assert.equal(isInside(root, result.repository.cachePath), false);
  assert.equal(fs.existsSync(result.repository.cachePath), false);
  assert.equal(git(root, 'status', '--short'), beforeStatus);
});

test('discovery never executes a repository-configured FSMonitor hook', async (t) => {
  const root = repositoryFixture(t);
  const hook = path.join(path.dirname(root), `${path.basename(root)}-fsmonitor.sh`);
  const marker = path.join(path.dirname(root), `${path.basename(root)}-invoked`);
  t.after(() => {
    fs.rmSync(hook, { force: true });
    fs.rmSync(marker, { force: true });
  });
  fs.writeFileSync(hook, `#!/bin/sh\nprintf invoked > ${JSON.stringify(marker)}\n`);
  fs.chmodSync(hook, 0o700);
  git(root, 'config', 'core.fsmonitor', hook);
  const { discoverRepository } = await loadDiscovery();

  const result = discoverRepository(root, {
    cacheRoot: path.join(path.dirname(root), 'atlas-cache'),
  });

  assert.equal(result.state, 'ready');
  assert.equal(fs.existsSync(marker), false);
});

test('rejects mandatory path, secret, symlink, and outside-root hazards before sampling', async (t) => {
  const root = repositoryFixture(t);
  const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.js`);
  t.after(() => fs.rmSync(outside, { force: true }));
  fs.writeFileSync(outside, 'export const outside = true;\n');

  const excludedPaths = [
    '.nectar/CONTEXT.md',
    '.nectar/context.json',
    'node_modules/pkg/index.js',
    'vendor/package/Library.php',
    'dist/bundle.js',
    'build/output.js',
    '.next/server.js',
    'coverage/report.js',
    '.cache/tool/state.json',
    'cache/compiler/output.js',
    'generated/client.js',
  ];
  for (const relativePath of excludedPaths) write(root, relativePath, 'do not read\n');
  write(root, 'config/.env', 'TOKEN=secret\n');
  write(root, 'keys/id_rsa', 'private key\n');
  write(root, 'ignored.ignored', 'ignored by git\n');
  fs.symlinkSync(outside, path.join(root, 'src/link.js'));
  git(root, 'add', '--force', ...excludedPaths, 'config/.env', 'keys/id_rsa', 'src/link.js');

  const sampled = [];
  const { classifyRepositoryFile, discoverRepository } = await loadDiscovery();
  const result = discoverRepository(root, {
    cacheRoot: path.join(path.dirname(root), 'atlas-cache'),
    readSample(absolutePath, maximumBytes) {
      sampled.push(path.relative(root, absolutePath).split(path.sep).join('/'));
      const handle = fs.openSync(absolutePath, 'r');
      try {
        const buffer = Buffer.alloc(maximumBytes);
        const bytesRead = fs.readSync(handle, buffer, 0, maximumBytes, 0);
        return buffer.subarray(0, bytesRead);
      } finally {
        fs.closeSync(handle);
      }
    },
  });

  const skipped = new Map(result.skipped.map((file) => [file.path, file.skipReason]));
  for (const relativePath of excludedPaths) {
    assert.equal(skipped.get(relativePath), 'excluded-path', relativePath);
  }
  assert.equal(skipped.get('config/.env'), 'secret-filename');
  assert.equal(skipped.get('keys/id_rsa'), 'secret-filename');
  assert.equal(skipped.get('src/link.js'), 'symlink');
  assert.equal(result.files.some((file) => file.path === 'ignored.ignored'), false);
  assert.deepEqual(
    sampled.filter((relativePath) => skipped.has(relativePath)),
    [],
  );

  const outsideResult = classifyRepositoryFile(root, '../outside.js', {
    readSample() {
      assert.fail('outside-root paths must be rejected before reads');
    },
  });
  assert.deepEqual(outsideResult, {
    path: '../outside.js',
    accepted: false,
    tier: 'metadata-only',
    skipReason: 'outside-root',
  });
});

test('uses at most a 64 KiB sample and rejects binary content', async (t) => {
  const root = repositoryFixture(t);
  write(root, 'src/large.txt', 'a'.repeat(96 * 1024));
  write(root, 'src/binary.dat', Buffer.from([0x41, 0x00, 0x42, 0x03]));
  git(root, 'add', 'src/large.txt', 'src/binary.dat');

  const sampleRequests = [];
  const { discoverRepository } = await loadDiscovery();
  const result = discoverRepository(root, {
    cacheRoot: path.join(path.dirname(root), 'atlas-cache'),
    readSample(absolutePath, maximumBytes) {
      sampleRequests.push({ absolutePath, maximumBytes });
      const handle = fs.openSync(absolutePath, 'r');
      try {
        const buffer = Buffer.alloc(maximumBytes);
        const bytesRead = fs.readSync(handle, buffer, 0, maximumBytes, 0);
        return buffer.subarray(0, bytesRead);
      } finally {
        fs.closeSync(handle);
      }
    },
  });

  assert.ok(sampleRequests.length > 0);
  assert.equal(
    sampleRequests.every((request) => request.maximumBytes <= 64 * 1024),
    true,
  );
  assert.equal(result.files.some((file) => file.path === 'src/binary.dat'), false);
  assert.deepEqual(
    result.skipped.find((file) => file.path === 'src/binary.dat'),
    {
      path: 'src/binary.dat',
      accepted: false,
      tier: 'metadata-only',
      skipReason: 'binary-content',
    },
  );
  assert.equal(result.files.some((file) => file.path === 'src/large.txt'), true);
});

test('assigns default content tiers and deterministic non-content reasons', async (t) => {
  const root = repositoryFixture(t);
  write(root, 'docs/medium.txt', `${'medium line\n'.repeat(48 * 1024)}x`);
  write(root, 'docs/oversized.txt', `${'oversized line\n'.repeat(150 * 1024)}x`);
  write(root, 'package-lock.json', '{"lockfileVersion":3}\n');
  write(root, 'src/application.js.map', '{"version":3,"sources":[]}\n');
  write(root, 'src/runtime.min.js', 'const minified=true;');
  write(root, 'src/generated-client.js', '/* @generated by schema compiler */\nexport {};\n');
  write(root, 'src/packed.js', 'const packed=true;'.repeat(5_000));
  git(
    root,
    'add',
    'docs/medium.txt',
    'docs/oversized.txt',
    'package-lock.json',
    'src/application.js.map',
    'src/runtime.min.js',
    'src/generated-client.js',
    'src/packed.js',
  );

  const { discoverRepository } = await loadDiscovery();
  const result = discoverRepository(root, {
    cacheRoot: path.join(path.dirname(root), 'atlas-cache'),
  });
  const files = new Map(result.files.map((file) => [file.path, file]));

  assert.equal(files.get('src/tracked.js').tier, 'ast+fts');
  assert.equal(files.get('docs/medium.txt').tier, 'fts-only');
  assert.equal(files.get('docs/medium.txt').skipReason, null);
  assert.equal(files.get('docs/oversized.txt').tier, 'metadata-only');
  assert.equal(files.get('docs/oversized.txt').skipReason, 'oversized');
  assert.equal(files.get('package-lock.json').tier, 'metadata-only');
  assert.equal(files.get('package-lock.json').skipReason, 'lockfile');
  assert.equal(files.get('src/application.js.map').skipReason, 'source-map');
  assert.equal(files.get('src/runtime.min.js').skipReason, 'minified-content');
  assert.equal(files.get('src/generated-client.js').skipReason, 'generated-content');
  assert.equal(files.get('src/packed.js').skipReason, 'minified-content');
});

test('applies size policy overrides without allowing safety overrides', async (t) => {
  const root = repositoryFixture(t);
  write(root, 'src/medium.txt', 'm\n'.repeat(40));
  write(root, 'src/large.txt', 'l\n'.repeat(70));
  write(root, 'node_modules/forced/index.js', 'do not read\n');
  write(root, '.env.production', 'PASSWORD=secret\n');
  git(
    root,
    'add',
    '--force',
    'src/medium.txt',
    'src/large.txt',
    'node_modules/forced/index.js',
    '.env.production',
  );

  const sampleLimits = [];
  const { discoverRepository } = await loadDiscovery();
  const result = discoverRepository(root, {
    cacheRoot: path.join(path.dirname(root), 'atlas-cache'),
    policy: {
      astMaxBytes: 64,
      ftsMaxBytes: 100,
      sampleBytes: 1024 * 1024,
      excludedDirectories: [],
      allowSecrets: true,
    },
    readSample(absolutePath, maximumBytes) {
      sampleLimits.push(maximumBytes);
      return fs.readFileSync(absolutePath).subarray(0, maximumBytes);
    },
  });
  const files = new Map(result.files.map((file) => [file.path, file]));
  const skipped = new Map(result.skipped.map((file) => [file.path, file.skipReason]));

  assert.deepEqual(result.policy, {
    astMaxBytes: 64,
    ftsMaxBytes: 100,
    sampleBytes: 64 * 1024,
  });
  assert.equal(files.get('src/medium.txt').tier, 'fts-only');
  assert.equal(files.get('src/large.txt').tier, 'metadata-only');
  assert.equal(files.get('src/large.txt').skipReason, 'oversized');
  assert.equal(skipped.get('node_modules/forced/index.js'), 'excluded-path');
  assert.equal(skipped.get('.env.production'), 'secret-filename');
  assert.equal(sampleLimits.every((limit) => limit <= 64 * 1024), true);
});

test('returns explicit fallback states for non-Git and unsafe repository identities', async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-atlas-fallback-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const plain = path.join(parent, 'plain');
  fs.mkdirSync(plain);

  const { discoverRepository } = await loadDiscovery();
  const nonGit = discoverRepository(plain, {
    cacheRoot: path.join(parent, 'cache'),
  });
  assert.equal(nonGit.state, 'not-git');
  assert.equal(nonGit.reason, 'not-a-git-worktree');
  assert.deepEqual(nonGit.files, []);

  const repository = repositoryFixture(t);
  const linkedRoot = path.join(parent, 'linked-root');
  fs.symlinkSync(repository, linkedRoot);
  const symlink = discoverRepository(linkedRoot, {
    cacheRoot: path.join(parent, 'cache'),
  });
  assert.equal(symlink.state, 'unsafe-root');
  assert.equal(symlink.reason, 'symlink-root');

  const unsafeCache = discoverRepository(repository, {
    cacheRoot: path.join(repository, '.atlas-cache'),
  });
  assert.equal(unsafeCache.state, 'unsafe-cache');
  assert.equal(unsafeCache.reason, 'cache-inside-worktree');
  assert.deepEqual(unsafeCache.files, []);
});
