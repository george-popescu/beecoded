import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fingerprint, validateAssignment, canonicalProjectRoot, gitMetadata, snapshotIdentity, usageSegment, summarizeAttribution } from './attribution.mjs';
import { readPricing, priceSession } from './transcripts.mjs';

export const telemetryDefaults = Object.freeze({ enabled: false, contextEnabled: false, bandEnabled: true, retentionDays: null, pricing: null, collectionEpoch: 0, collectionStartedAt: null });
const hash = value => createHash('sha256').update(value).digest('hex');
const NUMBER_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite', 'total'];
const HOSTS = new Set(['codex', 'claude']);

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function telemetryStateDir(stateDir) {
  return path.resolve(stateDir ?? process.env.NECTAR_STATE_DIR ?? path.join(os.homedir(), '.nectar'));
}

function plainFile(file) {
  try {
    const st = fs.lstatSync(file);
    requireValue(st.isFile() && !st.isSymbolicLink() && st.nlink === 1, 'Telemetry refuses linked or non-regular files');
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function openStore(stateDir, write = false) {
  const dir = telemetryStateDir(stateDir);
  let ancestor = path.parse(dir).root;
  for (const part of dir.slice(ancestor.length).split(path.sep).filter(Boolean)) {
    ancestor = path.join(ancestor, part);
    let st;
    try { st = fs.lstatSync(ancestor); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!write) return null;
      try { fs.mkdirSync(ancestor, { mode: 0o700 }); } catch (createError) { if (createError.code !== 'EEXIST') throw createError; }
      st = fs.lstatSync(ancestor);
    }
    requireValue(st.isDirectory() && !st.isSymbolicLink(), 'Telemetry state path must contain real directories, not symlinks');
  }
  const file = path.join(dir, 'telemetry.sqlite');
  const exists = plainFile(file);
  for (const suffix of ['-wal', '-shm', '-journal']) plainFile(`${file}${suffix}`);
  if (!exists && !write) return null;
  if (!exists) fs.closeSync(fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600));
  const db = new DatabaseSync(file, { readOnly: !write });
  try {
    db.exec('PRAGMA busy_timeout=5000');
    if (write) {
      db.exec(`PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (key TEXT PRIMARY KEY, project_id TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS sessions_project ON sessions(project_id);
        CREATE INDEX IF NOT EXISTS sessions_host_id ON sessions(json_extract(data,'$.host'),json_extract(data,'$.sessionId'));
        CREATE TABLE IF NOT EXISTS observations (key TEXT PRIMARY KEY, session_key TEXT NOT NULL, project_id TEXT NOT NULL, recorded_at TEXT NOT NULL, data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS observations_session ON observations(session_key);
        CREATE TABLE IF NOT EXISTS bindings (session_key TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS usage_segments (key TEXT PRIMARY KEY, session_key TEXT NOT NULL, project_id TEXT NOT NULL, ended_at TEXT NOT NULL, data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS usage_segments_session ON usage_segments(session_key);
        CREATE TABLE IF NOT EXISTS measurement_windows (key TEXT PRIMARY KEY, session_key TEXT NOT NULL, data TEXT NOT NULL);`);
      fs.chmodSync(file, 0o600);
    }
    return db;
  } catch (error) { db.close(); throw error; }
}

function settingsOf(db) {
  return { ...telemetryDefaults, ...JSON.parse(db?.prepare('SELECT data FROM settings WHERE id=1').get()?.data ?? '{}') };
}

const hasTable = (db, name) => !!db?.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const snapshotTotals = s => s && ({ ...s, git: null, observations: undefined, attribution: undefined, segments: undefined });

export function bindAttribution(input, { stateDir } = {}) {
  requireValue(HOSTS.has(input.host), 'Attribution host must be codex or claude');
  const identity = projectIdentity(input.projectRoot);
  const sessionId = identifier(input.sessionId, 'sessionId');
  const sessionKey = hash(`${input.host}\0${sessionId}\0${identity.projectId}`);
  const scope = input.scope ?? 'next-interval', source = input.source ?? 'operator';
  requireValue(['session', 'next-interval'].includes(scope), 'Attribution scope must be session or next-interval');
  requireValue(['launch', 'prompt', 'skill-event', 'operator'].includes(source), 'Invalid attribution source');
  const db = openStore(stateDir, true);
  try {
    db.exec('BEGIN IMMEDIATE');
    const old = JSON.parse(db.prepare('SELECT data FROM bindings WHERE session_key=?').get(sessionKey)?.data ?? 'null');
    const assignment = validateAssignment({ topic: input.topic === undefined ? old?.topic ?? null : input.topic,
      skill: input.skill === undefined ? old?.skill ?? null : input.skill }, identity.projectRoot);
    const session = db.prepare('SELECT data FROM sessions WHERE key=?').get(sessionKey);
    const initialPrompt = scope === 'session' && ['prompt', 'launch'].includes(source) && !session;
    if (old && old.topic === assignment.topic && old.skill === assignment.skill && !(old.pending && initialPrompt)) { db.exec('ROLLBACK'); return old; }
    if (scope === 'session' && session) throw new Error('Whole-session attribution must be set before the first snapshot; use next-interval');
    const pendingFields = [...new Set([...(old?.pendingFields ?? (old?.pending ? ['topic', 'skill'] : [])),
      ...((scope !== 'session' || source === 'skill-event') ? ['topic', 'skill'].filter(field => assignment[field] !== (old?.[field] ?? null)) : [])])]
      .filter(field => !(initialPrompt && Object.hasOwn(input, field) && input[field] !== undefined));
    const binding = { sessionKey, projectId: identity.projectId, host: input.host, sessionId, ...assignment,
      scope, source, changedAt: new Date().toISOString(), pending: pendingFields.length > 0, pendingFields,
      topicSource: assignment.topic === old?.topic && !(initialPrompt && input.topic !== undefined) ? old.topicSource ?? old.source : source,
      skillSource: assignment.skill === old?.skill && !(initialPrompt && input.skill !== undefined) ? old.skillSource ?? old.source : source };
    db.prepare('INSERT INTO bindings(session_key,project_id,data) VALUES(?,?,?) ON CONFLICT(session_key) DO UPDATE SET data=excluded.data')
      .run(sessionKey, identity.projectId, JSON.stringify(binding));
    db.exec('COMMIT'); return binding;
  } finally { db.close(); }
}

export function readTelemetrySettings({ stateDir } = {}) {
  const db = openStore(stateDir);
  try { return settingsOf(db); } finally { db?.close(); }
}

export function projectIdentity(projectRoot) {
  requireValue(typeof projectRoot === 'string' && projectRoot.length > 0, 'An explicit project directory is required');
  const root = canonicalProjectRoot(fs.realpathSync(projectRoot));
  requireValue(fs.statSync(root).isDirectory(), 'Project must be a directory');
  return { projectRoot: root, projectId: hash(root), label: path.basename(root) };
}

const nonnegative = (value, field) => {
  if (value === undefined || value === null) return null;
  requireValue(typeof value === 'number' && Number.isFinite(value) && value >= 0, `Invalid ${field}`);
  return value;
};
const count = (value, field) => {
  const n = nonnegative(value, field);
  requireValue(n === null || Number.isSafeInteger(n), `Invalid ${field}`);
  return n;
};
const identifier = (value, field, optional = false) => {
  if (optional && (value === null || value === undefined)) return null;
  requireValue(typeof value === 'string' && /^[\w.:/@+-]{1,200}$/.test(value), `Invalid ${field}`);
  return value;
};
const timestamp = (value, field) => {
  requireValue(typeof value === 'string' && Number.isFinite(Date.parse(value)), `Invalid ${field}`);
  return new Date(value).toISOString();
};

export function normalizeSession(input) {
  requireValue(input && typeof input === 'object' && HOSTS.has(input.host), 'Telemetry host must be codex or claude');
  const identity = projectIdentity(input.projectRoot);
  const sessionId = identifier(input.sessionId, 'sessionId');
  const startedAt = timestamp(input.startedAt, 'startedAt');
  const updatedAt = timestamp(input.updatedAt, 'updatedAt');
  requireValue(updatedAt >= startedAt, 'Session update precedes its start');
  requireValue(['live', 'import'].includes(input.source), 'Session source must be live or import');
  const usage = Object.fromEntries(NUMBER_FIELDS.map(key => [key, count(input.usage?.[key], `usage.${key}`)]));
  const usd = nonnegative(input.cost?.usd, 'cost.usd');
  const kind = input.cost?.kind ?? 'unavailable';
  requireValue(['reported', 'estimated', 'unavailable'].includes(kind), 'Invalid cost kind');
  requireValue((usd === null) === (kind === 'unavailable'), 'Known costs need provenance; unavailable costs must be null');
  const models = [...new Set([...(input.models ?? []), ...(input.model ? [input.model] : [])])].map(m => identifier(m, 'model'));
  requireValue(models.length <= 100, 'Too many models');
  const evidence = (input.evidence ?? []).map(e => ({
    kind: identifier(e.kind, 'evidence.kind'), status: identifier(e.status, 'evidence.status'),
    source: identifier(e.source, 'evidence.source'), recordedAt: timestamp(e.recordedAt, 'evidence.recordedAt'),
  }));
  requireValue(evidence.length <= 100, 'Too much evidence');
  const usageScope = input.usageScope ?? 'unknown';
  requireValue(['session-only', 'includes-children', 'unknown'].includes(usageScope), 'Invalid usage scope');
  const durationKind = input.durationKind ?? (input.activeMs == null ? 'unavailable' : 'host-active');
  requireValue(['turn-elapsed', 'host-active', 'unavailable'].includes(durationKind), 'Invalid duration kind');
  const diagnosticCodes = (input.diagnosticCodes ?? []).map(code => identifier(code, 'diagnostic code'));
  requireValue(diagnosticCodes.length <= 20, 'Too many diagnostic codes');
  const metricSource = input.metricSource ?? 'provided';
  requireValue(['native', 'transcript', 'provided'].includes(metricSource), 'Invalid metric source');
  const measurementScope = input.measurementScope ?? 'unknown';
  requireValue(['host-current-process', 'selected-file', 'session', 'unknown'].includes(measurementScope), 'Invalid measurement scope');
  return {
    ...identity, key: hash(`${input.host}\0${sessionId}\0${identity.projectId}`), host: input.host, sessionId,
    startedAt, updatedAt, model: identifier(input.model, 'model', true), models,
    turns: count(input.turns, 'turns'), usage,
    cost: { usd, kind, source: identifier(input.cost?.source ?? 'unavailable', 'cost.source'),
      ...(input.cost?.partial === true ? { partial: true } : {}),
      ...(input.cost?.rateDate ? { rateDate: timestamp(input.cost.rateDate, 'cost.rateDate') } : {}) },
    activeMs: nonnegative(input.activeMs, 'activeMs'), wallMs: nonnegative(input.wallMs, 'wallMs'),
    parentSessionId: identifier(input.parentSessionId, 'parentSessionId', true),
    topic: identifier(input.topic, 'topic', true), source: input.source, evidence,
    measurementId: identifier(input.measurementId, 'measurementId', true),
    ...(input.collectionEpoch !== undefined ? { collectionEpoch: count(input.collectionEpoch, 'collectionEpoch') } : {}),
    git: input.git && typeof input.git === 'object' ? { branch: input.git.branch ?? null, head: input.git.head ?? null,
      worktree: input.git.worktree ?? null, repositoryId: input.git.repositoryId ?? null } : null,
    partial: input.partial === true || input.cost?.partial === true, usageScope, durationKind, diagnosticCodes, metricSource, measurementScope,
  };
}

function acceptedSessionTotals(session, segments) {
  const accepted = segments.filter(segment => !segment.superseded);
  if (!accepted.length) return session;
  const sumKnown = values => values.some(value => typeof value === 'number')
    ? values.reduce((sum, value) => sum + (typeof value === 'number' ? value : 0), 0) : null;
  const costs = accepted.filter(segment => typeof segment.cost.usd === 'number').map(segment => segment.cost);
  const sources = [...new Set(costs.map(cost => cost.source))];
  const rateDates = [...new Set(costs.map(cost => cost.rateDate ?? null))];
  const mixed = sources.length > 1 || rateDates.length > 1 || new Set(costs.map(cost => cost.kind)).size > 1;
  const partial = session.partial || accepted.some(segment => segment.partial);
  return { ...session,
    usage: Object.fromEntries(NUMBER_FIELDS.map(key => [key, sumKnown(accepted.map(segment => segment.usage[key]))])),
    cost: costs.length ? { usd: sumKnown(costs.map(cost => cost.usd)),
      kind: costs.some(cost => cost.kind === 'estimated') ? 'estimated' : 'reported',
      source: mixed ? 'accepted-intervals' : sources[0],
      ...(mixed ? { sources } : {}),
      ...(rateDates.length === 1 && rateDates[0] ? { rateDate: rateDates[0] } : {}),
      ...(partial || costs.some(cost => cost.partial) ? { partial: true } : {}) }
      : { usd: null, kind: 'unavailable', source: 'unavailable' },
    activeMs: sumKnown(accepted.map(segment => segment.activeMs)),
    wallMs: sumKnown(accepted.map(segment => segment.wallMs)), partial,
  };
}

export function readTelemetry({ stateDir, projectRoot, host, sessionId } = {}) {
  const projectId = projectRoot ? projectIdentity(projectRoot).projectId : null;
  if (host !== undefined) requireValue(HOSTS.has(host), 'Invalid host filter');
  if (sessionId !== undefined) identifier(sessionId, 'sessionId');
  const db = openStore(stateDir);
  if (!db) return { sessions: [], observations: [], bindings: [], segments: [], settings: { ...telemetryDefaults }, diagnostics: [] };
  try {
    const conditions = [], parameters = [];
    if (projectId) { conditions.push('project_id=?'); parameters.push(projectId); }
    if (host) { conditions.push("json_extract(data,'$.host')=?"); parameters.push(host); }
    if (sessionId) { conditions.push("json_extract(data,'$.sessionId')=?"); parameters.push(sessionId); }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT data FROM sessions${where} ORDER BY updated_at DESC`).all(...parameters);
    // A selected session does not deserialize the rest of the user's history.
    const observations = db.prepare(host || sessionId
      ? `SELECT data FROM observations WHERE session_key IN(SELECT key FROM sessions${where}) ORDER BY recorded_at DESC`
      : `SELECT data FROM observations${projectId ? ' WHERE project_id=?' : ''} ORDER BY recorded_at DESC`)
      .all(...(host || sessionId ? parameters : projectId ? [projectId] : [])).map(row => JSON.parse(row.data));
    const bySession = new Map();
    for (const observation of observations) {
      if (!bySession.has(observation.sessionKey)) bySession.set(observation.sessionKey, []);
      bySession.get(observation.sessionKey).push(observation);
    }
    const ancillary = table => !hasTable(db, table) ? [] : db.prepare(`SELECT data FROM ${table} WHERE session_key IN(SELECT key FROM sessions${where})`).all(...parameters).map(row => JSON.parse(row.data));
    const segments = ancillary('usage_segments').map(({ baseline, ...segment }) => segment);
    const bindings = ancillary('bindings');
    const current = new Map(bindings.map(b => [b.sessionKey, b]));
    return { sessions: rows.map(row => { const stored = JSON.parse(row.data);
      const session = acceptedSessionTotals(stored, segments.filter(segment => segment.sessionKey === stored.key));
      const attribution = current.get(session.key) ?? null;
      return { ...session, topic: attribution?.topic ?? null, skill: attribution?.skill ?? null, attribution,
        observations: bySession.get(session.key) ?? [], segments: segments.filter(s => s.sessionKey === session.key) }; }),
      observations, bindings, segments, settings: settingsOf(db), diagnostics: [] };
  } finally { db.close(); }
}

export function configureTelemetry(patch, { stateDir, now = new Date() } = {}) {
  requireValue(patch && typeof patch === 'object', 'Settings patch required');
  for (const [key, value] of Object.entries(patch)) {
    requireValue(Object.hasOwn(telemetryDefaults, key) && !['collectionEpoch', 'collectionStartedAt'].includes(key), `Unknown telemetry setting: ${key}`);
    if (key === 'pricing') requireValue(value === null || (value?.schemaVersion === 1 && typeof value.hash === 'string'), 'Pricing must come from a validated pricing file');
    else if (key === 'retentionDays') requireValue(value === null || (Number.isInteger(value) && value >= 1 && value <= 3650), 'retentionDays must be null or 1–3650');
    else requireValue(typeof value === 'boolean', `${key} must be boolean`);
  }
  const db = openStore(stateDir, true);
  try {
    db.exec('BEGIN IMMEDIATE');
    const prior = settingsOf(db);
    const settings = { ...prior, ...patch };
    if (settings.enabled !== prior.enabled) {
      settings.collectionEpoch = prior.collectionEpoch + 1;
      settings.collectionStartedAt = settings.enabled ? now.toISOString() : null;
    }
    db.prepare('INSERT INTO settings(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(JSON.stringify(settings));
    db.exec('COMMIT');
    return settings;
  } finally { db.close(); }
}

export function needsSessionBaseline({ host, sessionId, projectRoot }, { stateDir } = {}) {
  requireValue(HOSTS.has(host), 'Telemetry host must be codex or claude');
  identifier(sessionId, 'sessionId');
  const { projectId } = projectIdentity(projectRoot);
  const sessionKey = hash(`${host}\0${sessionId}\0${projectId}`);
  const db = openStore(stateDir);
  if (!db) return false;
  try {
    const settings = settingsOf(db);
    if (!settings.enabled) return false;
    if (!hasTable(db, 'measurement_windows')) return true;
    return !db.prepare("SELECT 1 FROM measurement_windows WHERE session_key=? AND json_extract(data,'$.metricSource')='transcript' AND json_extract(data,'$.collectionEpoch')=? LIMIT 1")
      .get(sessionKey, settings.collectionEpoch);
  } finally { db.close(); }
}

export function primeSessionBaseline(input, { stateDir, now = new Date() } = {}) {
  if (!readTelemetrySettings({ stateDir }).enabled) return { primed: false, reason: 'collection-disabled' };
  let session = normalizeSession(input);
  requireValue(session.source === 'live', 'Only live sessions can prime a collection baseline');
  const sampledAt = timestamp(now.toISOString(), 'sampledAt');
  requireValue(sampledAt >= session.updatedAt, 'Baseline sampling precedes snapshot');
  const db = openStore(stateDir, true);
  try {
    db.exec('BEGIN IMMEDIATE');
    const settings = settingsOf(db);
    const reason = !settings.enabled ? 'collection-disabled'
      : session.collectionEpoch !== undefined && session.collectionEpoch !== settings.collectionEpoch ? 'stale-collection-epoch'
      : session.usage.total === null ? 'usage-unavailable'
      : !settings.collectionStartedAt || session.startedAt >= settings.collectionStartedAt ? 'no-collection-boundary' : null;
    if (reason) { db.exec('ROLLBACK'); return { primed: false, reason }; }
    if (settings.pricing) session = priceSession(session, settings.pricing);
    session.collectionEpoch = settings.collectionEpoch;
    session.updatedAt = sampledAt;
    const result = db.prepare('INSERT INTO measurement_windows(key,session_key,data) VALUES(?,?,?) ON CONFLICT(key) DO NOTHING')
      .run(snapshotIdentity(session), session.key, JSON.stringify(snapshotTotals(session)));
    db.exec('COMMIT');
    return { primed: result.changes > 0, reason: result.changes ? 'baseline-created' : 'baseline-exists' };
  } finally { db.close(); }
}

export function recordSession(input, { stateDir, importAuthorized = false } = {}) {
  const settings = readTelemetrySettings({ stateDir });
  if (input?.source === 'import') requireValue(importAuthorized, 'Historical import requires explicit authorization');
  else if (!settings.enabled) return { recorded: false, reason: 'collection-disabled' };
  let session = normalizeSession(input);
  if (settings.pricing) session = priceSession(session, settings.pricing);
  session.git = gitMetadata(session.projectRoot);
  const db = openStore(stateDir, true);
  try {
    db.exec('BEGIN IMMEDIATE');
    // Recheck under the write lock so disabling collection races safely with hooks.
    const currentSettings = settingsOf(db);
    if (session.source === 'live' && !currentSettings.enabled) {
      db.exec('ROLLBACK'); return { recorded: false, reason: 'collection-disabled' };
    }
    if (session.source === 'live' && session.collectionEpoch !== undefined && session.collectionEpoch !== currentSettings.collectionEpoch) {
      db.exec('ROLLBACK'); return { recorded: false, reason: 'stale-collection-epoch' };
    }
    session.collectionEpoch = session.source === 'live' ? currentSettings.collectionEpoch : null;
    const stored = db.prepare('SELECT data FROM sessions WHERE key=?').get(session.key);
    const old = stored ? JSON.parse(stored.data) : null;
    if (old && old.updatedAt > session.updatedAt) {
      db.exec('ROLLBACK'); return { recorded: false, reason: 'older-snapshot', session: old };
    }
    const windowKey = snapshotIdentity(session);
    const window = JSON.parse(db.prepare('SELECT data FROM measurement_windows WHERE key=?').get(windowKey)?.data ?? 'null');
    const binding = JSON.parse(db.prepare('SELECT data FROM bindings WHERE session_key=?').get(session.key)?.data ?? 'null');
    const segmentKey = fingerprint([windowKey, session.updatedAt]);
    const existingSegment = db.prepare('SELECT data FROM usage_segments WHERE key=?').get(segmentKey);
    const priorSegment = existingSegment ? JSON.parse(existingSegment.data) : null;
    const previous = priorSegment ? priorSegment.baseline : window ?? (old && snapshotIdentity(old) === windowKey ? snapshotTotals(old) : null);
    const segment = { ...usageSegment(session, previous, binding), baseline: previous, windowKey };
    if (old && snapshotIdentity(old) !== windowKey) {
      segment.partial = true;
      segment.reasons = [...new Set([...segment.reasons, 'measurement-window-changed'])];
    }
    if (priorSegment) {
      // Re-reading the same host snapshot can improve counters, never relabel historical work.
      for (const key of ['topic', 'skill', 'attributionSource', 'topicAttributionSource', 'skillAttributionSource']) segment[key] = priorSegment[key];
    }
    const history = db.prepare('SELECT data FROM usage_segments WHERE session_key=?').all(session.key).map(row => JSON.parse(row.data));
    const beforeCollection = session.source === 'live' && !previous && currentSettings.collectionStartedAt
      && session.startedAt < currentSettings.collectionStartedAt
      && (session.metricSource !== 'provided' || currentSettings.collectionEpoch > 1);
    const overlapping = history.filter(prior => !prior.superseded && prior.key !== segment.key
      && prior.windowKey !== windowKey && prior.startedAt < segment.endedAt && prior.endedAt > segment.startedAt);
    const boundary = beforeCollection || priorSegment?.reasons?.includes('collection-boundary-unmeasured');
    const suppressed = new Set(priorSegment?.suppressedMetrics ?? []);
    const suppress = (name, value, select) => {
      if (boundary || suppressed.has(name) || overlapping.some(prior => typeof select(prior) === 'number')) {
        suppressed.add(name); return null;
      }
      return value;
    };
    segment.usage = Object.fromEntries(NUMBER_FIELDS.map(key => [key, suppress(key, segment.usage[key], prior => prior.usage[key])]));
    segment.cost.usd = suppress('cost', segment.cost.usd, prior => prior.cost.usd);
    if (segment.cost.usd === null) segment.cost.kind = 'unavailable';
    segment.activeMs = suppress('activeMs', segment.activeMs, prior => prior.activeMs);
    segment.wallMs = suppress('wallMs', segment.wallMs, prior => prior.wallMs);
    const withheld = boundary ? 'collection-boundary-unmeasured' : suppressed.size ? 'measurement-overlap-unresolved' : null;
    if (withheld) { segment.partial = true; segment.reasons = [...new Set([...segment.reasons, withheld])]; }
    segment.suppressedMetrics = [...suppressed];
    db.prepare('INSERT INTO usage_segments(key,session_key,project_id,ended_at,data) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data')
      .run(segment.key, session.key, session.projectId, session.updatedAt, JSON.stringify(segment));
    db.prepare('INSERT INTO measurement_windows(key,session_key,data) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data')
      .run(windowKey, session.key, JSON.stringify(snapshotTotals(session)));
    // Expose only accepted consumption; raw cumulative counters stay in private checkpoints.
    session = acceptedSessionTotals(session, [...history.filter(prior => prior.key !== segment.key), segment]);
    if (withheld) session.diagnosticCodes = [...new Set([...session.diagnosticCodes, withheld])];
    if (binding?.pending && !priorSegment) {
      binding.pending = false;
      binding.pendingFields = [];
      db.prepare('UPDATE bindings SET data=? WHERE session_key=?').run(JSON.stringify(binding), session.key);
    }
    db.prepare(`INSERT INTO sessions(key,project_id,updated_at,data) VALUES(?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET updated_at=excluded.updated_at,data=excluded.data`).run(session.key, session.projectId, session.updatedAt, JSON.stringify(session));
    const retentionDays = settingsOf(db).retentionDays;
    if (retentionDays !== null) {
      const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
      db.prepare('DELETE FROM sessions WHERE updated_at < ?').run(cutoff);
      db.prepare('DELETE FROM observations WHERE recorded_at < ?').run(cutoff);
      db.prepare('DELETE FROM usage_segments WHERE ended_at < ?').run(cutoff);
      db.prepare("DELETE FROM measurement_windows WHERE session_key NOT IN(SELECT key FROM sessions) AND json_extract(data,'$.updatedAt') < ?").run(cutoff);
      db.prepare("DELETE FROM bindings WHERE session_key NOT IN(SELECT key FROM sessions) AND json_extract(data,'$.changedAt') < ?").run(cutoff);
    }
    db.exec('COMMIT');
    return { recorded: true, session };
  } finally { db.close(); }
}

export function recordNativeSnapshot(input, { stateDir, host, projectRoot } = {}) {
  if (!readTelemetrySettings({ stateDir }).enabled) return { recorded: false, reason: 'collection-disabled' };
  return recordSession({ ...input, host, projectRoot, source: 'live', metricSource: 'native',
    measurementScope: 'host-current-process', partial: true,
    diagnosticCodes: [...new Set([...(input.diagnosticCodes ?? []), 'native-current-process-window'])] }, { stateDir });
}

export function recordObservation(input, { stateDir } = {}) {
  const settings = readTelemetrySettings({ stateDir });
  if (!settings.enabled) return { recorded: false, reason: 'collection-disabled' };
  requireValue(HOSTS.has(input?.host), 'Telemetry host must be codex or claude');
  const { projectId } = projectIdentity(input.projectRoot);
  const sessionId = identifier(input.sessionId, 'sessionId');
  const toolUseId = identifier(input.toolUseId, 'toolUseId');
  const sessionKey = hash(`${input.host}\0${sessionId}\0${projectId}`);
  requireValue(input.exitCode === null || input.exitCode === undefined || Number.isSafeInteger(input.exitCode), 'Invalid tool exit code');
  requireValue(input.sourceRevision === null || input.sourceRevision === undefined || /^[a-f0-9]{7,64}$/i.test(input.sourceRevision), 'Invalid source revision');
  const observation = { key: hash(`${sessionKey}\0${toolUseId}`), sessionKey, projectId,
    host: input.host, toolUseId, toolName: identifier(input.toolName, 'toolName'),
    exitCode: input.exitCode ?? null, durationMs: nonnegative(input.durationMs, 'durationMs'),
    sourceRevision: input.sourceRevision ?? null, recordedAt: timestamp(input.recordedAt ?? new Date().toISOString(), 'recordedAt') };
  const db = openStore(stateDir, true);
  try {
    db.exec('BEGIN IMMEDIATE');
    if (!settingsOf(db).enabled) { db.exec('ROLLBACK'); return { recorded: false, reason: 'collection-disabled' }; }
    db.prepare(`INSERT INTO observations(key,session_key,project_id,recorded_at,data) VALUES(?,?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET recorded_at=excluded.recorded_at,data=excluded.data WHERE excluded.recorded_at >= observations.recorded_at`)
      .run(observation.key, sessionKey, projectId, observation.recordedAt, JSON.stringify(observation));
    const retentionDays = settingsOf(db).retentionDays;
    if (retentionDays !== null) {
      const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
      db.prepare('DELETE FROM observations WHERE recorded_at < ?').run(cutoff);
      db.prepare('DELETE FROM sessions WHERE updated_at < ?').run(cutoff);
      db.prepare('DELETE FROM usage_segments WHERE ended_at < ?').run(cutoff);
      db.prepare("DELETE FROM measurement_windows WHERE session_key NOT IN(SELECT key FROM sessions) AND json_extract(data,'$.updatedAt') < ?").run(cutoff);
      db.prepare("DELETE FROM bindings WHERE session_key NOT IN(SELECT key FROM sessions) AND json_extract(data,'$.changedAt') < ?").run(cutoff);
    }
    db.exec('COMMIT'); return { recorded: true, observation };
  } finally { db.close(); }
}

export function pruneTelemetry({ stateDir, before } = {}) {
  const cutoff = timestamp(before, 'before');
  const db = openStore(stateDir);
  if (!db) return { removed: 0 };
  db.close();
  const writable = openStore(stateDir, true);
  try {
    writable.exec('BEGIN IMMEDIATE');
    const result = writable.prepare('DELETE FROM sessions WHERE updated_at < ?').run(cutoff);
    const tools = writable.prepare('DELETE FROM observations WHERE recorded_at < ?').run(cutoff);
    const segments = writable.prepare('DELETE FROM usage_segments WHERE ended_at < ?').run(cutoff);
    writable.prepare("DELETE FROM measurement_windows WHERE session_key NOT IN(SELECT key FROM sessions) AND json_extract(data,'$.updatedAt') < ?").run(cutoff);
    writable.prepare("DELETE FROM bindings WHERE session_key NOT IN(SELECT key FROM sessions) AND json_extract(data,'$.changedAt') < ?").run(cutoff);
    writable.exec('COMMIT');
    return { removed: result.changes, observationsRemoved: tools.changes, segmentsRemoved: segments.changes };
  } finally { writable.close(); }
}

export function publicSessions(sessions, includeNames = false) {
  return sessions.map(s => ({
    key: s.key, projectId: s.projectId, host: s.host, model: s.model, models: s.models,
    startedAt: s.startedAt, updatedAt: s.updatedAt, turns: s.turns, usage: s.usage, cost: s.cost,
    activeMs: s.activeMs, wallMs: s.wallMs, source: s.source, evidence: s.evidence,
    observations: s.observations, skill: s.skill, partial: s.partial, usageScope: s.usageScope,
    durationKind: s.durationKind, diagnosticCodes: s.diagnosticCodes,
    metricSource: s.metricSource, measurementScope: s.measurementScope,
    parentKey: s.parentSessionId ? hash(`${s.host}\0${s.parentSessionId}\0${s.projectId}`) : null,
    git: s.git ? { repositoryId: s.git.repositoryId, ...(includeNames ? { branch: s.git.branch, head: s.git.head } : {}) } : null,
    segments: publicSegments(s.segments ?? [], includeNames),
    ...(includeNames ? { label: s.label, topic: s.topic } : {}),
  }));
}

export function publicSegments(segments, includeNames = false) {
  return segments.map(({ baseline, sessionId, parentSessionId, git, topic, ...segment }) => ({ ...segment,
    topicKey: topic ? hash(`${segment.projectId}\0${topic}`) : null,
    parentKey: parentSessionId ? hash(`${segment.host}\0${parentSessionId}\0${segment.projectId}`) : null,
    ...(includeNames ? { topic, git: git && { branch: git.branch, head: git.head, repositoryId: git.repositoryId } } : {}),
  }));
}

export { summarizeAttribution, readPricing };

export function exportTelemetry({ stateDir, projectRoot, format = 'json', includeNames = false } = {}) {
  const { sessions } = readTelemetry({ stateDir, projectRoot });
  const rows = publicSessions(sessions, includeNames);
  if (format === 'json') return JSON.stringify({ schemaVersion: 1, sessions: rows }, null, 2);
  const headers = ['key', 'project', 'host', 'model', 'startedAt', 'updatedAt', 'costUsd', 'costKind', 'input', 'output', 'cacheRead', 'cacheWrite', 'total', 'activeMs', 'wallMs', 'turns'];
  const values = rows.map(s => [s.key, s.label ?? s.projectId, s.host, s.model, s.startedAt, s.updatedAt, s.cost.usd, s.cost.kind, ...NUMBER_FIELDS.map(k => s.usage[k]), s.activeMs, s.wallMs, s.turns]);
  if (format === 'csv') {
    const cell = value => {
      const raw = value === null ? '' : String(value);
      const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
      return `"${safe.replaceAll('"', '""')}"`;
    };
    return [headers, ...values].map(row => row.map(cell).join(',')).join('\n') + '\n';
  }
  if (format === 'markdown') {
    const cell = value => String(value ?? 'unavailable').replaceAll('|', '\\|').replace(/[\r\n]/g, ' ');
    return [headers, headers.map(() => '---'), ...values].map(row => `| ${row.map(cell).join(' | ')} |`).join('\n');
  }
  throw new Error('Export format must be json, csv or markdown');
}

export async function sendTelemetry({ stateDir, projectRoot, url, token = process.env.NECTAR_TELEMETRY_TOKEN } = {}) {
  const target = new URL(url);
  requireValue(target.protocol === 'https:' && !target.username && !target.password && !target.search && !target.hash, 'Webhook requires HTTPS without credentials, query or fragment');
  requireValue(!token || (typeof token === 'string' && !/[\r\n]/.test(token)), 'Invalid webhook token');
  const body = exportTelemetry({ stateDir, projectRoot });
  requireValue(Buffer.byteLength(body) <= 5 * 1024 * 1024, 'Webhook export exceeds 5 MiB; select one project');
  const response = await fetch(target, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body });
  requireValue(response.ok, `Webhook returned HTTP ${response.status}`);
  await response.body?.cancel();
  return { sent: true, status: response.status };
}

export { parseTranscript, importTelemetry } from './transcripts.mjs';
