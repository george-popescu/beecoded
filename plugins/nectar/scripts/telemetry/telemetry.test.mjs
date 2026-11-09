import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { readTelemetry, readTelemetrySettings, recordNativeSnapshot, configureTelemetry, recordSession, recordObservation, importTelemetry, parseTranscript,
  exportTelemetry, pruneTelemetry, sendTelemetry, telemetryDefaults } from './index.mjs';
import { parseTelemetryArguments, runTelemetry } from '../run-telemetry.mjs';

function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-telemetry-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const projectRoot = path.join(dir, 'project'); fs.mkdirSync(projectRoot);
  return { dir, projectRoot, stateDir: path.join(dir, 'state') };
}
function session(projectRoot, extra = {}) {
  return { host: 'codex', sessionId: 'full-session-id-1', projectRoot, startedAt: '2026-11-06T10:00:00Z', updatedAt: '2026-11-06T10:02:00Z',
    model: 'example-model', models: ['example-model'], turns: 1, usage: { input: 100, output: 20, cacheRead: 30, cacheWrite: null, total: 150 },
    cost: { usd: null, kind: 'unavailable', source: 'unavailable' }, activeMs: null, wallMs: 120000, parentSessionId: null,
    topic: null, source: 'live', evidence: [], ...extra };
}
function transcript(dir, rows, name = 'selected.jsonl') {
  const file = path.join(dir, name); fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n'); return file;
}
function codexRows(projectRoot) {
  return [
    { timestamp: '2026-11-06T10:00:00Z', type: 'session_meta', payload: { id: 'full-session-id-1', cwd: projectRoot } },
    { timestamp: '2026-11-06T10:00:01Z', type: 'turn_context', payload: { turn_id: 'turn1', model: 'example-model' } },
    { timestamp: '2026-11-06T10:00:01Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn1' } },
    { timestamp: '2026-11-06T10:00:02Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 30, output_tokens: 20, total_tokens: 120 } } } },
    { timestamp: '2026-11-06T10:00:03Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 140, cached_input_tokens: 40, output_tokens: 30, total_tokens: 170 } } } },
    { timestamp: '2026-11-06T10:00:04Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn1' } },
  ];
}

test('status creates no state; collection and context are independently opt-in', t => {
  const f = fixture(t);
  assert.deepEqual(readTelemetry(f).settings, telemetryDefaults);
  assert.equal(fs.existsSync(f.stateDir), false);
  assert.deepEqual(recordSession(session(f.projectRoot), f), { recorded: false, reason: 'collection-disabled' });
  assert.equal(fs.existsSync(f.stateDir), false);
  configureTelemetry({ contextEnabled: true }, f);
  assert.equal(readTelemetry(f).settings.enabled, false);
  assert.equal(recordSession(session(f.projectRoot), f).recorded, false);
  configureTelemetry({ enabled: true }, f);
  assert.equal(recordSession(session(f.projectRoot), f).recorded, true);
  configureTelemetry({ enabled: false }, f);
  assert.equal(readTelemetry(f).sessions.length, 1);
});

test('snapshots upsert, reject stale data and distinguish same-named projects', t => {
  const f = fixture(t); configureTelemetry({ enabled: true }, f);
  recordSession(session(f.projectRoot, { title: 'secret prompt', prompt: 'password=secret', usage: { input: 1 } }), f);
  recordSession(session(f.projectRoot), f);
  const stale = recordSession(session(f.projectRoot, { updatedAt: '2026-11-06T10:01:00Z', usage: { total: 999 } }), f);
  assert.equal(stale.reason, 'older-snapshot');
  const second = path.join(f.dir, 'other', 'project'); fs.mkdirSync(second, { recursive: true });
  recordSession(session(second), f);
  const rows = readTelemetry({ stateDir: f.stateDir }).sessions;
  assert.equal(rows.length, 2); assert.notEqual(rows[0].projectId, rows[1].projectId);
  assert.equal(readTelemetry(f).sessions[0].usage.total, 150);
  assert.equal(JSON.stringify(rows).includes('secret'), false);
  assert.equal(rows[0].cost.usd, null);
  assert.throws(() => recordSession(session(f.projectRoot, { usage: { total: -1 } }), f), /Invalid/);
});

test('concurrent processes preserve independent session snapshots', async t => {
  const f = fixture(t); configureTelemetry({ enabled: true }, f);
  const moduleUrl = pathToFileURL(path.resolve(import.meta.dirname, 'index.mjs')).href;
  await Promise.all(Array.from({ length: 4 }, (_, n) => promisify(execFile)(process.execPath, ['--input-type=module', '-e',
    `import {recordSession} from ${JSON.stringify(moduleUrl)}; recordSession(${JSON.stringify(session(f.projectRoot, { sessionId: `parallel-${n}` }))},${JSON.stringify({ stateDir: f.stateDir })});`])));
  assert.equal(readTelemetry(f).sessions.length, 4);
});

test('selected Codex import is cumulative, does not double cached input or enable collection', async t => {
  const f = fixture(t); const rows = codexRows(f.projectRoot);
  rows.push({ timestamp: '2026-11-06T10:00:05Z', type: 'response_item', payload: { content: 'SECRET_PROMPT' } });
  const file = transcript(f.dir, rows);
  const imported = await importTelemetry({ ...f, file, host: 'codex' });
  assert.deepEqual(imported.session.usage, { input: 100, output: 30, cacheRead: 40, cacheWrite: null, total: 170 });
  assert.equal(imported.session.activeMs, 3000);
  await importTelemetry({ ...f, file, host: 'codex' });
  const read = readTelemetry(f); assert.equal(read.sessions.length, 1); assert.equal(read.settings.enabled, false);
  assert.equal(JSON.stringify(read).includes('SECRET_PROMPT'), false);
  assert.throws(() => recordSession(session(f.projectRoot, { source: 'import' }), f), /authorization/);
  await assert.rejects(parseTranscript({ ...f, host: 'codex', file, expectedSessionId: 'different' }), /session does not match/);
});

test('Claude duplicate message usage counts once and stale cost stays unknown', async t => {
  const f = fixture(t);
  const assistant = { type: 'assistant', sessionId: 'claude-session', cwd: f.projectRoot,
    message: { id: 'message1', model: 'claude-example', usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 50, cache_creation_input_tokens: 20 } } };
  const file = transcript(f.dir, [
    { timestamp: '2026-11-06T10:00:00Z', type: 'user', sessionId: 'claude-session', cwd: f.projectRoot, uuid: 'turn1', message: { content: 'secret-title' } },
    { timestamp: '2026-11-06T10:00:01Z', type: 'cost-state', sessionId: 'claude-session', totalCostUSD: 0.1 },
    { ...assistant, timestamp: '2026-11-06T10:00:02Z' }, { ...assistant, timestamp: '2026-11-06T10:00:03Z' },
  ]);
  const { session: row } = await parseTranscript({ ...f, host: 'claude', file });
  assert.equal(row.usage.total, 180); assert.equal(row.turns, 1); assert.equal(row.activeMs, null); assert.equal(row.cost.usd, null);
  assert.equal(row.label, 'project'); assert.equal(JSON.stringify(row).includes('secret-title'), false);
});

test('imports reject linked targets, wrong projects and oversized records before persistence', async t => {
  const f = fixture(t); const file = transcript(f.dir, codexRows(f.projectRoot));
  const link = path.join(f.dir, 'link.jsonl'); fs.symlinkSync(file, link);
  await assert.rejects(importTelemetry({ ...f, file: link, host: 'codex' }), /symlink/);
  const wrong = path.join(f.dir, 'wrong'); fs.mkdirSync(wrong);
  await assert.rejects(importTelemetry({ ...f, projectRoot: wrong, file, host: 'codex' }), /project does not match/);
  const huge = path.join(f.dir, 'huge.jsonl'); fs.writeFileSync(huge, 'x'.repeat(8 * 1024 * 1024 + 1));
  await assert.rejects(importTelemetry({ ...f, file: huge, host: 'codex' }), /record exceeds/);
  assert.equal(fs.existsSync(f.stateDir), false);
});

test('state refuses symlink ancestors and linked database files without touching their targets', t => {
  const f = fixture(t); const external = path.join(f.dir, 'external'); fs.mkdirSync(external);
  const link = path.join(f.dir, 'alias'); fs.symlinkSync(external, link);
  assert.throws(() => configureTelemetry({ enabled: true }, { stateDir: path.join(link, 'state') }), /symlink/);
  assert.deepEqual(fs.readdirSync(external), []);
  fs.mkdirSync(f.stateDir); const target = path.join(external, 'private'); fs.writeFileSync(target, 'keep');
  fs.symlinkSync(target, path.join(f.stateDir, 'telemetry.sqlite'));
  assert.throws(() => configureTelemetry({ enabled: true }, f), /linked/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'keep');
});

test('tool observations are idempotent, metadata-only and do not claim tests passed', t => {
  const f = fixture(t); configureTelemetry({ enabled: true }, f);
  const tool = { host: 'codex', sessionId: 'full-session-id-1', projectRoot: f.projectRoot, toolUseId: 'call1', toolName: 'exec_command',
    exitCode: 0, durationMs: 12, command: 'echo npm test', output: 'SECRET', recordedAt: '2026-11-06T10:01:00Z' };
  recordObservation(tool, f); recordObservation(tool, f); recordSession(session(f.projectRoot), f);
  const read = readTelemetry(f); assert.equal(read.observations.length, 1); assert.equal(read.sessions[0].observations.length, 1);
  assert.equal(read.sessions[0].evidence.length, 0); assert.equal(JSON.stringify(read).includes('SECRET'), false);
  configureTelemetry({ enabled: false }, f); assert.equal(recordObservation({ ...tool, toolUseId: 'call2' }, f).recorded, false);
});

test('exports retain unknown values and omit local paths/session names; CSV is spreadsheet-safe', t => {
  const f = fixture(t); configureTelemetry({ enabled: true }, f); recordSession(session(f.projectRoot), f);
  const json = exportTelemetry(f); assert.equal(json.includes(f.projectRoot), false); assert.equal(json.includes('full-session-id-1'), false);
  const row = JSON.parse(json).sessions[0]; assert.equal(row.cost.usd, null); assert.equal(row.usage.cacheWrite, null);
  const csv = exportTelemetry({ ...f, format: 'csv' }); assert.match(csv, /"unavailable"/); assert.equal(csv.includes('null'), false);
  assert.match(exportTelemetry({ ...f, format: 'markdown' }), /unavailable/);
  const dangerousProject = path.join(f.dir, '=SUM(A1)'); fs.mkdirSync(dangerousProject);
  recordSession(session(dangerousProject), f);
  assert.match(exportTelemetry({ stateDir: f.stateDir, format: 'csv', includeNames: true }), /"'=SUM\(A1\)"/);
});

test('explicit prune and configured retention remove only old records', t => {
  const f = fixture(t); configureTelemetry({ enabled: true }, f);
  recordSession(session(f.projectRoot), f); recordSession(session(f.projectRoot, { sessionId: 'new', startedAt: '2026-11-07T10:00:00Z', updatedAt: '2026-11-07T10:01:00Z' }), f);
  assert.equal(pruneTelemetry({ ...f, before: '2026-11-07T00:00:00Z' }).removed, 1);
  assert.equal(readTelemetry(f).sessions[0].sessionId, 'new');
  assert.throws(() => configureTelemetry({ retentionDays: 0 }, f), /retentionDays/);
  configureTelemetry({ retentionDays: 1 }, f);
  recordSession(session(f.projectRoot, { sessionId: 'ancient', startedAt: '2000-01-01T00:00:00Z', updatedAt: '2000-01-01T00:01:00Z' }), f);
  assert.equal(readTelemetry(f).sessions.some(s => s.sessionId === 'ancient'), false);
});

test('CLI validates flags, status has no side effects and send refuses unsafe endpoints before network', async t => {
  const f = fixture(t);
  assert.equal(JSON.parse(await runTelemetry(['status', '--state-dir', f.stateDir, '--json'])).settings.enabled, false);
  assert.equal(fs.existsSync(f.stateDir), false);
  assert.throws(() => parseTelemetryArguments(['enable', '--url', 'https://example.com']), /Invalid/);
  assert.throws(() => parseTelemetryArguments(['import', '--host', 'codex']), /required/);
  await assert.rejects(sendTelemetry({ ...f, url: 'http://example.com' }), /HTTPS/);
  await assert.rejects(sendTelemetry({ ...f, url: 'https://example.com?token=secret' }), /HTTPS/);
});

test('explicit webhook sends only metadata, with token in headers and redirects disabled', async t => {
  const f = fixture(t); configureTelemetry({ enabled: true }, f); recordSession(session(f.projectRoot), f);
  let sent;
  t.mock.method(globalThis, 'fetch', async (url, init) => { sent = { url, init }; return { ok: true, status: 202 }; });
  assert.deepEqual(await sendTelemetry({ ...f, url: 'https://example.com/telemetry', token: 'test-only-secret' }), { sent: true, status: 202 });
  assert.equal(sent.init.headers.authorization, 'Bearer test-only-secret'); assert.equal(sent.init.redirect, 'error');
  assert.equal(sent.init.body.includes('test-only-secret'), false); assert.equal(sent.init.body.includes(f.projectRoot), false);
  assert.equal(JSON.stringify(readTelemetry(f)).includes('test-only-secret'), false);
});

test('native metadata snapshots are scoped and incompatible transcript totals do not overwrite measured coverage', async t => {
  const f = fixture(t);
  assert.equal((await runTelemetry(['snapshot', '--host', 'claude', '--project', f.projectRoot, '--state-dir', f.stateDir], { input: 'not-json' })).includes('collection-disabled'), true);
  configureTelemetry({ enabled: true, bandEnabled: false }, { ...f, now: new Date('2026-11-06T09:00:00Z') });
  const native = session(f.projectRoot, { cost: { usd: 0.12, kind: 'reported', source: 'claude.session.usage' } });
  const recorded = recordNativeSnapshot(native, { ...f, host: 'claude' });
  assert.equal(recorded.session.metricSource, 'native'); assert.equal(recorded.session.measurementScope, 'host-current-process');
  assert.equal(recorded.session.partial, true);
  const replacement = recordSession({ ...recorded.session, metricSource: 'transcript', cost: { usd: null, kind: 'unavailable', source: 'unavailable' } }, f);
  assert.equal(replacement.recorded, true);
  assert.equal(replacement.session.cost.usd, 0.12);
  assert.ok(readTelemetry(f).segments.some(segment => segment.reasons.includes('measurement-overlap-unresolved')));
  recordSession(session(f.projectRoot, { sessionId: 'another' }), f);
  const selected = readTelemetry({ ...f, host: 'claude', sessionId: native.sessionId });
  assert.equal(selected.sessions.length, 1); assert.equal(selected.sessions[0].cost.usd, 0.12);
  assert.equal(readTelemetrySettings(f).bandEnabled, false);
  assert.equal(readTelemetrySettings(f).enabled, true);
});

test('explicit pricing estimates attributable usage without guessing unknown models or mixed-model cost', async t => {
  const f = fixture(t); const file = transcript(f.dir, codexRows(f.projectRoot));
  const pricingFile = path.join(f.dir, 'pricing.json');
  fs.writeFileSync(pricingFile, JSON.stringify({ schemaVersion: 1, currency: 'USD', rateDate: '2026-11-06',
    models: { 'example-model': { input: 2, output: 10, cacheRead: 0.5, cacheWrite: 0 } } }));
  const first = await importTelemetry({ ...f, host: 'codex', file, pricingFile });
  assert.equal(first.session.cost.kind, 'estimated'); assert.ok(Math.abs(first.session.cost.usd - 0.00052) < 1e-12);
  assert.match(first.session.cost.source, /^user-pricing.sha256:/);
  assert.equal(first.session.cost.rateDate, '2026-11-06T00:00:00.000Z');
  const rows = codexRows(f.projectRoot);
  rows.push({ timestamp: '2026-11-06T10:00:06Z', type: 'turn_context', payload: { turn_id: 'next', model: 'unknown-model' } });
  const mixed = await importTelemetry({ ...f, host: 'codex', file: transcript(f.dir, rows, 'mixed.jsonl'), pricingFile });
  assert.ok(Math.abs(mixed.session.cost.usd - 0.00052) < 1e-12);
  assert.equal(mixed.session.partial, true);
  assert.ok(mixed.session.diagnosticCodes.includes('pricing-insufficient-attribution'));
});

test('no-cwd transcripts cannot silently attach to the selected project; resumed process cost is not session cost', async t => {
  const f = fixture(t);
  const rows = codexRows(f.projectRoot); delete rows[0].payload.cwd;
  await assert.rejects(parseTranscript({ ...f, host: 'codex', file: transcript(f.dir, rows) }), /project provenance/);
  const claude = transcript(f.dir, [
    { timestamp: '2026-11-06T10:00:00Z', type: 'assistant', sessionId: 'resumed', cwd: f.projectRoot,
      message: { id: 'msg', model: 'claude-example', usage: { input_tokens: 2, output_tokens: 1 } } },
    { timestamp: '2026-11-06T10:00:05Z', type: 'cost-state', sessionId: 'resumed', totalCostUSD: 0 },
  ], 'claude.jsonl');
  assert.equal((await parseTranscript({ ...f, host: 'claude', file: claude })).session.cost.usd, null);
});

test('Claude child transcripts are parent-namespaced and validate both identities without reading siblings', async t => {
  const f = fixture(t);
  const row = { timestamp: '2026-11-06T10:00:00Z', type: 'assistant', sessionId: 'parent1', agentId: 'agent1', cwd: f.projectRoot,
    message: { id: 'msg1', model: 'claude-example', usage: { input_tokens: 2, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } };
  const options = { ...f, host: 'claude', expectedSessionId: 'agent1', parentSessionId: 'parent1' };
  const result = await parseTranscript({ ...options, file: transcript(f.dir, [row]) });
  assert.equal(result.session.sessionId, 'parent1:agent:agent1'); assert.equal(result.session.parentSessionId, 'parent1');
  assert.equal(result.session.partial, false); assert.equal(result.session.usage.total, 3);
  const missingAgent = { ...row }; delete missingAgent.agentId;
  const partial = await parseTranscript({ ...options, file: transcript(f.dir, [missingAgent], 'partial.jsonl') });
  assert.equal(partial.session.partial, true); assert.ok(partial.session.diagnosticCodes.includes('child-attributed-by-hook'));
  await assert.rejects(parseTranscript({ ...options, file: transcript(f.dir, [{ ...row, agentId: 'wrong-agent' }], 'wrong-agent.jsonl') }), /agent does not match/);
  await assert.rejects(parseTranscript({ ...options, file: transcript(f.dir, [{ ...row, sessionId: 'wrong-parent' }], 'wrong-parent.jsonl') }), /does not match/);
});

test('Codex child keeps native ID and rejects contradictory parent provenance', async t => {
  const f = fixture(t); const rows = codexRows(f.projectRoot);
  rows[0].payload.source = { subagent: { thread_spawn: { parent_thread_id: 'parent1' } } };
  const options = { ...f, host: 'codex', expectedSessionId: 'full-session-id-1', parentSessionId: 'parent1' };
  const result = await parseTranscript({ ...options, file: transcript(f.dir, rows) });
  assert.equal(result.session.sessionId, 'full-session-id-1'); assert.equal(result.session.parentSessionId, 'parent1');
  await assert.rejects(parseTranscript({ ...options, parentSessionId: 'wrong', file: transcript(f.dir, rows, 'wrong.jsonl') }), /parent does not match/);
});
