// Shared by the CLI and the embedded browser script; no filesystem or host state.
export function metric(values) {
  const known = values.filter(value => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  const value = known.length ? known.reduce((a, b) => a + b, 0) : null;
  return { value: Number.isFinite(value) ? value : null, known: known.length, total: values.length };
}

export function selectAggregateSessions(sessions, allSessions = sessions) {
  const key = s => `${s.projectId}:${s.host}:${s.sessionId}`;
  const all = new Map(allSessions.map(s => [key(s), s]));
  const selected = new Set(sessions.map(key));
  const included = [], excluded = [], reasons = new Set();
  for (const s of sessions) {
    const seen = new Set([key(s)]);
    let parentId = s.parentSessionId, omit = false;
    while (parentId) {
      const parentKey = `${s.projectId}:${s.host}:${parentId}`;
      if (seen.has(parentKey)) { reasons.add('cyclic-parent-link'); omit = true; break; }
      seen.add(parentKey);
      const parent = all.get(parentKey);
      if (!parent) { reasons.add('parent-not-in-snapshot'); break; }
      if (parent.usageScope !== 'session-only') {
        omit = true;
        if (parent.usageScope !== 'includes-children') reasons.add('unknown-parent-overlap');
        if (!selected.has(parentKey)) reasons.add('parent-outside-filter');
        break;
      }
      parentId = parent.parentSessionId;
    }
    (omit ? excluded : included).push(s);
  }
  return { included, excluded, partial: reasons.size > 0, reasons: [...reasons] };
}

export function summarizeSessions(sessions, allSessions = sessions) {
  const selected = selectAggregateSessions(sessions, allSessions);
  const rows = selected.included;
  const scopePartial = selected.partial || rows.some(s => s.partial || s.usageScope === 'unknown'
    || s.measurementScope === 'host-current-process');
  const total = values => { const result = metric(values); return { ...result, partial: scopePartial || result.known < result.total }; };
  return {
    sessions: sessions.length, parentSessions: rows.length,
    cost: total(rows.map(s => s.cost?.usd)), tokens: total(rows.map(s => s.usage?.total)),
    activeMs: total(rows.map(s => s.activeMs)), wallMs: total(rows.map(s => s.wallMs)),
    estimatedCosts: rows.filter(s => s.cost?.kind === 'estimated').length,
    childRowsExcluded: selected.excluded.length, partial: scopePartial, reasons: selected.reasons,
  };
}
