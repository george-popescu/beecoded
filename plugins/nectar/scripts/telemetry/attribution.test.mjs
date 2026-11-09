import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { bindAttribution, configureTelemetry, recordSession, recordObservation, readTelemetry, summarizeAttribution, publicSegments, exportTelemetry, pruneTelemetry } from './index.mjs';
import { runTelemetry } from '../run-telemetry.mjs';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-attribution-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectRoot = path.join(root, 'project'); fs.mkdirSync(projectRoot);
  for (const topic of ['work-a', 'work-b']) {
    fs.mkdirSync(path.join(projectRoot, 'docs/work', topic), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'docs/work', topic, 'plan.md'), '# Test work');
  }
  spawnSync('git', ['init', '-q', '--initial-branch=fixture', projectRoot]);
  const stateDir = path.join(root, 'state'); configureTelemetry({ enabled: true }, { stateDir, now: new Date('2026-11-06T09:00:00Z') });
  const input = { host: 'codex', sessionId: 'test-session', projectRoot };
  const snapshot = (minute, amount) => ({ ...input, source: 'live', metricSource: 'provided', measurementScope: 'session', usageScope: 'session-only',
    startedAt: '2026-11-06T10:00:00Z', updatedAt: `2026-11-06T10:${String(minute).padStart(2, '0')}:00Z`,
    usage: { input: amount, output: amount, cacheRead: 0, cacheWrite: 0, total: amount * 2 },
    cost: { usd: amount / 100, kind: 'reported', source: 'fixture' }, activeMs: amount * 1000, wallMs: amount * 1000,
    models: ['example'], model: 'example', turns: minute, partial: false });
  return { root, projectRoot, stateDir, input, snapshot };
}

test('launch links initial window; switches isolate future deltas and duplicate reads never reassign history', t => {
  const f = fixture(t), options = { stateDir: f.stateDir };
  bindAttribution({ ...f.input, topic: 'docs/work/work-a', skill: 'nectar-build', scope: 'session', source: 'launch' }, options);
  recordSession(f.snapshot(1, 10), options);
  recordSession(f.snapshot(2, 20), options);
  bindAttribution({ ...f.input, topic: 'docs/work/work-b', skill: 'nectar-review' }, options);
  recordSession(f.snapshot(2, 20), options);
  recordSession(f.snapshot(3, 30), options); // The unsampled boundary is not charged to the new work.
  recordSession(f.snapshot(4, 40), options);
  recordSession(f.snapshot(4, 40), options);
  const result = readTelemetry(options);
  assert.equal(result.segments.length, 4);
  assert.equal(result.sessions[0].git.branch, 'fixture');
  assert.equal(result.sessions[0].git.worktree, f.projectRoot);
  assert.equal(result.sessions[0].topic, 'docs/work/work-b');
  const groups = summarizeAttribution(result.segments, { group: 'topic' });
  assert.ok(Math.abs(groups.find(g => g.label === 'docs/work/work-a').cost.usd - .2) < 1e-12);
  assert.ok(Math.abs(groups.find(g => g.label === 'docs/work/work-b').cost.usd - .1) < 1e-12);
  assert.ok(Math.abs(groups.find(g => g.unattributed).cost.usd - .1) < 1e-12);
  assert.equal(result.segments[2].skill, null);
  assert.ok(result.segments[2].reasons.includes('assignment-boundary-unmeasured'));
  assert.throws(() => bindAttribution({ ...f.input, topic: 'docs/work/work-a', scope: 'session' }, options), /before the first snapshot/);
});

test('nested cwd maps to its worktree root; linked Git worktrees share repository identity but not project state', t => {
  const f = fixture(t); const git = args => {
    const r = spawnSync('git', ['-C', f.projectRoot, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  };
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture']);
  const other = path.join(f.root, 'other-worktree'); git(['worktree', 'add', '-qb', 'other', other]);
  const nested = path.join(f.projectRoot, 'nested'); fs.mkdirSync(nested);
  recordSession({ ...f.snapshot(1, 10), projectRoot: nested }, f);
  recordSession({ ...f.snapshot(1, 10), projectRoot: other }, f);
  const rows = readTelemetry({ stateDir: f.stateDir }).sessions;
  assert.equal(rows.length, 2); assert.notEqual(rows[0].projectId, rows[1].projectId);
  assert.equal(rows[0].git.repositoryId, rows[1].git.repositoryId);
  assert.deepEqual(new Set(rows.map(s => s.git.branch)), new Set(['fixture', 'other']));
  assert.equal(readTelemetry({ stateDir: f.stateDir, projectRoot: nested }).sessions[0].projectRoot, f.projectRoot);
});

test('explicit CLI links validate topics/skills and allow clearing without rewriting past segments', async t => {
  const f = fixture(t); const common = ['--host', 'codex', '--session', f.input.sessionId, '--project', f.projectRoot, '--state-dir', f.stateDir];
  await runTelemetry(['link', ...common, '--topic', 'docs/work/work-a', '--skill', 'nectar-review', '--scope', 'session']);
  recordSession(f.snapshot(1, 10), f);
  await runTelemetry(['unlink', ...common]);
  const groups = JSON.parse(await runTelemetry(['summary', '--group', 'skill', '--state-dir', f.stateDir])).groups;
  assert.equal(groups[0].label, 'nectar-review');
  assert.equal(readTelemetry(f).sessions[0].skill, null);
  assert.throws(() => bindAttribution({ ...f.input, topic: '../escape' }, f), /Topic/);
  assert.throws(() => bindAttribution({ ...f.input, skill: 'unknown-skill' }, f), /shipped/);
  const link = path.join(f.projectRoot, 'docs/work/link'); fs.symlinkSync(path.join(f.projectRoot, 'docs/work/work-a'), link);
  assert.throws(() => bindAttribution({ ...f.input, topic: 'docs/work/link' }, f), /Topic/);
  const exported = exportTelemetry(f);
  assert.equal(exported.includes('docs/work/work-a'), false); assert.equal(exported.includes(f.input.sessionId), false);
  assert.equal(exported.includes(f.projectRoot), false); assert.equal(exported.includes('fixture'), true); // cost provenance remains.
  assert.equal(publicSegments(readTelemetry(f).segments)[0].topicKey.length, 64);
});

test('a skill activation does not discard an unchanged explicit work assignment', t => {
  const f = fixture(t);
  bindAttribution({ ...f.input, topic: 'docs/work/work-a', scope: 'session', source: 'launch' }, f);
  bindAttribution({ ...f.input, skill: 'nectar-review', scope: 'session', source: 'skill-event' }, f);
  recordSession(f.snapshot(1, 10), f);
  let segment = readTelemetry(f).segments[0];
  assert.equal(segment.topic, 'docs/work/work-a'); assert.equal(segment.skill, null);
  assert.equal(segment.topicAttributionSource, 'launch');
  recordSession(f.snapshot(2, 20), f);
  segment = readTelemetry(f).segments[1];
  assert.equal(segment.topic, 'docs/work/work-a'); assert.equal(segment.skill, 'nectar-review');
  bindAttribution({ ...f.input, topic: 'docs/work/work-b' }, f);
  recordSession(f.snapshot(3, 30), f);
  segment = readTelemetry(f).segments[2];
  assert.equal(segment.topic, null); assert.equal(segment.skill, 'nectar-review');
});

test('a confirmed initial prompt can resolve a pending skill boundary before any snapshot, never retroactively', t => {
  const f = fixture(t);
  bindAttribution({ ...f.input, topic: 'docs/work/work-a', scope: 'session', source: 'launch' }, f);
  bindAttribution({ ...f.input, skill: 'nectar-review', scope: 'next-interval', source: 'skill-event' }, f);
  const resolved = bindAttribution({ ...f.input, skill: 'nectar-review', scope: 'session', source: 'prompt' }, f);
  assert.equal(resolved.pending, false);
  recordSession(f.snapshot(1, 10), f);
  assert.equal(readTelemetry(f).segments[0].skill, 'nectar-review');
  bindAttribution({ ...f.input, skill: 'nectar-build', scope: 'next-interval', source: 'skill-event' }, f);
  assert.throws(() => bindAttribution({ ...f.input, skill: 'nectar-review', scope: 'session', source: 'prompt' }, f), /before the first/);
  assert.equal(readTelemetry(f).segments[0].skill, 'nectar-review');
});

test('unknown parent overlap is excluded even when grouping only the child skill', () => {
  const parent = { key: 'p', sessionKey: 'p', projectId: 'repo', host: 'codex', sessionId: 'parent', parentSessionId: null,
    topic: 'work', skill: 'nectar-build', startedAt: 'a', endedAt: 'z', usageScope: 'unknown', measurementScope: 'session',
    usage: { total: 100 }, cost: { usd: 1 }, activeMs: null };
  const child = { ...parent, key: 'c', sessionKey: 'c', sessionId: 'child', parentSessionId: 'parent', skill: 'nectar-review',
    startedAt: 'b', endedAt: 'c', cost: { usd: .5 } };
  const result = summarizeAttribution([child], { group: 'skill', allSegments: [parent, child] });
  assert.equal(result[0].cost.usd, null); assert.equal(result[0].excludedChildren, 1); assert.equal(result[0].partial, true);
  const spanning = { ...child, startedAt: 'b', endedAt: 'y' };
  const first = { ...parent, startedAt: 'a', endedAt: 'm' };
  const last = { ...parent, key: 'p2', startedAt: 'm', endedAt: 'z' };
  const across = summarizeAttribution([spanning], { group: 'skill', allSegments: [first, last, spanning] });
  assert.equal(across[0].cost.usd, null); assert.equal(across[0].excludedChildren, 1);
  const middle = { ...child, usageScope: 'session-only', startedAt: 'a', endedAt: 'z' };
  const grandchild = { ...child, key: 'g', sessionKey: 'g', sessionId: 'grandchild', parentSessionId: 'child', skill: 'nectar-audit' };
  const nested = summarizeAttribution([grandchild], { group: 'skill', allSegments: [parent, middle, grandchild] });
  assert.equal(nested[0].cost.usd, null); assert.equal(nested[0].excludedChildren, 1);
});

test('reset native measurement windows retain earlier attributed deltas and mark the new window partial', t => {
  const f = fixture(t);
  bindAttribution({ ...f.input, skill: 'nectar-build', scope: 'session', source: 'launch' }, f);
  recordSession({ ...f.snapshot(1, 10), metricSource: 'native', measurementId: 'process-one' }, f);
  recordSession({ ...f.snapshot(2, 3), startedAt: '2026-11-06T10:01:30Z', metricSource: 'native', measurementId: 'process-two' }, f);
  const data = readTelemetry(f); const group = summarizeAttribution(data.segments, { group: 'skill' })[0];
  assert.equal(data.segments.length, 2); assert.ok(Math.abs(group.cost.usd - .13) < 1e-12);
  assert.equal(group.partial, true); assert.ok(data.segments[1].reasons.includes('measurement-window-changed'));
});

test('pricing is configured explicitly for future snapshots and missing charged counts stay a partial subtotal', async t => {
  const f = fixture(t); const rates = path.join(f.root, 'rates.json');
  fs.writeFileSync(rates, JSON.stringify({ schemaVersion: 1, currency: 'USD', rateDate: '2026-11-06', models: { example: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 } } }));
  await runTelemetry(['configure', '--pricing-file', rates, '--state-dir', f.stateDir]);
  const recorded = recordSession({ ...f.snapshot(1, 10), usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: null, total: 120 },
    cost: { usd: null, kind: 'unavailable', source: 'unavailable' } }, f);
  assert.equal(recorded.session.cost.usd, .002); assert.equal(recorded.session.cost.partial, true);
  assert.ok(recorded.session.diagnosticCodes.includes('priced-known-usage-subtotal'));
});

test('old telemetry stores remain readable and new writes create attribution tables; pruning removes intervals', t => {
  const f = fixture(t); const db = new DatabaseSync(path.join(f.stateDir, 'telemetry.sqlite'));
  db.exec('DROP TABLE bindings; DROP TABLE usage_segments;'); db.close();
  assert.deepEqual(readTelemetry(f).segments, []);
  recordSession(f.snapshot(1, 10), f);
  assert.equal(readTelemetry(f).segments.length, 1);
  assert.equal(pruneTelemetry({ ...f, before: '2026-11-07' }).segmentsRemoved, 1);
});

test('retention preserves a launch binding while tool observations arrive before the first snapshot', t => {
  const f = fixture(t); configureTelemetry({ retentionDays: 90 }, f);
  bindAttribution({ ...f.input, topic: 'docs/work/work-a', skill: 'nectar-build', scope: 'session', source: 'launch' }, f);
  recordObservation({ ...f.input, toolUseId: 'first-call', toolName: 'read' }, f);
  const now = new Date().toISOString();
  recordSession({ ...f.snapshot(1, 10), startedAt: now, updatedAt: now }, f);
  assert.equal(readTelemetry(f).segments[0].topic, 'docs/work/work-a');
  assert.equal(readTelemetry(f).segments[0].skill, 'nectar-build');
});
