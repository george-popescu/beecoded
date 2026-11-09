import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function validateAssignment({ topic = null, skill = null }, projectRoot) {
  if (topic !== null) {
    if (typeof topic !== 'string' || !/^docs\/work\/[\w./-]+$/.test(topic) || topic.split('/').includes('..')) throw new Error('Topic must name an existing docs/work directory');
    topic = topic.replace(/\/$/, '');
    const directory = path.resolve(projectRoot, topic);
    if (fs.realpathSync(directory) !== directory || !fs.statSync(directory).isDirectory()
      || !['design.md', 'plan.md'].some(file => { try { return fs.lstatSync(path.join(directory, file)).isFile(); } catch { return false; } })) {
      throw new Error('Topic must have a recorded design or plan in this project');
    }
  }
  if (skill !== null && (typeof skill !== 'string' || !/^nectar-[a-z-]+$/.test(skill)
    || !fs.existsSync(new URL(`../../internal-skills/${skill}/SKILL.md`, import.meta.url)))) throw new Error('Skill must be a shipped Nectar skill');
  return { topic, skill };
}

function gitRead(projectRoot, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const r = spawnSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', projectRoot, ...args],
      { env, encoding: 'utf8', timeout: 1000, maxBuffer: 4096, stdio: ['ignore', 'pipe', 'ignore'] });
  const text = r.status === 0 ? r.stdout.trim() : '';
  return text && text.length <= 1000 && !/[\x00-\x1f]/.test(text) ? text : null;
}

export function canonicalProjectRoot(root) {
  return fs.realpathSync(gitRead(root, ['rev-parse', '--show-toplevel']) ?? root);
}

export function gitMetadata(projectRoot) {
  const git = args => gitRead(projectRoot, args);
  const worktree = git(['rev-parse', '--show-toplevel']);
  if (!worktree) return null;
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return { branch: git(['symbolic-ref', '--quiet', '--short', 'HEAD']), head: git(['rev-parse', '--verify', 'HEAD']),
    worktree, repositoryId: common ? fingerprint(fs.realpathSync(common)) : null };
}

export function snapshotIdentity(session) {
  return fingerprint([session.key, session.metricSource, session.measurementScope, session.measurementId ?? session.startedAt, session.collectionEpoch ?? 0]);
}

export function usageSegment(session, previous, binding) {
  const comparable = previous && snapshotIdentity(previous) === snapshotIdentity(session);
  const reset = previous && !comparable;
  const reasons = [];
  const delta = (value, old, name) => {
    if (typeof value !== 'number') return null;
    if (!previous || reset) return value;
    if (typeof old !== 'number' || value < old) { reasons.push(`incomparable-${name}`); return null; }
    return value - old;
  };
  const pendingFields = binding?.pendingFields ?? (binding?.pending ? ['topic', 'skill'] : []);
  if (binding?.pending) reasons.push('assignment-boundary-unmeasured');
  if (!binding) reasons.push('unattributed');
  if (reset) reasons.push('measurement-window-changed');
  const usage = Object.fromEntries(Object.entries(session.usage).map(([name, value]) => [name, delta(value, previous?.usage?.[name], name)]));
  const samePrice = !previous || reset || (session.cost.kind === previous.cost.kind && session.cost.source === previous.cost.source);
  const usd = samePrice ? delta(session.cost.usd, previous?.cost?.usd, 'cost') : null;
  if (!samePrice) reasons.push('cost-basis-changed');
  return {
    key: fingerprint([snapshotIdentity(session), session.updatedAt]), sessionKey: session.key, projectId: session.projectId,
    host: session.host, sessionId: session.sessionId, parentSessionId: session.parentSessionId,
    topic: pendingFields.includes('topic') ? null : binding?.topic ?? null,
    skill: pendingFields.includes('skill') ? null : binding?.skill ?? null,
    attributionSource: binding?.source ?? 'unattributed',
    topicAttributionSource: binding?.topicSource ?? binding?.source ?? 'unattributed',
    skillAttributionSource: binding?.skillSource ?? binding?.source ?? 'unattributed',
    startedAt: comparable ? previous.updatedAt : session.startedAt, endedAt: session.updatedAt,
    usage, cost: { ...session.cost, usd, kind: usd === null ? 'unavailable' : session.cost.kind },
    activeMs: delta(session.activeMs, previous?.activeMs, 'active-time'), wallMs: delta(session.wallMs, previous?.wallMs, 'wall-time'),
    model: session.model, models: session.models, git: session.git,
    usageScope: session.usageScope, measurementScope: session.measurementScope,
    partial: session.partial || reasons.length > 0, reasons: [...new Set(reasons)], superseded: false,
  };
}

export function summarizeAttribution(segments, { group = 'topic', allSegments = segments } = {}) {
  if (!['topic', 'skill'].includes(group)) throw new Error('Attribution group must be topic or skill');
  const active = segments.filter(s => !s.superseded);
  const possibleParents = allSegments.filter(s => !s.superseded);
  const totals = new Map();
  for (const segment of active) {
    const label = segment[group] ?? null;
    const key = `${segment.projectId}:${label ?? 'unattributed'}`;
    if (!totals.has(key)) totals.set(key, { key, projectId: segment.projectId, label, unattributed: label === null,
      sessionKeys: new Set(), segmentCount: 0, cost: { usd: null, known: 0, total: 0 },
      usage: { input: null, output: null, cacheRead: null, cacheWrite: null, total: null }, activeMs: null,
      partial: false, excludedChildren: 0 });
    const row = totals.get(key);
    row.sessionKeys.add(segment.sessionKey); row.segmentCount++;
    const parents = segment.parentSessionId ? [segment.parentSessionId] : [], visited = new Set();
    let overlapsParent = false;
    while (parents.length && !overlapsParent) {
      const parentId = parents.pop();
      if (visited.has(parentId)) continue;
      visited.add(parentId);
      if (parentId === segment.sessionId) { overlapsParent = true; break; }
      for (const parent of possibleParents.filter(s => s.projectId === segment.projectId && s.host === segment.host
        && s.sessionId === parentId && s.startedAt <= segment.endedAt && s.endedAt >= segment.startedAt)) {
        if (parent.usageScope !== 'session-only') { overlapsParent = true; break; }
        if (parent.parentSessionId) parents.push(parent.parentSessionId);
      }
    }
    if (overlapsParent) { row.excludedChildren++; row.partial = true; continue; }
    row.cost.total++;
    if (typeof segment.cost?.usd === 'number') { row.cost.usd = (row.cost.usd ?? 0) + segment.cost.usd; row.cost.known++; }
    for (const [name, value] of Object.entries(segment.usage)) if (typeof value === 'number') row.usage[name] = (row.usage[name] ?? 0) + value;
    if (typeof segment.activeMs === 'number') row.activeMs = (row.activeMs ?? 0) + segment.activeMs;
    row.partial ||= segment.partial || segment.usageScope === 'unknown' || segment.measurementScope === 'host-current-process'
      || segment.usage.total == null;
  }
  return [...totals.values()].map(({ sessionKeys, ...row }) => ({ ...row, sessionCount: sessionKeys.size,
    partial: row.partial || row.cost.known < row.cost.total })).sort((a, b) => (b.cost.usd ?? -1) - (a.cost.usd ?? -1));
}
