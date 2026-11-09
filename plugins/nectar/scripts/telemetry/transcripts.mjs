import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { createHash } from 'node:crypto';
import { normalizeSession, projectIdentity, recordSession } from './index.mjs';

const MAX_BYTES = 128 * 1024 * 1024;
const MAX_LINE = 8 * 1024 * 1024;
const value = n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null;
const date = text => typeof text === 'string' && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : null;
const emptyUsage = () => ({ input: null, output: null, cacheRead: null, cacheWrite: null, total: null });

// Never discover histories or follow linked transcript files on behalf of an import/hook.
function openSelectedFile(file) {
  if (typeof file !== 'string' || !file) throw new Error('An explicit transcript file is required');
  const selected = path.resolve(file);
  if (fs.realpathSync(selected) !== selected) throw new Error('Transcript path must not contain symlinks');
  const fd = fs.openSync(selected, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1) throw new Error('Transcript must be a regular, unlinked file');
    if (st.size > MAX_BYTES) throw new Error('Selected transcript exceeds the 128 MiB import limit');
    return fd;
  } catch (error) { fs.closeSync(fd); throw error; }
}

function* records(fd) {
  const buffer = Buffer.alloc(64 * 1024);
  const decoder = new StringDecoder('utf8');
  let tail = '', total = 0;
  for (let bytes; (bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0;) {
    total += bytes;
    if (total > MAX_BYTES) throw new Error('Transcript grew beyond the import limit');
    tail += decoder.write(buffer.subarray(0, bytes));
    let end;
    while ((end = tail.indexOf('\n')) >= 0) {
      const line = tail.slice(0, end); tail = tail.slice(end + 1);
      if (line.length > MAX_LINE) throw new Error('Transcript record exceeds 8 MiB');
      if (line.trim()) yield line;
    }
    if (tail.length > MAX_LINE) throw new Error('Transcript record exceeds 8 MiB');
  }
  tail += decoder.end();
  if (tail.trim()) yield tail;
}

export async function parseTranscript({ host, file, projectRoot, source = 'import', expectedSessionId, parentSessionId: hookParentSessionId } = {}) {
  if (!['codex', 'claude'].includes(host)) throw new Error('Transcript host must be codex or claude');
  if (hookParentSessionId && !expectedSessionId) throw new Error('A child transcript requires its explicit agent identity');
  const identity = projectIdentity(projectRoot);
  const fd = openSelectedFile(file);
  const diagnostics = [];
  let sessionId = null, startedAt = null, updatedAt = null, usage = emptyUsage(), model = null;
  let parentSessionId = hookParentSessionId ?? null, turns = null, activeMs = null, latestUsageAt = null;
  let cost = { usd: null, kind: 'unavailable', source: 'unavailable' }, costAt = null;
  const models = new Set(), claudeMessages = new Map(), turnIds = new Set(), turnStarts = new Map(), completedTurns = new Set();
  let sawTurnEvent = false, sawProject = false, malformed = 0, skippedUsage = 0, count = 0;
  let sawAgentIdentity = false, sawParentIdentity = false;
  const assignSession = id => {
    if (!id) return;
    if (host === 'claude' && hookParentSessionId) {
      if (id !== hookParentSessionId && id !== expectedSessionId) throw new Error('Child transcript session does not match the parent or agent');
      if (id === hookParentSessionId) sawParentIdentity = true;
      sessionId = `${hookParentSessionId}:agent:${expectedSessionId}`;
      return;
    }
    if (sessionId && id !== sessionId) throw new Error('Selected transcript contains multiple sessions');
    if (expectedSessionId && expectedSessionId !== id) throw new Error('Transcript session does not match the hook session');
    sessionId = id;
  };
  const checkProject = cwd => {
    if (typeof cwd === 'string') {
      if (projectIdentity(cwd).projectRoot !== identity.projectRoot) throw new Error('Transcript project does not match the selected project');
      sawProject = true;
    }
  };
  try {
    for (const line of records(fd)) {
      if (++count > 200000) throw new Error('Transcript exceeds the 200,000-record import limit');
      let r;
      try { r = JSON.parse(line); } catch { malformed++; continue; }
      if (!r || typeof r !== 'object') continue;
      const at = date(r.timestamp);
      if (at) { startedAt = startedAt === null || at < startedAt ? at : startedAt; updatedAt = updatedAt === null || at > updatedAt ? at : updatedAt; }
      if (host === 'codex') {
        const p = r.payload ?? {};
        if (r.type === 'session_meta') {
          assignSession(p.id); checkProject(p.cwd);
          const linkedParent = p.source?.subagent?.thread_spawn?.parent_thread_id;
          if (hookParentSessionId && linkedParent && linkedParent !== hookParentSessionId) throw new Error('Child transcript parent does not match the hook parent');
          if (linkedParent) { parentSessionId = linkedParent; sawParentIdentity = true; }
          if (hookParentSessionId && p.id === expectedSessionId) sawAgentIdentity = true;
        }
        if (r.type === 'turn_context') {
          if (typeof p.model === 'string') { model = p.model; models.add(model); }
          if (typeof p.turn_id === 'string') turnIds.add(p.turn_id);
        }
        if (r.type !== 'event_msg') continue;
        if (['task_started', 'turn_started'].includes(p.type)) {
          sawTurnEvent = true;
          if (typeof p.turn_id === 'string') { turnIds.add(p.turn_id); if (at && !turnStarts.has(p.turn_id)) turnStarts.set(p.turn_id, at); }
        }
        if (['task_complete', 'turn_complete'].includes(p.type) && typeof p.turn_id === 'string' && !completedTurns.has(p.turn_id)) {
          const start = turnStarts.get(p.turn_id);
          if (start && at && at >= start) { activeMs = (activeMs ?? 0) + Date.parse(at) - Date.parse(start); completedTurns.add(p.turn_id); }
        }
        if (p.type === 'token_count' && p.info?.total_token_usage) {
          // This is a cumulative snapshot. cached_input_tokens is part of input_tokens.
          const u = p.info.total_token_usage;
          const rawInput = value(u.input_tokens), cacheRead = value(u.cached_input_tokens), output = value(u.output_tokens);
          usage = { input: rawInput !== null && cacheRead !== null && cacheRead <= rawInput ? rawInput - cacheRead : null,
            cacheRead, output, cacheWrite: value(u.cache_write_input_tokens ?? u.cache_creation_input_tokens),
            total: value(u.total_tokens) ?? (rawInput !== null && output !== null ? rawInput + output : null) };
          latestUsageAt = at;
        }
      } else {
        assignSession(r.sessionId ?? r.session_id); checkProject(r.cwd);
        if (hookParentSessionId) {
          const agentId = r.agentId ?? r.agent_id;
          const parent = r.parentSessionId ?? r.parent_session_id;
          if (agentId !== undefined) {
            if (agentId !== expectedSessionId) throw new Error('Child transcript agent does not match the hook agent');
            sawAgentIdentity = true;
          }
          if (parent !== undefined) {
            if (parent !== hookParentSessionId) throw new Error('Child transcript parent does not match the hook parent');
            sawParentIdentity = true;
          }
        }
        if (r.type === 'assistant' && r.message?.usage && r.message.model !== '<synthetic>') {
          const m = r.message;
          if (typeof m.model === 'string' && m.model !== '<synthetic>') { model = m.model; models.add(model); }
          if (typeof m.id !== 'string') { skippedUsage++; continue; }
          // Streaming records can repeat a message. Keep its final cumulative usage, not each copy.
          claudeMessages.set(m.id, { input: value(m.usage.input_tokens), output: value(m.usage.output_tokens),
            cacheRead: value(m.usage.cache_read_input_tokens), cacheWrite: value(m.usage.cache_creation_input_tokens) });
          latestUsageAt = at;
        }
        if (r.type === 'user' && !r.isMeta && r.toolResult === undefined
          && !(Array.isArray(r.message?.content) && r.message.content.some(block => block?.type === 'tool_result'))
          && typeof r.uuid === 'string') turnIds.add(r.uuid);
        // Claude cost-state may reset when a process resumes an older transcript; it is not a historical session total.
        const dollars = r.type === 'result' ? r.total_cost_usd : null;
        if (typeof dollars === 'number' && Number.isFinite(dollars) && dollars >= 0) {
          cost = { usd: dollars, kind: 'reported', source: 'claude.result.api-equivalent' };
          costAt = at;
        }
      }
    }
  } finally { fs.closeSync(fd); }
  if (!sessionId || !startedAt || !updatedAt) throw new Error('Transcript lacks a supported session identity or timestamps');
  if (!sawProject) throw new Error('Transcript lacks project provenance; it cannot be attributed to the selected project');
  if (host === 'claude' && claudeMessages.size) {
    const all = [...claudeMessages.values()];
    usage = Object.fromEntries(['input', 'output', 'cacheRead', 'cacheWrite'].map(key =>
      [key, all.some(u => u[key] === null) ? null : all.reduce((sum, u) => sum + u[key], 0)]));
    usage.total = Object.values(usage).some(n => n === null) ? null : Object.values(usage).reduce((sum, n) => sum + n, 0);
  }
  if (cost.usd !== null && (!costAt || (latestUsageAt && costAt < latestUsageAt))) {
    cost = { usd: null, kind: 'unavailable', source: 'stale-host-cost' };
    diagnostics.push('A cost total predating the latest usage was not used.');
  }
  if (turnIds.size) turns = turnIds.size;
  if (host === 'codex' && sawTurnEvent && completedTurns.size < turnIds.size) {
    activeMs = null;
    diagnostics.push('Active duration is unavailable because a turn has no matching completion.');
  }
  if (host === 'codex' && activeMs !== null) diagnostics.push('Active duration is observed turn elapsed time, including waits, not CPU time.');
  if (malformed) diagnostics.push(`${malformed} malformed JSON records were ignored; metrics may be partial.`);
  if (skippedUsage) diagnostics.push(`${skippedUsage} usage records without message identity were ignored.`);
  if (usage.total === null) diagnostics.push('Total tokens are unavailable; no zero was substituted.');
  if (cost.usd === null) diagnostics.push('Cost is unavailable; no model prices were guessed.');
  diagnostics.push('Only the selected file was read; child sessions were not imported or added to parent totals.');
  const diagnosticCodes = ['selected-file-only', 'usage-scope-unknown'];
  const childAttributedByHook = !!hookParentSessionId && (!sawAgentIdentity || !sawParentIdentity);
  if (childAttributedByHook) {
    diagnosticCodes.push('child-attributed-by-hook');
    diagnostics.push('Child identity or parent linkage comes from the explicit host hook, not complete transcript metadata.');
  }
  if (malformed) diagnosticCodes.push('malformed-records-skipped');
  if (skippedUsage) diagnosticCodes.push('usage-without-identity-skipped');
  if (cost.usd === null) diagnosticCodes.push('cost-unavailable');
  if (usage.total === null) diagnosticCodes.push('total-tokens-unavailable');
  if (activeMs === null) diagnosticCodes.push('active-time-unavailable');
  const session = normalizeSession({ ...identity, host, sessionId, startedAt, updatedAt, model, models: [...models], turns, usage, cost,
    activeMs, wallMs: Date.parse(updatedAt) - Date.parse(startedAt), parentSessionId, topic: null, source, evidence: [],
    usageScope: 'unknown', durationKind: activeMs === null ? 'unavailable' : 'turn-elapsed', partial: malformed > 0 || skippedUsage > 0 || childAttributedByHook,
    diagnosticCodes, metricSource: 'transcript', measurementScope: 'selected-file' });
  return { session, diagnostics };
}

export async function importTelemetry(options) {
  let { session, diagnostics } = await parseTranscript({ ...options, source: 'import' });
  if (options.pricingFile) session = priceSession(session, readPricing(options.pricingFile));
  return { ...recordSession(session, { stateDir: options.stateDir, importAuthorized: true }), diagnostics };
}

export function readPricing(file) {
  const fd = openSelectedFile(file);
  let text;
  try {
    if (fs.fstatSync(fd).size > 64 * 1024) throw new Error('Pricing file exceeds 64 KiB');
    text = fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
  let pricing;
  try { pricing = JSON.parse(text); } catch { throw new Error('Pricing file must contain valid JSON'); }
  if (pricing?.schemaVersion !== 1 || pricing.currency !== 'USD' || !/^\d{4}-\d{2}-\d{2}$/.test(pricing.rateDate)
    || !date(pricing.rateDate) || !pricing.models || typeof pricing.models !== 'object' || Array.isArray(pricing.models)) throw new Error('Pricing requires schemaVersion 1, currency USD, rateDate YYYY-MM-DD and models');
  for (const rates of Object.values(pricing.models)) {
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) {
      if (typeof rates?.[key] !== 'number' || !Number.isFinite(rates[key]) || rates[key] < 0) throw new Error(`Pricing ${key} must be a nonnegative USD-per-million number`);
    }
  }
  return { ...pricing, hash: createHash('sha256').update(text).digest('hex') };
}

export function priceSession(session, pricing) {
  if (session.cost.usd !== null) return session;
  const model = session.models.length === 1 ? session.models[0] : null;
  const rates = model && Object.hasOwn(pricing.models, model) ? pricing.models[model] : null;
  if (!rates || !Object.entries(session.usage).some(([key, value]) => key !== 'total' && typeof value === 'number')) {
    return { ...session, diagnosticCodes: [...new Set([...session.diagnosticCodes, 'pricing-insufficient-attribution'])] };
  }
  const partial = session.partial || Object.keys(session.usage).filter(key => key !== 'total')
    .some(key => rates[key] !== 0 && session.usage[key] === null);
  const usd = ['input', 'output', 'cacheRead', 'cacheWrite'].reduce((sum, key) => sum + (session.usage[key] ?? 0) * rates[key] / 1e6, 0);
  return normalizeSession({ ...session, partial, cost: { usd, kind: 'estimated', source: `user-pricing.sha256:${pricing.hash}`, rateDate: pricing.rateDate, partial },
    diagnosticCodes: [...session.diagnosticCodes.filter(code => code !== 'cost-unavailable'),
      partial ? 'priced-known-usage-subtotal' : 'user-rate-estimate-excludes-unreported-charges'] });
}
