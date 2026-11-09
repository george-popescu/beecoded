import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { buildBoardData, metric, summarizeSessions } from './board/data.mjs';
import { bindAttribution, configureTelemetry, recordSession } from './telemetry/index.mjs';

test('unknown and partial values are not zero and child totals are not counted twice', () => {
  assert.deepEqual(metric([null, undefined]), { value: null, known: 0, total: 2 });
  assert.deepEqual(metric([0, 3, null]), { value: 3, known: 2, total: 3 });
  const base = { projectId: 'p', host: 'codex', usage: { total: 100 }, activeMs: null };
  const result = summarizeSessions([
    { ...base, sessionId: 'parent', cost: { usd: 2, kind: 'estimated' } },
    { ...base, sessionId: 'child', parentSessionId: 'parent', cost: { usd: 1, kind: 'estimated' } },
    { ...base, host: 'claude', sessionId: 'other', cost: { usd: null, kind: 'unavailable' } },
  ]);
  assert.deepEqual(result.cost, { value: 2, known: 1, total: 2, partial: true });
  assert.equal(result.childRowsExcluded, 1);
  assert.equal(result.tokens.value, 200);
});

test('explicit session-only scopes add children and incomplete process scopes remain partial', () => {
  const base = { host: 'claude', projectId: 'p', usageScope: 'session-only', measurementScope: 'session', cost: { usd: 1 }, usage: { total: 100 } };
  const parent = { ...base, sessionId: 'p' };
  const child = { ...base, sessionId: 'c', parentSessionId: 'p', cost: { usd: .5 }, usage: { total: 50 } };
  const sum = summarizeSessions([parent, child]);
  assert.equal(sum.cost.value, 1.5); assert.equal(sum.tokens.value, 150); assert.equal(sum.cost.partial, false);
  const incomplete = summarizeSessions([{ ...parent, measurementScope: 'host-current-process', partial: true }, child]);
  assert.equal(incomplete.cost.partial, true);
  const included = summarizeSessions([{ ...parent, usageScope: 'includes-children' }, child]);
  assert.equal(included.cost.value, 1); assert.equal(included.childRowsExcluded, 1);
});

test('a Board read preserves projects and does not initialize telemetry', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-board-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const a = path.join(temp, 'one', 'api'); const b = path.join(temp, 'two', 'api');
  fs.mkdirSync(a, { recursive: true }); fs.mkdirSync(b, { recursive: true });
  const stateDir = path.join(temp, 'state');
  const data = buildBoardData({ projectRoots: [a, b, a], stateDir });
  assert.equal(data.projects.length, 2);
  assert.notEqual(data.projects[0].projectId, data.projects[1].projectId);
  assert.notEqual(data.projects[0].label, data.projects[1].label);
  assert.equal(data.summary.cost.value, null);
  assert.equal(fs.existsSync(stateDir), false);
  assert.deepEqual(fs.readdirSync(a), []);
});

test('Board connects recorded work to sessions and interval costs without relabeling history', t => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-board-attribution-')));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const projectRoot = path.join(temp, 'project'), stateDir = path.join(temp, 'state');
  const topicA = 'docs/work/2026-11-06-first', topicB = 'docs/work/2026-11-06-second';
  for (const topic of [topicA, topicB]) {
    fs.mkdirSync(path.join(projectRoot, topic), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, topic, 'design.md'), '# Recorded work\nA scoped outcome.\n');
    fs.writeFileSync(path.join(projectRoot, topic, 'plan.md'), '# Plan\nWorkflow: nectar-slim-v1\n- [ ] T1: Complete the outcome\n## Verification\nStatus: pending\nEvidence:\n');
  }
  configureTelemetry({ enabled: true }, { stateDir });
  const identity = { host: 'codex', sessionId: 'board-test-session', projectRoot };
  bindAttribution({ ...identity, topic: topicA, skill: 'nectar-build', scope: 'session' }, { stateDir });
  const snapshot = n => ({ ...identity, source: 'live', startedAt: '2026-11-06T10:00:00Z', updatedAt: `2026-11-06T10:0${n}:00Z`,
    usage: { input: n * 80, output: n * 20, cacheRead: 0, cacheWrite: 0, total: n * 100 },
    cost: { usd: n, kind: 'reported', source: 'fixture' }, activeMs: n * 1000, wallMs: n * 60000,
    usageScope: 'session-only', measurementScope: 'session' });
  recordSession(snapshot(1), { stateDir });
  bindAttribution({ ...identity, topic: topicB, skill: 'nectar-review' }, { stateDir });
  recordSession(snapshot(2), { stateDir });
  recordSession(snapshot(3), { stateDir });
  const board = buildBoardData({ projectRoots: [projectRoot], stateDir });
  const project = board.projects[0];
  assert.equal(project.sessions.length, 1);
  assert.equal(project.topics.find(topic => topic.path === topicA).sessionKeys.length, 1);
  assert.equal(project.topics.find(topic => topic.path === topicB).sessionKeys.length, 1);
  assert.equal(project.attribution.byTopic.find(group => group.label === topicA).cost.usd, 1);
  assert.equal(project.attribution.byTopic.find(group => group.label === topicB).cost.usd, 1);
  assert.equal(project.attribution.byTopic.find(group => group.unattributed).cost.usd, 1);
  assert.equal(project.attribution.bySkill.find(group => group.label === 'nectar-review').usage.total, 100);
});

test('Git root and nested aliases share one Board project and root work documents', t => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-board-alias-')));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'repo'), nested = path.join(root, 'src');
  const topic = 'docs/work/2026-11-06-alias';
  fs.mkdirSync(nested, { recursive: true }); fs.mkdirSync(path.join(root, topic), { recursive: true });
  fs.writeFileSync(path.join(root, topic, 'design.md'), '# Alias work');
  assert.equal(spawnSync('git', ['init', '-q', root]).status, 0);
  const stateDir = path.join(temp, 'state'); configureTelemetry({ enabled: true }, { stateDir });
  recordSession({ host: 'codex', sessionId: 'alias', projectRoot: root, source: 'live',
    startedAt: '2026-11-06T10:00:00Z', updatedAt: '2026-11-06T10:01:00Z',
    usage: { total: 100 }, cost: { usd: 1, kind: 'reported', source: 'fixture' } }, { stateDir });
  for (const projectRoots of [[root, nested], [nested, root], [nested]]) {
    const board = buildBoardData({ projectRoots, stateDir });
    assert.equal(board.projects.length, 1); assert.equal(board.summary.cost.value, 1);
    assert.equal(board.projects[0].projectRoot, root);
    assert.equal(board.projects[0].topics[0].path, topic);
    assert.ok(board.projects[0].topics[0].links.design.endsWith(`${topic}/design.md`));
  }
});
