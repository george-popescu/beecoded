import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectWorkTree } from '../doctor/inspect.mjs';
import { readTelemetry, projectIdentity } from '../telemetry/index.mjs';
import { summarizeSessions } from './metrics.mjs';
import { summarizeAttribution } from '../telemetry/attribution.mjs';
export { metric, summarizeSessions } from './metrics.mjs';

function artifactLink(root, relative) {
  const target = path.resolve(root, relative);
  const parts = path.relative(root, target).split(path.sep);
  if (parts.includes('..') || path.isAbsolute(path.relative(root, target))) return null;
  let current = root;
  try {
    for (const part of parts) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) return null;
    }
    return fs.statSync(target).isFile() ? pathToFileURL(target).href : null;
  } catch { return null; }
}

export function buildBoardData({ projectRoots, stateDir, now = new Date() }) {
  const projects = [...new Set(projectRoots.map(root => projectIdentity(root).projectRoot))].map(root => {
    const identity = projectIdentity(root);
    let work;
    try { work = inspectWorkTree(root); }
    catch (error) { work = { topics: [], diagnostics: [{ severity: 'error', message: `Work state unavailable: ${error.code || 'inspection failed'}` }] }; }
    let telemetry;
    try { telemetry = readTelemetry({ stateDir, projectRoot: root }); }
    catch { telemetry = { sessions: [], segments: [], bindings: [], settings: { enabled: false }, diagnostics: ['Telemetry could not be read. Run nectar telemetry status.'] }; }
    const segments = telemetry.segments ?? [], bindings = telemetry.bindings ?? [];
    const byTopic = summarizeAttribution(segments, { group: 'topic' });
    return { ...identity, topics: work.topics.map(topic => ({
      ...topic,
      sessionKeys: [...new Set([...segments.filter(s => !s.superseded && s.topic === topic.path).map(s => s.sessionKey),
        ...bindings.filter(b => b.topic === topic.path).map(b => b.sessionKey)])],
      attribution: byTopic.find(group => group.label === topic.path) ?? null,
      links: Object.fromEntries(['design', 'plan', 'review'].map(name => [name, artifactLink(root, `${topic.path}/${name}.md`)])),
    })), diagnostics: work.diagnostics, telemetryDiagnostics: telemetry.diagnostics,
    collectionEnabled: telemetry.settings.enabled, sessions: telemetry.sessions,
    segments, bindings, attribution: { byTopic, bySkill: summarizeAttribution(segments, { group: 'skill' }) },
    };
  });
  const labels = projects.map(project => project.label);
  for (const project of projects) {
    if (labels.filter(label => label === project.label).length > 1) {
      project.label = `${project.label} · ${path.basename(path.dirname(project.projectRoot))} · ${project.projectId.slice(0, 6)}`;
    }
  }
  return { schema: 1, generatedAt: now.toISOString(), projects, summary: summarizeSessions(projects.flatMap(p => p.sessions)) };
}
