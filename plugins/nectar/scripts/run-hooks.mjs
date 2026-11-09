#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readTelemetry, configureTelemetry } from './telemetry/index.mjs';

const marker = '/* nectar-lifecycle:v1 */';
const owned = handler => typeof handler?.command === 'string' && handler.command.startsWith(`node -e "${marker}`);
const events = ['SessionStart', 'SubagentStart', 'PostToolUse', 'Stop', 'SubagentStop', 'SessionEnd'];
const HELP = `Nectar hooks (optional; no automatic tests or review)
  status [--host claude|codex] [--json]
  enable | disable
  install --host claude|codex [--runtime PATH] [--timeout 1-10]
  uninstall --host claude|codex
All commands accept --state-dir PATH. Install persists that selected store in its commands.
Enable/disable controls context only; telemetry enable/disable controls collection separately.
Install uses the managed Nectar runtime unless --runtime selects a durable checkout.
Native-plugin hooks and globally installed hooks are alternative installation routes.
Codex still requires reviewing and trusting new definitions in /hooks.
Native Claude strip visibility: nectar telemetry configure --band true|false.`;

function normalPath(file, { missing = false } = {}) {
  const absolute = path.resolve(file);
  let cursor = path.parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Refusing symlink: ${cursor}`);
    } catch (error) {
      if (missing && error.code === 'ENOENT') return absolute;
      throw error;
    }
  }
  return absolute;
}

export function hookConfigPath(host, env = process.env, home = os.homedir()) {
  if (host === 'claude') return path.join(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'settings.json');
  if (host === 'codex') return path.join(env.CODEX_HOME || path.join(home, '.codex'), 'hooks.json');
  throw new Error('Select --host claude or --host codex');
}

export function lifecycleConfig(host, runtime, timeout = 3, stateDir) {
  if (!['claude', 'codex'].includes(host)) throw new Error('Unsupported host');
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 10) throw new Error('Timeout must be 1-10 seconds');
  const target = pathToFileURL(path.resolve(runtime, 'hooks/lifecycle.mjs')).href;
  const encoded = Buffer.from(target).toString('base64');
  const args = Buffer.from(JSON.stringify(['--host', host, ...(stateDir ? ['--state-dir', path.resolve(stateDir)] : [])])).toString('base64');
  const command = `node -e "${marker}import(Buffer.from('${encoded}','base64').toString()).then(m=>m.main(JSON.parse(Buffer.from('${args}','base64').toString())))"`;
  return Object.fromEntries([...events, ...(host === 'claude' ? ['PostToolUseFailure', 'UserPromptExpansion', 'PreToolUse'] : ['UserPromptSubmit', 'PreModelRequest'])].map(event => [event, [{ ...(event === 'PreToolUse' ? { matcher: 'Skill' } : {}), hooks: [{ type: 'command', command,
    timeout: event === 'SessionEnd' ? Math.min(timeout, 3) : timeout }] }]]));
}

export function manageHooks({ action, host, runtime, timeout = 3, stateDir, env = process.env, home = os.homedir() }) {
  const file = normalPath(hookConfigPath(host, env, home), { missing: true });
  let previous = null;
  try {
    if (!fs.lstatSync(file).isFile()) throw new Error('Hook config must be a regular file');
    previous = fs.readFileSync(file, 'utf8');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let config;
  try { config = previous === null ? {} : JSON.parse(previous); }
  catch { throw new Error('Invalid hook settings JSON; inspect the selected host settings locally'); }
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || (config.hooks !== undefined && (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks)))) {
    throw new Error('Invalid hook configuration');
  }
  const originalHooks = config.hooks || {};
  const count = Object.values(originalHooks).flatMap(groups => Array.isArray(groups) ? groups : [])
    .flatMap(group => Array.isArray(group.hooks) ? group.hooks : []).filter(owned).length;
  if (action === 'status') return { host, file, installed: count > 0, handlers: count };
  if (!['install', 'uninstall'].includes(action)) throw new Error('Unknown hooks operation');
  if (action === 'uninstall' && count === 0) return { host, file, changed: false };
  let additions = {};
  if (action === 'install') {
    const base = path.resolve(env.BEECODED_HOME || path.join(home, '.beecoded'));
    runtime ||= path.join(base, 'marketplaces', 'nectar', host, 'plugins', 'nectar');
    normalPath(path.join(runtime, 'hooks/lifecycle.mjs'));
    if (!fs.statSync(path.join(runtime, 'hooks/lifecycle.mjs')).isFile()) throw new Error('Missing Nectar hook runtime');
    additions = lifecycleConfig(host, runtime, timeout, stateDir);
  }
  const hooks = {};
  for (const [event, groups] of Object.entries(originalHooks)) {
    if (!Array.isArray(groups)) throw new Error(`Invalid hook groups: ${event}`);
    hooks[event] = groups.flatMap(group => {
      if (!group || !Array.isArray(group.hooks)) throw new Error(`Invalid hook handlers: ${event}`);
      const remaining = group.hooks.filter(handler => !owned(handler));
      return remaining.length ? [{ ...group, hooks: remaining }] : [];
    });
    if (!hooks[event].length) delete hooks[event];
  }
  for (const [event, groups] of Object.entries(additions)) hooks[event] = [...(hooks[event] || []), ...groups];
  const result = { ...config, hooks };
  const next = `${JSON.stringify(result, null, 2)}\n`;
  if (previous === next) return { host, file, changed: false };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  normalPath(path.dirname(file));
  const temporary = `${file}.nectar-${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, next, { flag: 'wx', mode: 0o600 });
    normalPath(file, { missing: true });
    let current = null;
    try { current = fs.readFileSync(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current !== previous) throw new Error('Hook configuration changed concurrently; retry after reviewing it');
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  return { host, file, changed: true, note: host === 'codex' && action === 'install'
    ? 'Review and trust these definitions in /hooks; installing does not bypass trust.' : undefined };
}

export function runHooks(args, { env = process.env, home = os.homedir() } = {}) {
  const [action = 'status', ...rest] = args;
  if (['help', '--help', '-h'].includes(action)) return HELP;
  const options = { action, env, home };
  let stateDir;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--json') continue;
    if (!['--host', '--runtime', '--timeout', '--state-dir'].includes(rest[i]) || !rest[i + 1]) throw new Error('Invalid hooks arguments');
    const flag = rest[i++];
    if (flag === '--state-dir') { stateDir = rest[i]; options.stateDir = stateDir; }
    else options[flag.slice(2)] = flag === '--timeout' ? Number(rest[i]) : rest[i];
  }
  if (action === 'enable' || action === 'disable') {
    configureTelemetry({ contextEnabled: action === 'enable' }, { stateDir });
    return { contextEnabled: action === 'enable', telemetryUnchanged: true };
  }
  if (action === 'status') return { ...readTelemetry({ stateDir }).settings,
    hosts: (options.host ? [options.host] : ['claude', 'codex']).map(host => manageHooks({ ...options, host })) };
  return manageHooks(options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = runHooks(process.argv.slice(2)); console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
