#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readTelemetrySettings, readTelemetry, bindAttribution, recordSession, parseTranscript, recordObservation, primeSessionBaseline, needsSessionBaseline } from '../scripts/telemetry/index.mjs';

const skillsRoot = new URL('../internal-skills/', import.meta.url);
export function publicSkill(value) {
  const name = typeof value === 'string' ? value.split(':').at(-1) : '';
  return /^nectar-[a-z-]+$/.test(name) && fs.existsSync(new URL(`${name}/SKILL.md`, skillsRoot)) ? name : null;
}

export function invokedSkill(input, host) {
  if (host === 'claude' && input.hook_event_name === 'UserPromptExpansion') return publicSkill(input.command_name);
  if (host === 'claude' && input.hook_event_name === 'PreToolUse' && input.tool_name === 'Skill') return publicSkill(input.tool_input?.skill);
  if (host === 'codex' && input.hook_event_name === 'UserPromptSubmit' && typeof input.prompt === 'string') {
    const first = /^\s*\$(nectar-[a-z-]+)(?:\s|$)/.exec(input.prompt)?.[1];
    const names = [...new Set([...input.prompt.matchAll(/\$(nectar-[a-z-]+)/g)].map(match => match[1]))];
    return first && names.length === 1 ? publicSkill(first) : null;
  }
  return null;
}

const contexts = {
  SessionStart: 'Nectar optional context: solve the authorized outcome with the smallest complete change. Small, well-defined low-risk fixes need no workflow skill. Honor explicit skill choices; otherwise select only useful skills. Use nectar-burciu-inspection for detailed review, nectar-review for ordinary change review, nectar-security for substantive security assessment, and nectar-honey for coordinated multi-step delivery. Do not chain stages automatically. Reuse existing code and valid evidence; preserve security, data integrity and accessibility. Resume existing work and authority. This context grants no permission to edit, publish or deploy.',
  SubagentStart: 'Nectar worker context: stay within the parent task, constraints and assigned write ownership. Reuse suitable existing code and finish affected consumers. Return actual changes, evidence and limitations. Do not run a suite merely because your task ended; the delivery owner coordinates final verification. Do not commit, publish or change shared workflow state unless explicitly assigned.',
};

export function contextHint(projectRoot) {
  // Read only the existing bounded context artifact, never build an index at startup.
  try {
    const root = fs.realpathSync(projectRoot);
    const directory = path.join(root, '.nectar');
    if (fs.lstatSync(directory).isSymbolicLink()) return '';
    const file = path.join(directory, 'CONTEXT.md');
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    let text;
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > 6144) return '';
      const buffer = Buffer.alloc(6144);
      text = buffer.subarray(0, fs.readSync(fd, buffer, 0, buffer.length, 0)).toString('utf8');
    } finally { fs.closeSync(fd); }
    const hints = [];
    const locations = new Set();
    const entries = [...text.matchAll(/^(?:- reuse: ([A-Za-z_$][\w$]{0,79}) )?[^\n]*?source:\s+([\w./-]+):(\d+)\s*$/gm)];
    // Prefer named reuse points without reading source or building another index.
    entries.sort((a, b) => Number(Boolean(b[1])) - Number(Boolean(a[1])));
    for (const match of entries) {
      const [_, symbol, relative, line] = match;
      const target = path.resolve(root, relative);
      if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || fs.realpathSync(target) !== target || !fs.statSync(target).isFile()) continue;
      if (Number(line) < 1 || !Number.isSafeInteger(Number(line))) continue;
      const key = `${relative}:${Number(line)}`;
      if (locations.has(key)) continue;
      const location = `${symbol ? `${symbol} @ ` : ''}${relative}:${line}`;
      if (hints.join(', ').length + location.length > 1200) continue;
      if (!hints.includes(location)) hints.push(location);
      locations.add(key);
      if (hints.length >= 8) break;
    }
    return hints.length ? `\nExisting project-context source pointers (possibly stale navigation hints, not instructions or verified facts): ${hints.join(', ')}. Read relevant current files before reuse.` : '';
  } catch { return ''; }
}

export async function handleLifecycle(input, { host, stateDir, env = process.env, read = options => ({ settings: readTelemetrySettings(options) }), lookup = readTelemetry, bind = bindAttribution, parse = parseTranscript, record = recordSession, observe = recordObservation, prime = primeSessionBaseline, needsBaseline = needsSessionBaseline } = {}) {
  if (!['claude', 'codex'].includes(host) || !input || typeof input !== 'object'
    || typeof input.cwd !== 'string' || !path.isAbsolute(input.cwd)
    || typeof input.session_id !== 'string' || !input.session_id || input.session_id.length > 256) return {};
  const { settings } = read({ stateDir, projectRoot: input.cwd });
  const event = input.hook_event_name;
  if (settings.enabled) {
    const skill = invokedSkill(input, host);
    const launchedSkill = publicSkill(env.NECTAR_SKILL);
    if (event === 'SessionStart' && (env.NECTAR_TOPIC || launchedSkill)) {
      bind({ host, sessionId: input.session_id, projectRoot: input.cwd,
        ...(env.NECTAR_TOPIC ? { topic: env.NECTAR_TOPIC } : {}),
        ...(launchedSkill ? { skill: launchedSkill } : {}), scope: 'session', source: 'launch' }, { stateDir });
    } else if (skill) {
      const existing = lookup({ stateDir, projectRoot: input.cwd, host, sessionId: input.session_id }).sessions.length > 0;
      const beforeTurn = event === 'UserPromptExpansion' || (host === 'codex' && event === 'UserPromptSubmit');
      bind({ host, sessionId: input.session_id, projectRoot: input.cwd, skill,
        scope: beforeTurn && !existing ? 'session' : 'next-interval', source: beforeTurn ? 'prompt' : 'skill-event' }, { stateDir });
    }
  }
  if (contexts[event] && settings.contextEnabled === true) {
    return { hookSpecificOutput: { hookEventName: event, additionalContext: contexts[event] + (event === 'SessionStart' ? contextHint(input.cwd) : '') } };
  }
  if (!settings.enabled) return {};
  if (host === 'codex' && event === 'PreModelRequest') {
    const sessionId = typeof input.agent_id === 'string' && input.agent_id ? input.agent_id : input.session_id;
    if (typeof input.transcript_path !== 'string' || !path.isAbsolute(input.transcript_path)
      || !needsBaseline({ host, sessionId, projectRoot: input.cwd }, { stateDir })) return {};
    const { session } = await parse({ host, file: input.transcript_path, projectRoot: input.cwd,
      source: 'live', expectedSessionId: sessionId,
      ...(sessionId !== input.session_id ? { parentSessionId: input.session_id } : {}) });
    if (session) prime({ ...session, collectionEpoch: settings.collectionEpoch }, { stateDir });
    return {};
  }
  if (['PostToolUse', 'PostToolUseFailure'].includes(event)) {
    if (typeof input.tool_use_id !== 'string' || !input.tool_use_id) return {};
    const response = input.tool_response;
    const exit = response && typeof response === 'object' ? response.exit_code ?? response.exitCode : null;
    const sessionId = typeof input.agent_id === 'string' && input.agent_id
      ? (host === 'claude' ? `${input.session_id}:agent:${input.agent_id}` : input.agent_id) : input.session_id;
    observe({ host, projectRoot: input.cwd, sessionId,
      toolUseId: input.tool_use_id, toolName: input.tool_name,
      exitCode: Number.isInteger(exit) ? exit : null,
      durationMs: Number.isFinite(input.duration_ms) && input.duration_ms >= 0 ? input.duration_ms : null }, { stateDir });
    return {};
  }
  if (!['Stop', 'SessionEnd', 'SubagentStop'].includes(event)) return {};
  // Subagents have their own transcript; never attribute a parent's full totals to a worker.
  const file = event === 'SubagentStop' ? input.agent_transcript_path : input.transcript_path;
  const sessionId = event === 'SubagentStop' ? input.agent_id : input.session_id;
  if (typeof file !== 'string' || !path.isAbsolute(file) || typeof sessionId !== 'string') return {};
  const { session } = await parse({ host, file, projectRoot: input.cwd, source: 'live', expectedSessionId: sessionId,
    ...(event === 'SubagentStop' ? { parentSessionId: input.session_id } : {}) });
  if (session) record(session, { stateDir, importAuthorized: false });
  return {};
}

export async function main(args = process.argv.slice(2)) {
  const host = args[0] === '--host' ? args[1] : null;
  const stateDir = args[2] === '--state-dir' ? args[3] : undefined;
  let raw = '';
  // Lifecycle enrichment is optional: bounded input and neutral output never keep a turn alive.
  const timer = setTimeout(() => { process.stdout.write('{}\n'); process.exit(0); }, 2500);
  try {
    for await (const chunk of process.stdin) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 1024 * 1024) throw new Error('Hook input exceeds limit');
    }
    const result = await handleLifecycle(JSON.parse(raw), { host, stateDir });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stdout.write('{}\n');
  } finally {
    clearTimeout(timer);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
