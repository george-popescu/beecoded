import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { metric, selectAggregateSessions, summarizeSessions } from './metrics.mjs';
import { summarizeAttribution } from '../telemetry/attribution.mjs';
import { publicSegments } from '../telemetry/index.mjs';

const script = [metric, selectAggregateSessions, summarizeSessions, summarizeAttribution].map(fn => fn.toString()).join('\n')
  + '\n' + fs.readFileSync(new URL('./client.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('./style.css', import.meta.url), 'utf8');
const logoUrl = `data:image/svg+xml,${encodeURIComponent(fs.readFileSync(new URL('./coamb-mark.svg', import.meta.url), 'utf8'))}`;
const digest = createHash('sha256').update(script).digest('base64');

export function renderBoard(data) {
  // Match telemetry's public identity policy without requiring browser crypto on file://.
  const sessionKey = (host, id, project) => createHash('sha256').update(`${host}\0${id}\0${project}`).digest('hex');
  const prepared = { ...data, projects: data.projects.map(project => ({ ...project, sessions: project.sessions.map(session => ({
    ...session, key: sessionKey(session.host, session.sessionId, project.projectId),
    parentKey: session.parentSessionId ? sessionKey(session.host, session.parentSessionId, project.projectId) : null,
  })), ...(project.segments ? { segments: project.segments.map(segment => ({
    ...segment, publicExport: publicSegments([segment])[0],
  })) } : {}) })) };
  const json = JSON.stringify(prepared).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${digest}'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<title>Coamb</title><link rel="icon" type="image/svg+xml" href="${logoUrl}"><style>${css}</style></head><body>
<a class="skip" href="#main">Skip to delivery</a>
<div class="shell"><aside><a class="brand" href="#main"><img src="${logoUrl}" width="28" height="28" alt="">Coamb</a>
<details class="project-menu" open><summary>Projects</summary><nav id="projects" aria-label="Projects"></nav></details>
<div class="rail-foot">Local snapshot<p>Claude Code + Codex</p></div></aside>
<main id="main"><header><div><h1 id="title">All projects</h1><p id="snapshot" class="muted"></p><p id="preview-label" class="preview-label" hidden>Synthetic preview · example projects and measurements</p></div><div class="actions"><button id="export-json">Export usage JSON</button><button id="copy-command">Copy refresh command</button></div></header>
<div id="notice" role="status" class="notice" hidden></div>
<div class="tabs" role="group" aria-label="Board view"><button id="work-tab" aria-pressed="true">Delivery</button><button id="usage-tab" aria-pressed="false">Usage & cost</button></div>
<section id="work-view" aria-label="Delivery"><div class="section-head"><div><h2>Delivery</h2><p id="work-note" class="muted">Recorded work and its evidence.</p></div><label>Find work<input id="work-search" type="search" placeholder="Search topics"></label></div>
<div id="work-summary" class="summary" aria-live="polite"></div><div id="work-table" class="table-scroll" tabindex="0" aria-label="Recorded work"></div><div id="diagnostics"></div></section>
<section id="usage-view" aria-label="Usage and cost" hidden><div class="filters"><label>Host<select id="host"><option value="">All hosts</option><option value="claude">Claude</option><option value="codex">Codex</option></select></label><label>Model<select id="model"><option value="">All models</option></select></label><label>Period<select id="period"><option value="0">All time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label><label class="grow">Find session<input id="session-search" type="search" placeholder="Session ID, project or topic"></label><button id="export-csv">Export filtered CSV</button></div>
<div class="attribution-filters"><label>Work<select id="topic-filter"><option value="">All work</option><option value="unassigned">Unassigned work</option></select></label><label>Skill<select id="skill-filter"><option value="">All skills</option><option value="unassigned">Unassigned skill</option></select></label><button id="clear-attribution">Clear work / skill</button></div>
<div id="usage-summary" class="summary" aria-live="polite"></div><details class="data-note"><summary id="usage-note">Measurement details</summary><p>Linked children are counted separately only when parent totals cover the parent session alone. Unknown overlap, incomplete imports and current-process measurements keep totals partial. Turn time includes waits. API-equivalent costs are not subscription invoices.</p><p id="collection-note"></p></details>
<section class="attribution-panel" aria-label="Attributed usage"><div class="section-head"><div><h2>Attributed usage</h2><p class="muted">Measured intervals, not full-session costs reassigned to the latest skill.</p></div><label>Group by<select id="attribution-group"><option value="topic">Work</option><option value="skill">Skill</option></select></label><button id="export-attribution">Export intervals CSV</button></div><div id="attribution-table" class="table-scroll" tabindex="0" aria-label="Usage by work or skill"></div><p id="attribution-note" class="chart-caption"></p></section>
<div class="chart-panel"><div class="section-head"><h2>Session usage</h2><label>Measure<select id="chart-metric"><option value="cost">API-equivalent cost · USD</option><option value="tokens">Tokens</option><option value="time">Recorded time · minutes</option></select></label></div><div id="chart"></div><p class="chart-caption">Session totals by start date (UTC), not daily consumption.</p></div>
<div class="section-head"><div><h2>Sessions</h2><p id="session-scope" class="muted">Full recorded session totals.</p></div><span id="session-count" class="muted"></span></div><div id="session-table" class="table-scroll" tabindex="0" aria-label="Session usage"></div></section>
<footer><details class="data-note"><summary>About this snapshot</summary><p>Generated locally; no server or background requests. Delivery states come from saved plans and reviews, not a new QA run. Unknown measurements remain unknown. Usage exports omit local paths and raw session IDs.</p></details></footer></main></div>
<script type="application/json" id="board-data">${json}</script><script>${script}</script></body></html>`;
}
