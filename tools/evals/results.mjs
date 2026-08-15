const VALID_HOSTS = new Set(['claude', 'codex']);
const VALID_STATUSES = new Set(['passed', 'failed', 'unavailable']);

export function normalizeResult({
  product,
  host,
  caseId,
  passed,
  score,
  evidence,
  status = passed ? 'passed' : 'failed',
}) {
  const failures = [];
  if (typeof product !== 'string' || !product) failures.push('product must be a non-empty string');
  if (!VALID_HOSTS.has(host)) failures.push('host must be claude or codex');
  if (typeof caseId !== 'string' || !caseId) failures.push('caseId must be a non-empty string');
  if (typeof passed !== 'boolean') failures.push('passed must be a boolean');
  if (typeof score !== 'number' || score < 0 || score > 1) failures.push('score must be between 0 and 1');
  if (!VALID_STATUSES.has(status)) failures.push('status must be passed, failed, or unavailable');
  if (status === 'passed' && !passed) failures.push('passed status requires passed=true');
  if (status !== 'passed' && passed) failures.push(`${status} status requires passed=false`);
  if (failures.length) throw new Error(failures.join('\n'));

  const normalizedEvidence = Array.isArray(evidence) ? evidence : [evidence];
  if (normalizedEvidence.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error('evidence must contain non-empty strings');
  }

  return {
    product,
    host,
    caseId,
    status,
    passed,
    score,
    evidence: normalizedEvidence,
  };
}

export function aggregateResults(results) {
  const passed = results.filter((result) => result.status === 'passed').length;
  const failed = results.filter((result) => result.status === 'failed').length;
  const unavailable = results.filter((result) => result.status === 'unavailable').length;
  const scored = results.filter((result) => result.status !== 'unavailable');
  const score = scored.length
    ? scored.reduce((sum, result) => sum + result.score, 0) / scored.length
    : 0;

  return {
    passed,
    failed,
    unavailable,
    total: results.length,
    score,
    results,
  };
}
