#!/usr/bin/env node

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const OPERATIONS = new Set([
  'overview',
  'find-symbol',
  'find-related',
  'trace-flow',
  'find-tests',
  'context-for-task',
]);
const CONTROLS = new Set([
  'status',
  'enable',
  'refresh',
  'disable',
  'clear',
  'explain',
  'auto',
  'not-now',
  'never',
]);
const TERMINAL_CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g;
const OSC_SEQUENCE = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;
const CSI_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]/g;

function humanText(value) {
  return String(value ?? '')
    .replaceAll(OSC_SEQUENCE, '')
    .replaceAll(CSI_SEQUENCE, '')
    .replaceAll(TERMINAL_CONTROLS, '');
}

function usage() {
  return `Usage:
  nectar atlas <operation> [query] [--path <project>] [--budget <characters>] [--limit <results>] [--json]
  nectar atlas <status|enable|refresh|disable|clear|explain> [--path <project>] [--json]

Operations:
  overview, find-symbol, find-related, trace-flow, find-tests, context-for-task

Lifecycle:
  status, enable, refresh, disable, clear, explain`;
}

function usageError(message) {
  const error = new Error(message);
  error.code = 'ATLAS_USAGE';
  return error;
}

function positiveInteger(value, option) {
  if (!/^[1-9]\d*$/.test(value || '')) {
    throw usageError(`${option} requires a positive integer`);
  }
  return Number(value);
}

export function parseAtlasArguments(argv, cwd = process.cwd()) {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { help: true };
  }
  const operation = argv[0];
  if (!OPERATIONS.has(operation) && !CONTROLS.has(operation)) {
    throw usageError(`Unknown Atlas operation: ${operation || ''}`);
  }
  const positional = [];
  const options = {
    operation,
    projectRoot: cwd,
    json: false,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      options.json = true;
    } else if (argument === '--path') {
      const value = argv[++index];
      if (!value) throw usageError('--path requires a project directory');
      options.projectRoot = path.resolve(cwd, value);
    } else if (argument === '--budget') {
      options.budget = positiveInteger(argv[++index], '--budget');
    } else if (argument === '--limit') {
      options.limit = positiveInteger(argv[++index], '--limit');
    } else if (argument.startsWith('-')) {
      throw usageError(`Unknown Atlas option: ${argument}`);
    } else {
      positional.push(argument);
    }
  }
  options.query = positional.join(' ').trim();
  if (OPERATIONS.has(operation) && operation !== 'overview' && !options.query) {
    throw usageError(`${operation} requires a query`);
  }
  return options;
}

export function renderAtlasPacket(packet) {
  if (packet.state === 'fallback') {
    return `Atlas fallback: ${humanText(packet.diagnostic.code)} — ${humanText(packet.diagnostic.reason)}`;
  }
  const heading = `Atlas ${packet.operation}: ${packet.evidence.length} result`
    + `${packet.evidence.length === 1 ? '' : 's'}`
    + `${packet.truncated ? ` (${packet.omitted} omitted)` : ''}`;
  const lines = packet.evidence.map((entry) => {
    const label = entry.name || entry.target || entry.snippet || entry.kind;
    return `${humanText(entry.path)}:${entry.line}  ${humanText(entry.reason)}  ${humanText(label)}`;
  });
  return [heading, ...lines].join('\n');
}

export function renderAtlasControl(operation, packet) {
  if (packet.state === 'fallback') {
    return `Atlas ${operation}: fallback${packet.reason ? ` — ${humanText(packet.reason)}` : ''}`;
  }
  if (operation === 'explain') return humanText(packet.message);
  if (operation === 'status') {
    const preference = packet.preference;
    const choice = preference.effective === 'enabled'
      ? `enabled (${preference.mode})`
      : packet.prompt?.required
        ? 'disabled (choice pending)'
        : `disabled (${preference.mode})`;
    const index = packet.index?.state === 'ready'
      ? packet.index.freshness?.state || 'ready'
      : 'absent';
    const prompt = packet.prompt?.required ? '; choice requested' : '';
    return `Atlas status: ${choice}; index ${index}${prompt}`;
  }
  if (operation === 'clear') {
    return `Atlas clear: ${packet.removed ? 'active worktree snapshot removed' : 'nothing to remove'}`;
  }
  if (operation === 'enable') {
    return `Atlas enable: enabled; index ${packet.index?.state || 'ready'}`;
  }
  if (operation === 'refresh') {
    return `Atlas refresh: ${packet.state}`;
  }
  const mode = packet.preference?.mode || packet.mode;
  return `Atlas ${operation}: ${packet.effective || packet.state}${mode ? ` (${mode})` : ''}`;
}

export async function runAtlas(argv, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  let options;
  try {
    options = parseAtlasArguments(argv, io.cwd || process.cwd());
    if (options.help) {
      stdout.write(`${usage()}\n`);
      return 0;
    }
    const atlasOptions = {
      cacheRoot: io.cacheRoot || process.env.NECTAR_ATLAS_CACHE_ROOT,
      beecodedHome: io.beecodedHome,
    };
    let packet;
    if (CONTROLS.has(options.operation)) {
      const {
        atlasStatus,
        chooseAtlas,
        clearAtlas,
        enableAtlas,
        refreshAtlas,
      } = await import('./atlas/control.mjs');
      if (options.operation === 'status') {
        packet = atlasStatus(options.projectRoot, atlasOptions);
      } else if (options.operation === 'enable') {
        const { createAtlasProgressRenderer } = await import('./atlas/progress.mjs');
        packet = await enableAtlas(options.projectRoot, {
          ...atlasOptions,
          onEvent: createAtlasProgressRenderer({
            stream: stderr,
            format: options.json ? 'json' : 'text',
          }),
        });
      } else if (options.operation === 'refresh') {
        const { createAtlasProgressRenderer } = await import('./atlas/progress.mjs');
        packet = await refreshAtlas(options.projectRoot, {
          ...atlasOptions,
          onEvent: createAtlasProgressRenderer({
            stream: stderr,
            format: options.json ? 'json' : 'text',
          }),
        });
      } else if (options.operation === 'clear') {
        packet = clearAtlas(options.projectRoot, atlasOptions);
      } else if (options.operation === 'explain') {
        packet = {
          state: 'ready',
          message: 'Atlas is an optional per-project local index. Enable builds it; disable keeps it; clear removes only this worktree snapshot.',
        };
      } else {
        packet = chooseAtlas(options.projectRoot, options.operation, atlasOptions);
      }
      stdout.write(options.json
        ? `${JSON.stringify(packet)}\n`
        : `${renderAtlasControl(options.operation, packet)}\n`);
      return packet.state === 'fallback' ? 1 : 0;
    }
    const { queryAtlas } = await import('./atlas/query.mjs');
    packet = queryAtlas(options.projectRoot, {
      operation: options.operation,
      query: options.query,
      budget: options.budget,
      limit: options.limit,
      cacheRoot: atlasOptions.cacheRoot,
    });
    stdout.write(options.json
      ? `${JSON.stringify(packet)}\n`
      : `${renderAtlasPacket(packet)}\n`);
    if (packet.state === 'fallback') {
      stderr.write(`[nectar] ${humanText(packet.diagnostic.code)}: ${humanText(packet.diagnostic.reason)}\n`);
      return 1;
    }
    return 0;
  } catch (error) {
    stderr.write(`[nectar] ${humanText(error.message)}\n${usage()}\n`);
    return error.code === 'ATLAS_USAGE' ? 2 : 1;
  }
}

async function main() {
  const code = await runAtlas(process.argv.slice(2));
  process.exitCode = code;
}

const isEntry = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  if (!process.env.NECTAR_ATLAS_NO_WARNINGS) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NECTAR_ATLAS_NO_WARNINGS: '1',
        NODE_NO_WARNINGS: '1',
      },
      stdio: 'inherit',
    });
    process.exitCode = child.status ?? 1;
  } else {
    await main();
  }
}
