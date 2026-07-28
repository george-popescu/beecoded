#!/usr/bin/env node

import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const SERVER_NAME = 'nectar-atlas';
const SERVER_VERSION = '3.1.0';
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
const CODEX_SANDBOX_META = 'codex/sandbox-state-meta';

const TOOLS = Object.freeze([
  ['atlas_overview', 'overview', 'Get a compact overview of the indexed project.'],
  ['atlas_find_symbol', 'find-symbol', 'Find an indexed symbol with exact evidence first.'],
  ['atlas_find_related', 'find-related', 'Find graph and lexical evidence related to a symbol or path.'],
  ['atlas_trace_flow', 'trace-flow', 'Trace a bounded indexed call/import flow.'],
  ['atlas_find_tests', 'find-tests', 'Find tests related to an indexed path or symbol.'],
  ['atlas_context_for_task', 'context-for-task', 'Build a compact context packet for a task.'],
]);
const TOOL_OPERATIONS = new Map(TOOLS.map(([name, operation]) => [name, operation]));
const pendingClientRequests = new Map();
let nextClientRequestId = 1;
let clientSupportsRoots = false;
let allowedRootsPromise = null;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function requestClient(method, params = {}) {
  const id = `nectar-atlas-${nextClientRequestId++}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingClientRequests.delete(id);
      reject(new Error(`${method} timed out`));
    }, 2_000);
    pendingClientRequests.set(id, {
      resolve(value) {
        clearTimeout(timeout);
        resolve(value);
      },
      reject(error) {
        clearTimeout(timeout);
        reject(error);
      },
    });
    send({ jsonrpc: '2.0', id, method, params });
  });
}

function configuredAllowedRoots() {
  const configured = process.env.NECTAR_ATLAS_ALLOWED_ROOTS
    || process.env.NECTAR_ATLAS_PROJECT_ROOT;
  if (!configured) return [];
  let values;
  try {
    const parsed = JSON.parse(configured);
    values = Array.isArray(parsed) ? parsed : [configured];
  } catch {
    values = [configured];
  }
  return values.map((value) => fs.realpathSync(path.resolve(String(value))));
}

function rootPaths(result) {
  return (result?.roots || []).flatMap((root) => {
    try {
      if (typeof root?.uri !== 'string' || !root.uri.startsWith('file:')) return [];
      return [fs.realpathSync(fileURLToPath(root.uri))];
    } catch {
      return [];
    }
  });
}

function codexSandboxRoot(params) {
  const sandboxCwd = params?._meta?.[CODEX_SANDBOX_META]?.sandboxCwd;
  if (typeof sandboxCwd !== 'string' || !sandboxCwd.startsWith('file:')) return null;
  try {
    return fs.realpathSync(fileURLToPath(sandboxCwd));
  } catch {
    throw new Error('Codex sandboxCwd must be a valid existing file URI');
  }
}

async function allowedRoots(params) {
  const configured = configuredAllowedRoots();
  if (configured.length > 0) return configured;
  const codexRoot = codexSandboxRoot(params);
  if (codexRoot) return [codexRoot];
  if (!clientSupportsRoots) {
    throw new Error(
      'Atlas requires MCP workspace roots, Codex sandbox metadata, or NECTAR_ATLAS_PROJECT_ROOT',
    );
  }
  if (!allowedRootsPromise) {
    allowedRootsPromise = requestClient('roots/list')
      .then(rootPaths)
      .then((roots) => {
        if (roots.length === 0) throw new Error('MCP client returned no workspace roots');
        return roots;
      });
  }
  return allowedRootsPromise;
}

function pathAllowed(candidate, roots) {
  return roots.some((root) => (
    candidate === root || candidate.startsWith(`${root}${path.sep}`)
  ));
}

async function assertAllowedProject(projectRoot, cacheRoot, params) {
  const realProject = fs.realpathSync(projectRoot);
  const roots = await allowedRoots(params);
  if (!pathAllowed(realProject, roots)) {
    throw new Error('projectRoot is outside the active MCP workspace roots');
  }
  const { resolveRepositoryIdentity } = await import('../scripts/atlas/paths.mjs');
  const repository = resolveRepositoryIdentity(realProject, { cacheRoot });
  if (repository.state !== 'ready') {
    throw new Error(repository.reason || 'projectRoot is not a safe Git repository');
  }
  const realRepositoryRoot = fs.realpathSync(repository.root);
  if (!pathAllowed(realRepositoryRoot, roots)) {
    throw new Error('Git repository root is outside the active MCP workspace roots');
  }
  return {
    ...repository,
    root: realRepositoryRoot,
  };
}

function toolSchema(operation) {
  const properties = {
    projectRoot: {
      type: 'string',
      description: 'Absolute path to the Git project root or a directory inside it.',
    },
    budget: { type: 'integer', minimum: 1, maximum: 100000 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  };
  const required = ['projectRoot'];
  if (operation !== 'overview') {
    properties.query = { type: 'string', minLength: 1 };
    required.push('query');
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required,
  };
}

function listTools() {
  return TOOLS.map(([name, operation, description]) => ({
    name,
    description,
    inputSchema: toolSchema(operation),
  }));
}

function validateArguments(operation, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('arguments must be an object');
  }
  if (typeof value.projectRoot !== 'string' || !value.projectRoot.trim()) {
    throw new TypeError('projectRoot must be a non-empty string');
  }
  const projectRoot = path.resolve(value.projectRoot);
  if (operation !== 'overview' && (typeof value.query !== 'string' || !value.query.trim())) {
    throw new TypeError('query must be a non-empty string');
  }
  return {
    projectRoot,
    query: typeof value.query === 'string' ? value.query.trim() : '',
    ...(value.budget !== undefined ? { budget: value.budget } : {}),
    ...(value.limit !== undefined ? { limit: value.limit } : {}),
  };
}

async function handleToolCall(id, params) {
  const operation = TOOL_OPERATIONS.get(params?.name);
  if (!operation) {
    sendError(id, -32602, `Unknown Atlas tool: ${params?.name || ''}`);
    return;
  }
  try {
    const input = validateArguments(operation, params.arguments);
    const cacheRoot = process.env.NECTAR_ATLAS_CACHE_ROOT;
    const repository = await assertAllowedProject(
      input.projectRoot,
      cacheRoot,
      params,
    );
    input.projectRoot = repository.root;
    const { getAtlasPreference } = await import('../scripts/atlas/preferences.mjs');
    const preference = getAtlasPreference(input.projectRoot, {
      cacheRoot,
      repository,
    });
    let packet;
    if (preference.state === 'ready' && preference.effective !== 'enabled') {
      packet = {
        schema: 1,
        state: 'fallback',
        operation,
        query: input.query,
        fallback: true,
        snapshot: null,
        freshness: null,
        evidence: [],
        truncated: false,
        omitted: 0,
        omittedIsLowerBound: false,
        budget: { characters: input.budget || 6000, used: 0 },
        diagnostic: {
          code: 'ATLAS_DISABLED',
          reason: preference.shouldPrompt
            ? 'Atlas needs a one-time project choice'
            : 'Atlas is disabled for this project',
        },
      };
    } else {
      const { queryAtlas } = await import('../scripts/atlas/query.mjs');
      packet = queryAtlas(input.projectRoot, {
        operation,
        query: input.query,
        budget: input.budget,
        limit: input.limit,
        cacheRoot,
        repository,
      });
    }
    sendResult(id, {
      content: [{ type: 'text', text: JSON.stringify(packet) }],
      structuredContent: packet,
      isError: false,
    });
  } catch (error) {
    sendError(id, -32602, error.message);
  }
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    if (message?.id !== undefined) sendError(message.id, -32600, 'Invalid Request');
    return;
  }
  if (message.method === 'notifications/initialized') return;
  if (message.method === 'notifications/roots/list_changed') {
    allowedRootsPromise = null;
    return;
  }
  if (message.method === 'initialize') {
    clientSupportsRoots = Boolean(message.params?.capabilities?.roots);
    sendResult(message.id, {
      protocolVersion: typeof message.params?.protocolVersion === 'string'
        ? message.params.protocolVersion
        : DEFAULT_PROTOCOL_VERSION,
      capabilities: {
        tools: { listChanged: false },
        experimental: { [CODEX_SANDBOX_META]: {} },
      },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    });
    return;
  }
  if (message.method === 'ping') {
    sendResult(message.id, {});
    return;
  }
  if (message.method === 'tools/list') {
    sendResult(message.id, { tools: listTools() });
    return;
  }
  if (message.method === 'tools/call') {
    await handleToolCall(message.id, message.params);
    return;
  }
  if (message.id !== undefined) sendError(message.id, -32601, 'Method not found');
}

const input = readline.createInterface({ input: process.stdin, terminal: false });
input.on('line', async (line) => {
  try {
    const message = JSON.parse(line);
    const pending = pendingClientRequests.get(message?.id);
    if (pending && typeof message?.method !== 'string') {
      pendingClientRequests.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || 'Client request failed'));
      else pending.resolve(message.result);
      return;
    }
    await handle(message);
  } catch (error) {
    process.stderr.write(`[nectar-atlas] ${error.message}\n`);
  }
});
