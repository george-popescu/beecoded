---
name: code-audit
description: Use for whole-codebase health checks, pre-release sweeps, or taking over an unfamiliar repository. Produces an evidence-backed risk report without requiring Bee, Nectar, or project initialization. Not for reviewing one change, debugging one known failure, or UI/UX browser verification.
---

# Code Audit

Audit the whole codebase as a point-in-time health snapshot. The report is the only write. Do not change source, tests, configuration, dependencies, Git state, agent state, or workflow state, and never fix findings during the audit.

This skill is self-contained. Read native `AGENTS.md`, `CLAUDE.md`, and equivalent repository instructions that apply to the audited paths, but do not require or initialize Bee, Nectar, Atlas, or any other project state.

If the request is limited to a diff/change, one known failure, or rendered UI/UX, state that this whole-codebase audit is the wrong boundary and stop without writing a report.

## Scope and inspection

Resolve the requested repository and its native instructions. Survey entry points
and relevant configuration once, then prioritize exposed behavior and material
risk. Consider security, error handling, persistence, API contracts, performance,
UI state, architecture, dependencies, test health and cross-layer wiring where
applicable. State inspected scope and important coverage gaps; a bounded sample
does not establish whole-codebase safety.

Use read-only inspection. Diagnostics that create artifacts belong in a disposable
copy or an explicitly authorized diagnostic environment; otherwise record the
limitation. The audited repository's report remains the only permitted write.
Do not install dependencies or alter Git, source, configuration or workflow state.

Choose depth and delegation from risk, ambiguity and useful independent work.
File counts and finding counts do not mandate agents. When delegation helps, use
`code-audit:lens` or [lens instructions](../../agents/lens.md) with a bounded
concern and relevant evidence. Overlapping concerns share evidence rather than
repeat the repository survey. Current source, not a generated index, supports findings.

## Findings

Distinguish current defects from useful engineering observations:
- CODE_DEFECT: reachable incorrect, unsafe, unavailable or materially inefficient behavior.
- TEST_OR_COVERAGE_GAP: meaningful behavior lacks adequate evidence.
- TEST_DEFECT: misleading, stale, flaky or wrong-layer coverage.
- DOCUMENTATION_GAP: documentation disagrees with behavior.
- MAINTAINABILITY: demonstrated complexity without a current runtime defect.
- STYLISTIC: a preference.
- HARDENING_IDEA: extra protection without a demonstrated current failure.

For each useful finding, give severity, class, file/line, actual evidence, trigger
and bounded impact, and a proportional next action. Add exposure, exploitability,
uncertainty or alternatives when they affect the decision. Avoid empty risk fields
and speculative findings. Zero findings is valid.

Severity reflects credible impact and exposure: CRITICAL is catastrophic loss,
compromise or primary-path outage; HIGH is severe exposed harm; MEDIUM is bounded
actionable runtime risk; LOW is minor harm or a non-code concern. Confidence is
evidence strength, not likelihood. Only confirmed MEDIUM-or-higher CODE_DEFECT
findings are BLOCKING; other observations are NON_BLOCKING. Required acceptance
coverage can still remain incomplete independently of that defect count.

Validate actionable candidates against real callers, guards, framework guarantees
and simultaneously possible preconditions. Merge shared root causes. Reject or
reclassify claims the evidence does not support; do not manufacture refutations or
repeat reviews to hit a quota. A dependency advisory needs current installed or
lockfile version evidence and an authoritative advisory when network is available.

Use an independent `code-audit:validator` or [validator instructions](../../agents/validator.md)
when uncertainty or impact warrants another perspective. A validator reports
CONFIRMED or REFUTED with corrected class/severity and what it checked, without
edits. Preserve unresolved hypotheses as limitations rather than confirmed flaws.

## Report

Write to the requested path, otherwise `code-audit-YYYY-MM-DD.md`. Inspect the destination
and ancestors without following symlinks; keep writes within the repository and
refuse unsafe paths. Replace only a verified normal report file, using an atomic
write when supported. Stop and report the path if safe writing cannot be established.
The report is the only audited-project write.

Record scope and material limitations, findings ordered by risk, and useful next
actions. Distinguish findings from coverage gaps and optional improvements. End
with the stable summary needed by callers:

```text
Confirmed code defects: Critical N, High N, Medium N, Low N
Non-code findings: coverage N, test defects N, documentation N, maintainability N, hardening N
Blocking: N
Deferred: N
Stylistic: N
Refuted: N
```

A clean audit means zero blocking defects in inspected scope, not complete coverage
or zero observations. Hand findings to an authorized repair workflow. The audit
itself never fixes, commits, pushes, publishes or deploys.
