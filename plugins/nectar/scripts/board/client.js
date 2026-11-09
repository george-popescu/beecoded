(() => {
  'use strict';
  const data = JSON.parse(document.getElementById('board-data').textContent);
  const state = { project: '', view: 'work' };
  const $ = id => document.getElementById(id);
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
  const clear = node => node.replaceChildren();
  const projects = () => data.projects.filter(p => !state.project || p.projectId === state.project);
  const allSegments = () => projects().flatMap(p => (p.segments || []).filter(s => !s.superseded));
  const topicValue = (projectId, topic) => topic ? JSON.stringify([projectId, topic]) : 'unassigned';
  const number = n => n === null || n === undefined ? '—' : new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(n);
  const decimal = n => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(n);
  const money = n => n === null || n === undefined ? '—' : new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const duration = n => n === null || n === undefined ? '—' : n < 60000 ? `${Math.round(n / 1000)}s` : n < 3600000 ? `${Math.round(n / 60000)}m` : `${Math.floor(n / 3600000)}h ${Math.round(n % 3600000 / 60000)}m`;
  const date = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown';
  const sum = metric;
  function notice(message) { $('notice').hidden = !message; $('notice').textContent = message; }
  function badge(value) {
    const label = value || 'Unknown';
    return el('span', label, `status ${['done', 'passed'].includes(label) ? 'ok' : /fail|blocked|error/.test(label) ? 'bad' : /pending|awaiting|review|building/.test(label) ? 'pending' : ''}`);
  }
  function statistic(parent, title, value, note) { const block = el('div', undefined, 'summary-item'); block.append(el('span', title), el('strong', value)); if (note) block.append(el('small', note)); parent.append(block); }
  function table(parent, headings, numeric = []) {
    clear(parent); const node = el('table'); const tr = el('tr');
    headings.forEach((heading, index) => { const th = el('th', heading, numeric.includes(index) ? 'num' : undefined); th.scope = 'col'; tr.append(th); });
    const head = el('thead'); head.append(tr); const body = el('tbody'); node.append(head, body); parent.append(node); return body;
  }
  function empty(parent, heading, description, command) { clear(parent); const box = el('div', undefined, 'empty'); box.append(el('h3', heading), el('p', description)); if (command) box.append(el('code', command)); parent.append(box); }
  function cell(row, text, small, cls) { const td = el('td', text, cls); if (small) td.append(el('small', small)); row.append(td); return td; }
  function renderWork() {
    const selected = projects();
    const all = selected.flatMap(p => p.topics.map(t => ({ ...t, project: p.label, projectId: p.projectId })));
    const query = $('work-search').value.toLowerCase(); const topics = all.filter(t => `${t.path} ${t.project} ${t.status}`.toLowerCase().includes(query));
    clear($('work-summary'));
    const needsEvidence = topics.filter(t => ['awaiting verification', 'in review', 'verification failed'].includes(t.status)).length;
    statistic($('work-summary'), 'Topics', number(topics.length));
    statistic($('work-summary'), 'In progress', number(topics.filter(t => t.status === 'building').length));
    statistic($('work-summary'), 'Awaiting evidence', number(needsEvidence));
    statistic($('work-summary'), 'Recorded done', number(topics.filter(t => t.status === 'done').length));
    $('work-note').textContent = needsEvidence ? `${number(needsEvidence)} topic${needsEvidence === 1 ? '' : 's'} need${needsEvidence === 1 ? 's' : ''} verification or review.` : 'Recorded implementation, verification and review.';
    if (!topics.length) empty($('work-table'), all.length ? 'No matching work' : 'No recorded work yet', all.length ? 'Try a different search or project.' : 'Small inline changes do not need a plan just to appear here.', 'nectar doctor --json');
    else {
      const body = table($('work-table'), ['Work', 'State', 'Tasks', 'Verification', 'Evidence'], [2]);
      topics.forEach(t => {
        const row = el('tr'); const a = t.artifacts || {};
        const relative = t.path.replace(/^docs\/work\//, '');
        const title = relative.replace(/^\d{4}-\d{2}-\d{2}-/, '').replaceAll('-', ' ');
        const name = cell(row, title.charAt(0).toUpperCase() + title.slice(1), t.project, 'work-name'); name.title = relative;
        cell(row, undefined, undefined, 'work-state').append(badge(t.status));
        cell(row, a.checkedTasks === undefined ? '—' : `${number(a.checkedTasks)} / ${number(a.checkedTasks + a.uncheckedTasks)}`, 'implemented', 'num work-count');
        const verification = cell(row, a.verification || (t.kind === 'parent' ? 'Child topics' : 'Not recorded'), undefined, 'work-verification');
        verification.prepend(el('span', 'Verification: ', 'mobile-label'));
        const evidence = cell(row, undefined, undefined, 'work-evidence');
        const details = el('details', undefined, 'row-details'); details.append(el('summary', 'Details'));
        details.append(el('p', relative, 'artifact-path'));
        const list = el('div', undefined, 'links');
        Object.entries(t.links || {}).forEach(([name, href]) => { if (!href || !href.startsWith('file:///')) return; const link = el('a', name.charAt(0).toUpperCase() + name.slice(1)); link.href = href; list.append(link); });
        if (!list.childElementCount) list.append(el('span', 'No linked documents', 'muted'));
        details.append(list); if (t.dependencies?.length) details.append(el('p', `Depends on: ${t.dependencies.join(', ')}`));
        const associated = allSegments().filter(s => s.projectId === t.projectId && s.topic === t.path);
        const bindingKeys = projects().flatMap(p => p.bindings || []).filter(b => b.projectId === t.projectId && b.topic === t.path).map(b => b.sessionKey);
        const linked = new Set([...associated.map(s => s.sessionKey), ...bindingKeys]);
        if (linked.size) {
          const totals = summarizeAttribution(associated, { group: 'topic', allSegments: allSegments() })[0];
          const usage = el('button', `${number(linked.size)} linked session${linked.size === 1 ? '' : 's'}${totals?.cost.usd != null ? ` · ${money(totals.cost.usd)}${totals.partial ? ' partial' : ''}` : ' · cost unknown'}`, 'work-usage');
          usage.type = 'button'; usage.addEventListener('click', () => {
            $('topic-filter').value = topicValue(t.projectId, t.path); $('skill-filter').value = '';
            $('host').value = ''; $('model').value = ''; $('period').value = '0'; $('session-search').value = '';
            showView('usage'); $('attribution-table').focus();
          });
          evidence.append(usage);
        }
        evidence.append(details); body.append(row);
      });
    }
    clear($('diagnostics'));
    selected.forEach(p => {
      const messages = [...p.diagnostics.map(d => `${d.code || d.severity || 'Issue'}: ${d.message}${d.path ? ` (${d.path})` : ''}`), ...p.telemetryDiagnostics];
      if (!messages.length) return; const details = el('details', undefined, 'data-note'); details.append(el('summary', `${p.label} · ${messages.length} diagnostic${messages.length === 1 ? '' : 's'}`)); const list = el('ul'); messages.forEach(m => list.append(el('li', m))); details.append(list); $('diagnostics').append(details);
    });
  }
  function baseSessions() {
    const host = $('host').value, model = $('model').value, query = $('session-search').value.toLowerCase(), days = Number($('period').value);
    const cutoff = Date.parse(data.generatedAt) - days * 86400000;
    return projects().flatMap(p => p.sessions.map(s => ({ ...s, label: p.label }))).filter(s =>
      (!host || s.host === host) && (!model || (s.models || []).includes(model) || s.model === model)
      && (!days || Date.parse(s.updatedAt) >= cutoff)
      && `${s.sessionId} ${s.label} ${s.topic || ''}`.toLowerCase().includes(query));
  }
  function matchingSegments() {
    const sessionKeys = new Set(baseSessions().map(s => s.key));
    const topic = $('topic-filter').value, skill = $('skill-filter').value;
    const days = Number($('period').value), cutoff = Date.parse(data.generatedAt) - days * 86400000;
    return allSegments().filter(s => sessionKeys.has(s.sessionKey)
      && (!days || Date.parse(s.endedAt) >= cutoff)
      && (!topic || topicValue(s.projectId, s.topic) === topic)
      && (!skill || (s.skill || 'unassigned') === skill));
  }
  function attributionFiltered() { return !!($('topic-filter').value || $('skill-filter').value); }
  function sessions() {
    const rows = baseSessions();
    if (!attributionFiltered()) return rows;
    const keys = new Set(matchingSegments().map(s => s.sessionKey));
    return rows.filter(s => keys.has(s.key));
  }
  function roots(rows) {
    return selectAggregateSessions(rows, projects().flatMap(p => p.sessions)).included;
  }
  function chart(rows) {
    clear($('chart')); const metric = $('chart-metric').value;
    const pick = s => metric === 'cost' ? s.cost?.usd : metric === 'tokens' ? s.usage?.total : s.activeMs === null || s.activeMs === undefined ? null : s.activeMs / 60000;
    const format = metric === 'cost' ? money : metric === 'time' ? value => `${decimal(value)} min` : number;
    const buckets = new Map(); rows.forEach(s => {
      const day = s.startedAt.slice(0, 10); if (!buckets.has(day)) buckets.set(day, []); buckets.get(day).push(pick(s));
    });
    for (const [day, values] of buckets) buckets.set(day, sum(values));
    const entries = [...buckets].sort(([a], [b]) => a.localeCompare(b));
    const measured = entries.filter(([, value]) => value.known);
    if (!measured.length) { empty($('chart'), 'No measurements for this chart', 'Unknown values are not plotted as zero.'); return; }
    // Tick selection and a separate label lane adapt tasteskill's assets/charts.js.
    const max = Math.max(...measured.map(([, value]) => value.value));
    const raw = (max || 1) / 4, magnitude = 10 ** Math.floor(Math.log10(raw));
    let step = [1, 2, 2.5, 5, 10].map(n => n * magnitude).find(n => n >= raw);
    if (metric === 'tokens') step = Math.max(1, Math.ceil(step));
    const top = (Math.floor(max / step) + 1) * step;
    const width = Math.max(260, $('chart').clientWidth || 600), height = width < 480 ? 180 : 194;
    const axisFormat = metric === 'cost' ? money : value => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
    const left = Math.max(44, axisFormat(top).length * 7 + 12), right = width - 12, bottom = height - 30;
    const dayMs = 86400000, first = Date.parse(`${entries[0][0]}T00:00:00Z`), last = Date.parse(`${entries.at(-1)[0]}T00:00:00Z`);
    const days = Math.round((last - first) / dayMs) + 1;
    const x = time => left + ((time - first) / dayMs + .5) / days * (right - left);
    const y = value => bottom - value / top * (bottom - 12);
    const node = (tag, attrs = {}, parent) => { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.entries(attrs).forEach(([key, value]) => n.setAttribute(key, String(value))); if (parent) parent.append(n); return n; };
    const text = (value, attrs, parent) => { const n = node('text', attrs, parent); n.textContent = value; return n; };
    const svg = node('svg', { viewBox: `0 0 ${width} ${height}`, class: 'bar-chart', role: 'img', 'aria-label': `${metric} by UTC session start date. Open chart data for exact values and coverage.` });
    for (let value = 0; value <= top + step / 2; value += step) {
      node('line', { x1: left, x2: right, y1: y(value), y2: y(value), class: 'chart-grid' }, svg);
      text(axisFormat(value), { x: left - 10, y: y(value) + 4, 'text-anchor': 'end' }, svg);
    }
    const barWidth = Math.max(.5, Math.min(28, (right - left) / days * .55));
    measured.forEach(([day, result]) => {
      const rect = node('rect', { x: x(Date.parse(`${day}T00:00:00Z`)) - barWidth / 2, y: y(result.value), width: barWidth, height: bottom - y(result.value) }, svg);
      node('title', {}, rect).textContent = `${day}: ${format(result.value)} · ${result.known}/${result.total} sessions measured`;
    });
    const dateStep = Math.max(1, Math.ceil(days / Math.max(2, Math.floor((right - left) / 90))));
    for (let day = 0; day < days; day += dateStep) {
      const time = first + day * dayMs;
      text(new Date(time).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }), { x: x(time), y: height - 8, 'text-anchor': 'middle' }, svg);
    }
    $('chart').append(svg);
    const details = el('details', undefined, 'data-note chart-data'); details.append(el('summary', `Chart data · ${entries.length} date${entries.length === 1 ? '' : 's'}`));
    const frame = el('div', undefined, 'table-scroll'); const body = table(frame, ['Start date · UTC', metric === 'cost' ? 'USD' : metric === 'tokens' ? 'Tokens' : 'Minutes', 'Measured sessions'], [1, 2]);
    entries.forEach(([day, result]) => { const row = el('tr'); cell(row, day); cell(row, result.known ? format(result.value) : '—', undefined, 'num'); cell(row, `${result.known} / ${result.total}`, undefined, 'num'); body.append(row); });
    details.append(frame); $('chart').append(details);
  }
  function renderUsage() {
    const rows = sessions(); const parentRows = roots(rows);
    const totals = summarizeSessions(rows, projects().flatMap(p => p.sessions));
    const { cost, tokens, activeMs: active } = totals;
    const segments = matchingSegments();
    const attributed = summarizeAttribution(segments, { group: $('attribution-group').value, allSegments: allSegments() });
    clear($('usage-summary'));
    const coverage = v => v.known ? `${v.known} / ${v.total} measured` : 'No measurements';
    statistic($('usage-summary'), 'Sessions', number(rows.length), 'Includes subagents');
    statistic($('usage-summary'), `Session cost${cost.partial ? ' · partial' : ''}`, money(cost.value), coverage(cost));
    statistic($('usage-summary'), `Session tokens${tokens.partial ? ' · partial' : ''}`, number(tokens.value), coverage(tokens));
    statistic($('usage-summary'), `Session time${active.partial ? ' · partial' : ''}`, duration(active.value), coverage(active));
    $('usage-note').textContent = `${totals.partial ? 'Partial measurement details' : 'Measurement details'} · ${totals.childRowsExcluded} overlapping child rows excluded`;
    $('collection-note').textContent = projects().every(p => !p.collectionEnabled) ? 'Live collection is off. Enable only when wanted with nectar telemetry enable.' : 'Live collection is enabled for supported host observations.';
    $('session-scope').textContent = attributionFiltered() ? 'Full totals of sessions matching the attribution filter; use the interval breakdown for work or skill cost.' : 'Full recorded session totals. Work and skill costs use the interval breakdown above.';
    $('attribution-note').textContent = 'Intervals ending in the selected period. Unassigned spend stays visible; later links do not relabel earlier work. Parent overlap is excluded when known or uncertain.';
    if (!attributed.length) empty($('attribution-table'), 'No matching attribution intervals', 'Link a session to recorded work before it begins. Unknown costs stay unknown.', 'nectar telemetry --help');
    else {
      const body = table($('attribution-table'), [$('attribution-group').value === 'topic' ? 'Work' : 'Skill', 'Sessions', 'Intervals', 'Cost · USD', 'Tokens'], [1, 2, 3, 4]);
      attributed.forEach(group => {
        const row = el('tr'); const project = projects().find(p => p.projectId === group.projectId);
        cell(row, group.label || 'Unassigned', project?.label);
        cell(row, number(group.sessionCount), undefined, 'num'); cell(row, number(group.segmentCount), undefined, 'num');
        cell(row, money(group.cost.usd), `${group.cost.known} / ${group.cost.total} priced${group.partial ? ' · partial' : ''}`, 'num');
        cell(row, number(group.usage.total), group.excludedChildren ? `${group.excludedChildren} overlapping child intervals excluded` : undefined, 'num');
        body.append(row);
      });
    }
    chart(parentRows); $('session-count').textContent = `${rows.length} matching sessions`;
    if (!rows.length) { empty($('session-table'), 'No matching sessions', 'Select another filter or explicitly enable collection / import a selected transcript.', 'nectar telemetry --help'); return; }
    const body = table($('session-table'), ['Session', 'Host / model', 'Cost · USD', 'Tokens', 'Time', 'Details'], [2, 3, 4]);
    rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).forEach(s => {
      const row = el('tr'); const first = cell(row, s.topic || s.sessionId, `${s.label} · ${date(s.startedAt)}`, 'session-name'); first.title = s.sessionId;
      cell(row, s.host, (s.models || []).join(', ') || s.model || 'Model unavailable');
      cell(row, money(s.cost?.usd), s.cost?.usd == null ? 'Unknown' : s.cost?.kind, 'num');
      cell(row, number(s.usage?.total), s.usage?.total == null ? 'Unknown' : undefined, 'num');
      cell(row, duration(s.activeMs), s.activeMs == null ? 'Unknown' : s.durationKind === 'turn-elapsed' ? 'Includes waits' : 'Host active', 'num');
      const last = cell(row); const details = el('details', undefined, 'row-details'); details.append(el('summary', `${s.partial ? 'Partial ' : ''}${s.source}`));
      const list = el('dl', undefined, 'session-facts');
      const facts = [['Session', s.sessionId], ['Parent', s.parentSessionId], ['Work', s.topic], ['Skill', s.skill], ['Attribution', s.attributionSource], ['Branch', s.git?.branch], ['Worktree', s.git?.worktree], ['Source revision', s.git?.head], ['Updated', date(s.updatedAt)], ['Scope', s.usageScope || 'unknown'], ['Cost source', s.cost?.source], ['Input tokens', number(s.usage?.input)], ['Output tokens', number(s.usage?.output)], ['Cache read', number(s.usage?.cacheRead)], ['Cache write', number(s.usage?.cacheWrite)], ['Wall time', duration(s.wallMs)], ['Timing', s.durationKind]];
      facts.filter(([, value]) => value !== null && value !== undefined).forEach(([name, value]) => list.append(el('dt', name), el('dd', value)));
      details.append(list);
      const observations = [...(s.evidence || []), ...(s.observations || [])];
      if (observations.length) { details.append(el('p', `${observations.length} recorded observations · not a verification verdict`)); const list = el('ul'); observations.forEach(o => list.append(el('li', `${o.toolName || o.kind || 'Observation'} · ${o.status || (o.exitCode == null ? 'outcome unknown' : `exit ${o.exitCode}`)} · ${date(o.recordedAt)}${o.sourceRevision ? ` · ${o.sourceRevision}` : ''}`))); details.append(list); }
      last.append(details);
      body.append(row);
    });
  }
  function render() { $('title').textContent = state.project ? projects()[0].label : 'All projects'; renderWork(); renderUsage(); }
  function showView(view) {
    state.view = view;
    for (const candidate of ['work', 'usage']) {
      $(candidate + '-view').hidden = candidate !== view;
      $(candidate + '-tab').setAttribute('aria-pressed', String(candidate === view));
    }
    if (view === 'usage') renderUsage();
  }
  function download(name, content, type) { const url = URL.createObjectURL(new Blob([content], { type })); const a = el('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  function publicRows() { return sessions().map(s => ({
    key: s.key, parentKey: s.parentKey, projectId: s.projectId, host: s.host,
    startedAt: s.startedAt, updatedAt: s.updatedAt, model: s.model, models: s.models,
    usage: s.usage, cost: s.cost, activeMs: s.activeMs, wallMs: s.wallMs, turns: s.turns,
    source: s.source, metricSource: s.metricSource, measurementScope: s.measurementScope,
    usageScope: s.usageScope, durationKind: s.durationKind, partial: s.partial,
  })); }
  const nav = $('projects');
  const projectMenu = document.querySelector('.project-menu');
  const narrow = window.matchMedia('(max-width:1100px)');
  projectMenu.open = !narrow.matches;
  narrow.addEventListener('change', event => { projectMenu.open = !event.matches; });
  [{ projectId: '', label: 'All projects', topics: data.projects.flatMap(p => p.topics) }, ...data.projects].forEach(p => { const b = el('button'); b.append(el('span', p.label), el('small', `${p.topics.length} topic${p.topics.length === 1 ? '' : 's'}`)); b.setAttribute('aria-pressed', String(p.projectId === state.project)); if (p.projectId) b.title = `Project ${p.projectId.slice(0, 12)}`; b.addEventListener('click', () => { state.project = p.projectId; nav.querySelectorAll('button').forEach(n => n.setAttribute('aria-pressed', String(n === b))); if (window.matchMedia('(max-width:1100px)').matches) projectMenu.open = false; render(); }); nav.append(b); });
  [...new Set(data.projects.flatMap(p => p.sessions.flatMap(s => s.models || (s.model ? [s.model] : []))))].sort().forEach(m => { const option = el('option', m); option.value = m; $('model').append(option); });
  const topicOptions = new Map(); const skillOptions = new Set();
  data.projects.forEach(p => {
    [...p.topics.map(t => ({ topic: t.path })), ...(p.segments || []), ...(p.bindings || [])].forEach(item => {
      if (item.topic) topicOptions.set(topicValue(p.projectId, item.topic), `${p.label} · ${item.topic.replace(/^docs\/work\//, '')}`);
      if (item.skill) skillOptions.add(item.skill);
    });
  });
  [...topicOptions].sort((a, b) => a[1].localeCompare(b[1])).forEach(([value, label]) => { const option = el('option', label); option.value = value; $('topic-filter').append(option); });
  [...skillOptions].sort().forEach(skill => { const option = el('option', skill); option.value = skill; $('skill-filter').append(option); });
  $('snapshot').textContent = `Snapshot ${date(data.generatedAt)} · ${data.projects.length} selected project${data.projects.length === 1 ? '' : 's'}`;
  for (const view of ['work', 'usage']) $(view + '-tab').addEventListener('click', () => showView(view));
  $('work-search').addEventListener('input', renderWork); $('session-search').addEventListener('input', renderUsage);
  ['host', 'model', 'period', 'chart-metric', 'topic-filter', 'skill-filter', 'attribution-group'].forEach(id => $(id).addEventListener('change', renderUsage));
  $('clear-attribution').addEventListener('click', () => { $('topic-filter').value = ''; $('skill-filter').value = ''; renderUsage(); });
  $('export-json').addEventListener('click', () => download('nectar-usage.json', JSON.stringify({ schemaVersion: 1, generatedAt: data.generatedAt, preview: !!data.preview,
    sessions: publicRows(), segments: matchingSegments().map(s => s.publicExport).filter(Boolean) }, null, 2), 'application/json'));
  function csv(rows) {
    const field = value => { let text = value === null || value === undefined ? '' : String(value); if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; };
    return rows.map(row => row.map(field).join(',')).join('\r\n');
  }
  $('export-csv').addEventListener('click', () => {
    const rows = publicRows().map(s => [s.projectId, s.host, s.key, s.parentKey, s.startedAt, s.cost?.usd, s.cost?.kind, s.usage?.total, s.activeMs, s.source]);
    download('nectar-usage.csv', csv([['project_id', 'host', 'session_key', 'parent_key', 'started_at', 'cost_usd', 'cost_kind', 'tokens', 'active_ms', 'source'], ...rows]), 'text/csv');
  });
  $('export-attribution').addEventListener('click', () => {
    const intervals = matchingSegments().map(s => s.publicExport).filter(Boolean);
    const rows = intervals.map(s => [s.projectId, s.host, s.sessionKey, s.topicKey, s.skill, s.startedAt, s.endedAt, s.cost?.usd, s.cost?.kind, s.usage?.total, s.activeMs, s.attributionSource, s.partial]);
    download('nectar-attribution.csv', csv([['project_id', 'host', 'session_key', 'work_key', 'skill', 'started_at', 'ended_at', 'cost_usd', 'cost_kind', 'tokens', 'active_ms', 'attribution_source', 'partial'], ...rows]), 'text/csv');
  });
  $('copy-command').addEventListener('click', async () => { const quote = value => `'${value.replaceAll("'", "'\\''")}'`; const command = `nectar board ${projects().map(p => `--project ${quote(p.projectRoot)}`).join(' ')} --open`; try { await navigator.clipboard.writeText(command); notice('Refresh command copied. Run it in your terminal to generate a new snapshot.'); } catch { notice(`Run in a POSIX shell: ${command}`); } });
  render();
  $('preview-label').hidden = !data.preview;
  let resizeFrame;
  window.addEventListener('resize', () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => { if (state.view === 'usage') chart(roots(sessions())); }); });
})();
