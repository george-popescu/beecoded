export function formatDoctorHuman(report) {
  const topicCount = report.topics.length;
  if (!report.diagnostics.length) {
    return `Nectar doctor: clean (${topicCount} ${topicCount === 1 ? 'topic' : 'topics'})`;
  }

  const lines = report.diagnostics.map((diagnostic) => {
    const evidence = diagnostic.evidence ? ` [${diagnostic.evidence}]` : '';
    return `${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${diagnostic.path} — ${diagnostic.message}${evidence}`;
  });
  const blocking = report.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
  const warnings = report.diagnostics.length - blocking;
  lines.push(
    `Nectar doctor: ${blocking} blocking ${blocking === 1 ? 'issue' : 'issues'}, ${warnings} ${warnings === 1 ? 'warning' : 'warnings'} across ${topicCount} ${topicCount === 1 ? 'topic' : 'topics'}`,
  );
  return lines.join('\n');
}
