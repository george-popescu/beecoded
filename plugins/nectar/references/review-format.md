# Review findings and completion

Use risk to prioritize findings. Distinguish observable incorrect behavior from
coverage, documentation and engineering concerns.

## Classes

- CODE_DEFECT: a reachable runtime outcome is incorrect, unsafe or materially inefficient.
- TEST_OR_COVERAGE_GAP: meaningful behavior lacks adequate evidence.
- TEST_DEFECT: misleading, flaky, redundant or wrong-layer coverage.
- DOCUMENTATION_GAP: documentation disagrees with the implementation.
- MAINTAINABILITY: demonstrated complexity or duplication without a current runtime defect.
- STYLISTIC: a preference with no objective defect.
- HARDENING_IDEA: an additional protection without a demonstrated current failure.

CRITICAL and HIGH mean credible severe impact with actual exposure. MEDIUM is a
bounded actionable runtime risk. LOW covers minor defects and non-code concerns.
Confidence is evidence strength; likelihood is how often the trigger occurs.

## Report a finding

Use a severity/title, class, file:line, observed evidence, trigger/impact and a
proportional recommendation. Add reachability, exploitability, uncertainty and
alternatives when they affect the decision. Avoid mechanically filling fields
that do not help assess the finding.

Validate candidates against current callers, guards and tests. CONFIRMED means the
evidence supports the adjusted class; REFUTED means discard it. Only confirmed
MEDIUM-or-higher CODE_DEFECT findings block completion. Missing useful coverage is
visible as its own class and may still be an explicit acceptance requirement.

FIX_NOW means an authorized proportional repair is appropriate; ASK_USER means a
material scope/product/authority decision is needed. DEFER records a non-blocking
follow-up; DISCARD records a refuted finding. A review recommendation does not
itself authorize a mutation.

## Persisted completion summary

For a topic review, record scope and actual evidence, then finish with:

```text
Confirmed code defects: Critical N, High N, Medium N, Low N
Non-code findings: coverage N, test defects N, documentation N, maintainability N, hardening N
Blocking: N
Deferred: N
Stylistic: N
Refuted: N
Recommended caller action: accept | repair blockers | ask user | optional follow-up
```

When Blocking is zero and the requested final evidence is complete, append exactly:

```text
Clean pass: zero blocking code defects remain.
```

These summary lines must be actual unfenced report content; the fences above only
illustrate the format. Do not claim completion with missing/failed verification.
For ad-hoc reviews, give concise findings and limitations inline. A whole-codebase
Audit may request its richer canonical finding record; follow that caller's format.
