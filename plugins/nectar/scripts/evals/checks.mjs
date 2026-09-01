import { evaluateCheck } from './codex.mjs';

export function evaluateContractChecks({ contract, response, root }) {
  const checks = contract.checks.map((check) => evaluateCheck(
    check,
    String(response || ''),
    root,
    contract.fixture.files,
  ));
  const passed = checks.filter((check) => check.passed).length;
  return {
    checks,
    evidence: checks.map((check) => check.evidence),
    score: checks.length ? passed / checks.length : 0,
  };
}
