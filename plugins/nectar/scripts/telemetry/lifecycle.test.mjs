import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { configureTelemetry, recordSession, readTelemetry, summarizeAttribution, readTelemetrySettings, primeSessionBaseline, needsSessionBaseline, recordObservation, pruneTelemetry } from './index.mjs';

function fixture(t) {
  const projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-windows-')));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const options = { stateDir: path.join(projectRoot, 'state') };
  configureTelemetry({ enabled: true }, { ...options, now: new Date('2026-11-06T09:00:00Z') });
  const snapshot = (source, start, end, dollars, extra = {}) => ({ host: 'claude', sessionId: 'same-session', projectRoot,
    source: 'live', metricSource: source, measurementScope: source === 'native' ? 'host-current-process' : 'selected-file',
    startedAt: `2026-11-06T${start}:00Z`, updatedAt: `2026-11-06T${end}:00Z`,
    usageScope: 'session-only', model: 'fixture', models: ['fixture'], usage: { input: dollars * 100, output: 0, cacheRead: 0, cacheWrite: 0, total: dollars * 100 },
    cost: { usd: dollars, kind: 'reported', source: 'fixture' }, activeMs: dollars * 1000, wallMs: dollars * 1000, ...extra });
  const total = () => summarizeAttribution(readTelemetry(options).segments).reduce((sum, row) => sum + (row.cost.usd ?? 0), 0);
  return { projectRoot, options, snapshot, total };
}

test('disjoint source windows preserve history in both directions', t => {
  const f = fixture(t);
  recordSession(f.snapshot('transcript', '10:00', '10:01', 10), f.options);
  recordSession(f.snapshot('native', '11:00', '11:01', 2), f.options);
  assert.equal(f.total(), 12);
  recordSession(f.snapshot('transcript', '12:00', '12:01', 3), f.options);
  assert.equal(f.total(), 15);
  assert.equal(readTelemetry(f.options).segments.some(s => s.superseded), false);
});

test('incomparable overlap is withheld but subsequent nonoverlapping deltas resume', t => {
  const f = fixture(t);
  recordSession(f.snapshot('transcript', '10:00', '10:02', 10), f.options);
  recordSession(f.snapshot('native', '10:01', '10:03', 3), f.options);
  assert.equal(f.total(), 10);
  const second = recordSession(f.snapshot('native', '10:01', '10:04', 5), f.options);
  assert.equal(f.total(), 12);
  assert.equal(second.session.cost.usd, 12);
  assert.equal(second.session.partial, true);
});

test('native known cost can enrich an overlapping transcript with unknown cost, without doubling tokens', t => {
  const f = fixture(t);
  recordSession(f.snapshot('transcript', '10:00', '10:02', 1, { cost: { usd: null, kind: 'unavailable', source: 'unknown' } }), f.options);
  recordSession(f.snapshot('native', '10:00', '10:03', 2), f.options);
  const groups = summarizeAttribution(readTelemetry(f.options).segments);
  assert.equal(f.total(), 2);
  assert.equal(groups[0].usage.total, 100);
  assert.equal(groups[0].partial, true);
  recordSession(f.snapshot('native', '10:00', '10:04', 3), f.options);
  assert.equal(f.total(), 3);
});

test('disable and reenable with no hooks during pause baseline cumulative transcripts and reject stale native snapshots', t => {
  const f = fixture(t);
  recordSession(f.snapshot('transcript', '10:00', '10:01', 1), f.options);
  const oldEpoch = readTelemetrySettings(f.options).collectionEpoch;
  configureTelemetry({ enabled: false }, f.options);
  configureTelemetry({ enabled: true }, { ...f.options, now: new Date('2026-11-06T10:03:00Z') });
  assert.equal(recordSession(f.snapshot('native', '10:00', '10:04', 7, { collectionEpoch: oldEpoch }), f.options).reason, 'stale-collection-epoch');
  const boundary = recordSession(f.snapshot('transcript', '10:00', '10:04', 7), f.options);
  assert.equal(boundary.session.cost.usd, 1);
  assert.equal(f.total(), 1);
  recordSession(f.snapshot('transcript', '10:00', '10:05', 8), f.options);
  assert.equal(f.total(), 2);
  assert.equal(readTelemetry(f.options).sessions[0].usage.total, 200);
});

test('a fresh native window after reenable counts immediately; epoch is server owned', t => {
  const f = fixture(t);
  recordSession(f.snapshot('native', '10:00', '10:01', 1), f.options);
  configureTelemetry({ enabled: false }, f.options);
  const settings = configureTelemetry({ enabled: true }, { ...f.options, now: new Date('2026-11-06T10:03:00Z') });
  recordSession(f.snapshot('native', '10:04', '10:05', 1, { collectionEpoch: settings.collectionEpoch }), f.options);
  assert.equal(f.total(), 2);
  assert.throws(() => configureTelemetry({ collectionEpoch: 0 }, f.options), /Unknown/);
  const again = configureTelemetry({ enabled: true }, f.options);
  assert.equal(again.collectionEpoch, settings.collectionEpoch);
});

test('first enable does not collect earlier live consumption; explicit historical import remains possible', t => {
  const f = fixture(t);
  recordSession(f.snapshot('transcript', '08:00', '09:01', 6), f.options);
  assert.equal(f.total(), 0);
  const imported = f.snapshot('transcript', '07:00', '07:01', 2, { sessionId: 'explicit-history', source: 'import' });
  recordSession(imported, { ...f.options, importAuthorized: true });
  assert.equal(f.total(), 2);
});

test('duplicate boundary snapshots never restore excluded paused or overlapping consumption', t => {
  const f = fixture(t);
  const prior = f.snapshot('transcript', '08:00', '09:01', 6);
  recordSession(prior, f.options); recordSession(prior, f.options);
  recordSession(f.snapshot('transcript', '08:00', '09:02', 7), f.options);
  assert.equal(f.total(), 1);
});

test('source enrichment retains known dollars while filling unknown tokens in public session and ledger', t => {
  const f = fixture(t);
  recordSession(f.snapshot('native', '10:00', '10:01', 1, { usage: {} }), f.options);
  const transcript = f.snapshot('transcript', '10:00', '10:02', 1, { usage: { input: 110, output: 0, cacheRead: 0, cacheWrite: 0, total: 110 }, cost: { usd: null, kind: 'unavailable', source: 'unknown' } });
  const result = recordSession(transcript, f.options);
  assert.equal(result.session.cost.usd, 1);
  assert.equal(result.session.cost.source, 'fixture');
  assert.equal(result.session.usage.total, 110);
  assert.equal(result.session.partial, true);
  recordSession(transcript, f.options);
  const data = readTelemetry(f.options);
  assert.equal(data.sessions[0].cost.usd, 1);
  assert.equal(data.sessions[0].usage.total, 110);
  assert.equal(f.total(), 1);
});

test('pre-request baseline excludes paused consumption without losing the first enabled turn', t => {
  const f = fixture(t);
  const identity = { host: 'claude', sessionId: 'same-session', projectRoot: f.projectRoot };
  recordSession(f.snapshot('transcript', '10:00', '10:01', 1), f.options);
  assert.equal(needsSessionBaseline(identity, f.options), false);
  configureTelemetry({ enabled: false }, f.options);
  assert.equal(needsSessionBaseline(identity, f.options), false);
  configureTelemetry({ enabled: true }, { ...f.options, now: new Date('2026-11-06T10:03:00Z') });
  assert.equal(needsSessionBaseline(identity, f.options), true);
  const paused = f.snapshot('transcript', '10:00', '10:02', 7);
  const baselineOptions = { ...f.options, now: new Date('2026-11-06T10:03:01Z') };
  assert.equal(primeSessionBaseline(paused, baselineOptions).primed, true);
  assert.equal(needsSessionBaseline(identity, f.options), false);
  assert.equal(primeSessionBaseline(paused, baselineOptions).primed, false);
  assert.equal(readTelemetry(f.options).segments.length, 1);
  assert.equal(readTelemetry(f.options).sessions[0].cost.usd, 1);
  const completed = f.snapshot('transcript', '10:00', '10:04', 8);
  recordSession(completed, f.options); recordSession(completed, f.options);
  assert.equal(f.total(), 2);
  const data = readTelemetry(f.options);
  assert.equal(data.sessions[0].usage.total, 200);
  assert.equal(data.segments.find(s => s.endedAt === '2026-11-06T10:04:00.000Z').startedAt, '2026-11-06T10:03:01.000Z');
});

test('baselining never consumes fresh sessions or unknown counters', t => {
  const f = fixture(t);
  const options = { ...f.options, now: new Date('2026-11-06T10:03:00Z') };
  assert.equal(primeSessionBaseline(f.snapshot('transcript', '10:00', '10:01', 1), options).reason, 'no-collection-boundary');
  assert.equal(primeSessionBaseline(f.snapshot('transcript', '08:00', '08:01', 1, { usage: {} }), options).reason, 'usage-unavailable');
  assert.equal(readTelemetry(f.options).sessions.length, 0);
  assert.equal(readTelemetry(f.options).segments.length, 0);
});

test('retention keeps a recent baseline until the first completed session arrives, then expires old orphans', t => {
  const f = fixture(t);
  const sampled = Date.now();
  const at = offset => new Date(sampled + offset).toISOString();
  configureTelemetry({ enabled: false }, f.options);
  configureTelemetry({ enabled: true, retentionDays: 1 }, { ...f.options, now: new Date(sampled - 1000) });
  const identity = { host: 'claude', sessionId: 'same-session', projectRoot: f.projectRoot };
  const baseline = f.snapshot('transcript', '08:00', '08:01', 7, { startedAt: at(-60000), updatedAt: at(-2000) });
  primeSessionBaseline(baseline, { ...f.options, now: new Date(sampled) });
  recordObservation({ ...identity, toolUseId: 'tool-1', toolName: 'Read', recordedAt: at(100) }, f.options);
  pruneTelemetry({ ...f.options, before: at(-86400000) });
  assert.equal(needsSessionBaseline(identity, f.options), false);
  recordSession({ ...baseline, updatedAt: at(1000), cost: { usd: 8, kind: 'reported', source: 'fixture' },
    usage: { input: 800, output: 0, cacheRead: 0, cacheWrite: 0, total: 800 } }, f.options);
  assert.equal(f.total(), 1);
  assert.equal(readTelemetry(f.options).sessions[0].usage.total, 100);
  const orphan = { ...baseline, sessionId: 'orphan' };
  primeSessionBaseline(orphan, { ...f.options, now: new Date(sampled) });
  pruneTelemetry({ ...f.options, before: at(2000) });
  assert.equal(needsSessionBaseline({ ...identity, sessionId: 'orphan' }, f.options), true);
});
