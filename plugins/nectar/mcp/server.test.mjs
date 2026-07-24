import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync, spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { indexRepository } from '../scripts/atlas/indexer.mjs';
import { applyAtlasChoice } from '../scripts/atlas/preferences.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(packageRoot, 'mcp', 'server.mjs');
const cliPath = path.join(packageRoot, 'scripts', 'run-atlas.mjs');

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function fixture(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-atlas-mcp-'));
  const root = path.join(parent, 'repository');
  const cacheRoot = path.join(parent, 'cache');
  const beecodedHome = path.join(parent, 'home');
  fs.mkdirSync(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'atlas@example.test']);
  git(root, ['config', 'user.name', 'Atlas Test']);
  fs.writeFileSync(path.join(root, 'service.ts'), 'export class McpService {}\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'fixture']);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { root, cacheRoot, beecodedHome };
}

function startServer(t, cacheRoot, beecodedHome, roots = [], environment = {}) {
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      NECTAR_ATLAS_CACHE_ROOT: cacheRoot,
      BEECODED_HOME: beecodedHome,
      ...environment,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = readline.createInterface({ input: child.stdout });
  const responses = new Map();
  const waiters = new Map();
  lines.on('line', (line) => {
    const message = JSON.parse(line);
    if (message.method === 'roots/list') {
      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          roots: roots.map((root) => ({
            uri: pathToFileURL(root).href,
            name: path.basename(root),
          })),
        },
      })}\n`);
      return;
    }
    if (waiters.has(message.id)) {
      waiters.get(message.id)(message);
      waiters.delete(message.id);
    } else {
      responses.set(message.id, message);
    }
  });
  let nextId = 1;
  function request(method, params = {}) {
    const id = nextId++;
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    if (responses.has(id)) return Promise.resolve(responses.get(id));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`MCP timeout for ${method}`)), 5_000);
      waiters.set(id, (message) => {
        clearTimeout(timeout);
        resolve(message);
      });
    });
  }
  t.after(() => {
    lines.close();
    child.kill();
  });
  return { child, request };
}

test('implements MCP lifecycle and six stable Atlas tool schemas', async (t) => {
  const { cacheRoot, beecodedHome } = fixture(t);
  const server = startServer(t, cacheRoot, beecodedHome);

  const initialized = await server.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  });
  assert.equal(initialized.result.protocolVersion, '2025-06-18');
  assert.equal(initialized.result.serverInfo.name, 'nectar-atlas');
  assert.deepEqual(
    initialized.result.capabilities.experimental['codex/sandbox-state-meta'],
    {},
  );

  const listed = await server.request('tools/list');
  assert.deepEqual(
    listed.result.tools.map((tool) => tool.name),
    [
      'atlas_overview',
      'atlas_find_symbol',
      'atlas_find_related',
      'atlas_trace_flow',
      'atlas_find_tests',
      'atlas_context_for_task',
    ],
  );
  assert.ok(listed.result.tools.every((tool) => (
    tool.inputSchema.type === 'object'
    && tool.inputSchema.properties.projectRoot.type === 'string'
  )));
});

test('MCP structured content equals CLI JSON for the same query', async (t) => {
  const { root, cacheRoot, beecodedHome } = fixture(t);
  await indexRepository(root, { cacheRoot });
  applyAtlasChoice(root, 'enable', { cacheRoot, beecodedHome });
  const server = startServer(t, cacheRoot, beecodedHome, [root]);
  await server.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: { roots: { listChanged: true } },
    clientInfo: { name: 'test', version: '1' },
  });

  const response = await server.request('tools/call', {
    name: 'atlas_find_symbol',
    arguments: { projectRoot: root, query: 'McpService' },
  });
  const cli = JSON.parse(execFileSync(process.execPath, [
    cliPath,
    'find-symbol',
    'McpService',
    '--path',
    root,
    '--json',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NECTAR_ATLAS_CACHE_ROOT: cacheRoot,
      BEECODED_HOME: beecodedHome,
    },
  }));

  assert.deepEqual(response.result.structuredContent, cli);
  assert.equal(response.result.isError, false);
  assert.equal(response.result.content[0].type, 'text');
});

test('one MCP query reuses the authorized repository identity', async (t) => {
  const { root, cacheRoot, beecodedHome } = fixture(t);
  await indexRepository(root, { cacheRoot });
  applyAtlasChoice(root, 'enable', { cacheRoot, beecodedHome });

  const wrapperRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-atlas-git-wrapper-'));
  const wrapper = path.join(wrapperRoot, 'git');
  const traceFile = path.join(wrapperRoot, 'calls.log');
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(wrapper, `#!/usr/bin/env node
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
fs.appendFileSync(process.env.ATLAS_GIT_TRACE_FILE, 'git\\n');
const result = spawnSync(process.env.ATLAS_REAL_GIT, process.argv.slice(2), { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
`);
  fs.chmodSync(wrapper, 0o700);
  t.after(() => fs.rmSync(wrapperRoot, { recursive: true, force: true }));

  const server = startServer(t, cacheRoot, beecodedHome, [root], {
    PATH: `${wrapperRoot}${path.delimiter}${process.env.PATH}`,
    ATLAS_REAL_GIT: realGit,
    ATLAS_GIT_TRACE_FILE: traceFile,
  });
  await server.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: { roots: { listChanged: true } },
    clientInfo: { name: 'test', version: '1' },
  });
  const response = await server.request('tools/call', {
    name: 'atlas_find_symbol',
    arguments: { projectRoot: root, query: 'McpService' },
  });

  assert.equal(response.result.structuredContent.state, 'ready');
  const calls = fs.readFileSync(traceFile, 'utf8').trim().split('\n').filter(Boolean);
  assert.ok(calls.length <= 4, `expected at most 4 Git processes, received ${calls.length}`);
});

test('rejects an enabled and indexed repository outside active MCP workspace roots', async (t) => {
  const allowed = fixture(t);
  const outside = fixture(t);
  await indexRepository(outside.root, { cacheRoot: outside.cacheRoot });
  applyAtlasChoice(outside.root, 'enable', {
    cacheRoot: outside.cacheRoot,
    beecodedHome: outside.beecodedHome,
  });
  const server = startServer(
    t,
    outside.cacheRoot,
    outside.beecodedHome,
    [allowed.root],
  );
  await server.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: { roots: { listChanged: true } },
    clientInfo: { name: 'test', version: '1' },
  });

  const response = await server.request('tools/call', {
    name: 'atlas_find_symbol',
    arguments: { projectRoot: outside.root, query: 'McpService' },
  });

  assert.equal(response.error.code, -32602);
  assert.match(response.error.message, /outside the active MCP workspace roots/);
});

test('does not climb from an allowed subdirectory into a repository outside the workspace root', async (t) => {
  const { root, cacheRoot, beecodedHome } = fixture(t);
  const nestedWorkspace = path.join(root, 'nested-workspace');
  fs.mkdirSync(nestedWorkspace);
  const server = startServer(t, cacheRoot, beecodedHome, [nestedWorkspace]);
  await server.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: { roots: { listChanged: true } },
    clientInfo: { name: 'test', version: '1' },
  });

  const response = await server.request('tools/call', {
    name: 'atlas_overview',
    arguments: { projectRoot: nestedWorkspace },
  });

  assert.equal(response.error.code, -32602);
  assert.match(response.error.message, /Git repository root is outside/);
});

test('authorizes current Codex through sandbox metadata without MCP roots support', async (t) => {
  const { root, cacheRoot, beecodedHome } = fixture(t);
  await indexRepository(root, { cacheRoot });
  applyAtlasChoice(root, 'enable', { cacheRoot, beecodedHome });
  const server = startServer(t, cacheRoot, beecodedHome);
  await server.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'codex-mcp-client', version: '0.144.4' },
  });

  const response = await server.request('tools/call', {
    name: 'atlas_overview',
    arguments: { projectRoot: root },
    _meta: {
      'codex/sandbox-state-meta': {
        permissionProfile: { type: 'workspace-write' },
        codexLinuxSandboxExe: null,
        sandboxCwd: pathToFileURL(root).href,
        useLegacyLandlock: false,
      },
    },
  });

  assert.equal(response.result.structuredContent.state, 'ready');
  assert.equal(response.result.isError, false);
});

test('Codex sandbox metadata cannot authorize a different project', async (t) => {
  const allowed = fixture(t);
  const outside = fixture(t);
  await indexRepository(outside.root, { cacheRoot: outside.cacheRoot });
  applyAtlasChoice(outside.root, 'enable', {
    cacheRoot: outside.cacheRoot,
    beecodedHome: outside.beecodedHome,
  });
  const server = startServer(t, outside.cacheRoot, outside.beecodedHome);
  await server.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'codex-mcp-client', version: '0.144.4' },
  });

  const response = await server.request('tools/call', {
    name: 'atlas_overview',
    arguments: { projectRoot: outside.root },
    _meta: {
      'codex/sandbox-state-meta': {
        sandboxCwd: pathToFileURL(allowed.root).href,
      },
    },
  });

  assert.equal(response.error.code, -32602);
  assert.match(response.error.message, /outside the active MCP workspace roots/);
});

test('returns protocol errors for invalid tools and arguments without polluting stdout', async (t) => {
  const { cacheRoot, beecodedHome } = fixture(t);
  const server = startServer(t, cacheRoot, beecodedHome);
  await server.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  });

  const unknown = await server.request('tools/call', {
    name: 'atlas_destroy',
    arguments: {},
  });
  assert.equal(unknown.error.code, -32602);

  const invalid = await server.request('tools/call', {
    name: 'atlas_find_symbol',
    arguments: { projectRoot: '', query: 'x' },
  });
  assert.equal(invalid.error.code, -32602);
});
