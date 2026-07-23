export function formatDoctorHuman(report) {
  const topicCount = report.topics.length;
  if (!report.diagnostics.length) {
    return `Nectar doctor: clean (${topicCount} ${topicCount === 1 ? 'topic' : 'topics'})`;
  }

  const lines = report.diagnostics.map((diagnostic) => {
    const evidence = diagnostic.evidence ? ` [${diagnostic.evidence}]` : '';
    return `ERROR ${diagnostic.code} ${diagnostic.path} — ${diagnostic.message}${evidence}`;
  });
  lines.push(
    `Nectar doctor: ${report.diagnostics.length} blocking ${report.diagnostics.length === 1 ? 'issue' : 'issues'} across ${topicCount} ${topicCount === 1 ? 'topic' : 'topics'}`,
  );
  return lines.join('\n');
}
