import crypto from 'node:crypto';

const VALID_HOSTS = new Set(['claude', 'codex']);
const VALID_STATUSES = new Set(['passed', 'failed', 'unavailable']);

export function redactExcludedValues(contract, value) {
  let redacted = String(value ?? '');
  for (const check of contract?.checks || []) {
    if (check.type !== 'responseExcludes' || !check.value) continue;
    const escaped = check.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    redacted = redacted.replace(new RegExp(escaped, 'gi'), '<redacted>');
  }
  return redacted;
}

export function actorResponseArtifacts(contract, response) {
  const actorResponse = redactExcludedValues(contract, response);
  return {
    actorResponse,
    actorResponseSha256: crypto.createHash('sha256').update(actorResponse).digest('hex'),
  };
}

export function normalizeResult({
  artifacts,
  host,
  caseId,
  passed,
  score,
  evidence,
  metadata,
  status = passed ? 'passed' : 'failed',
}) {
  const failures = [];
  if (!VALID_HOSTS.has(host)) failures.push('host must be claude or codex');
  if (typeof caseId !== 'string' || !caseId) failures.push('caseId must be a non-empty string');
  if (typeof passed !== 'boolean') failures.push('passed must be a boolean');
  if (typeof score !== 'number' || score < 0 || score > 1) failures.push('score must be between 0 and 1');
  if (!VALID_STATUSES.has(status)) failures.push('status must be passed, failed, or unavailable');
  if (status === 'passed' && !passed) failures.push('passed status requires passed=true');
  if (status !== 'passed' && passed) failures.push(`${status} status requires passed=false`);
  if (artifacts !== undefined) {
    if (!artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts)) {
      failures.push('artifacts must be an object');
    } else {
      if (typeof artifacts.actorResponse !== 'string' || !artifacts.actorResponse.trim()) {
        failures.push('artifacts.actorResponse must be a non-empty string');
      }
      if (!/^[a-f0-9]{64}$/.test(artifacts.actorResponseSha256 || '')) {
        failures.push('artifacts.actorResponseSha256 must be a SHA-256 hex digest');
      } else if (typeof artifacts.actorResponse === 'string'
        && crypto.createHash('sha256').update(artifacts.actorResponse).digest('hex')
          !== artifacts.actorResponseSha256) {
        failures.push('artifacts.actorResponseSha256 does not match actorResponse');
      }
    }
  }
  if (failures.length) throw new Error(failures.join('\n'));

  const normalizedEvidence = Array.isArray(evidence) ? evidence : [evidence];
  if (normalizedEvidence.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error('evidence must contain non-empty strings');
  }

  return {
    host,
    caseId,
    status,
    passed,
    score,
    evidence: normalizedEvidence,
    ...(artifacts === undefined ? {} : { artifacts }),
    ...(metadata === undefined ? {} : { metadata }),
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
