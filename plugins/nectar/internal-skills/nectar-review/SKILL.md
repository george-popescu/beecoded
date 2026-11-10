---
name: nectar-review
description: Ordinary or quick review of a specific change for defects, regressions and coverage. Not a detailed or meticulous inspection (use nectar-burciu-inspection), unless nectar-review is explicitly requested.
---

# Review

<!-- Inspection method adapted from Ponytail Review, Copyright (c) 2026 DietrichGebert, MIT. -->
Attribution and license: [MIT notice](../../internal-skills/nectar-audit/LICENSE).

Review the named scope; otherwise uncommitted changes including new files, then
the last commit if clean. This is one read-only pass unless repairs are separately
authorized; small authorized fixes need no extra workflow.

Trace changed behavior through callers, callees, data writes and tests, including
unchanged consumers. Check correctness, security/data loss, actual load, meaningful
coverage, performance and unnecessary complexity against the agreed requirements.
Check dynamic consumers before calling code dead; name the existing replacement
when suggesting reuse. Respect justified boundaries, not hypothetical future needs.

Report only concrete triggers and consequences supported by current code and
guards. Check the proposed remedy as well: preserve contracts, retries and valid
existing behavior. Separate a proven contract violation from an unknown repair
mechanism: a resolved operation does not prove its required postcondition. Check
no-op/missing-target paths too. Unknown result fields can defer the exact fix,
not downgrade an evidenced false success; never invent a postcondition.
Distinguish runtime defects from coverage, documentation and maintenance concerns.
Missing information or a stylistic preference is not a demonstrated defect.

Reuse existing evidence. Run a focused diagnostic only to settle a real uncertainty
and within execution permission; no automatic suite rerun or second review pass.
Recommend tests that expose the risky behavior, not labels or already-covered
boilerplate. Read [Test Value](../../references/test-value.md) only for a substantial
test-design question. Use a bounded independent reviewer when impact or ambiguity
justifies it, not routinely.

## Report

Give the scope in a sentence, then numbered findings with file:line, concrete
problem/impact and smallest viable correction. Group by Must fix, Should fix and
Nice to have only where useful; omit empty groups. Confirmed medium-or-higher
runtime defects are blockers; keep non-code concerns separate. Missing required
acceptance still prevents delivery.

Finish with a bounded verdict and material Not checked limits. No findings is a
valid result: say what was checked and stop. Do not narrate discarded candidates,
repeat the contract or add a formal summary to an ordinary review. For source-only
requests, accept correct source without requiring a future test run; list unexecuted
checks only under Not checked. Report inline unless a file
is requested; writing a report alone does not make it a persisted Nectar topic.

Only for a persisted Nectar topic, read the [review format](../../references/review-format.md)
and write its `review.md` with scope, evidence and the canonical completion summary.
Do not mark delivery done before required verification passes. Put the verdict
before the summary and nothing after its clean marker. Close is separate.
