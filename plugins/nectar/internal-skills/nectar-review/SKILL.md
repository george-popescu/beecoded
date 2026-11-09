---
name: nectar-review
description: Ordinary or quick review of a specific change for defects, regressions and coverage. Not a detailed or meticulous inspection (use nectar-burciu-inspection), unless nectar-review is explicitly requested.
---

# Review

Review the requested change. Use named files first, otherwise the relevant plan
and actual diff, including its new files. Resolve the scope once and inspect the
current source and meaningful evidence.

Compare the change with the requested outcome, acceptance criteria and agreed
exclusions. Report missing required behavior or unrequested expansion separately
from runtime defects; do not invent requirements. Trace changed contracts into
their consumers and relevant callees, including unchanged code outside the diff.
Judge scale and performance against evidenced load and deployment assumptions.

This is one read-only review pass. Report findings; do not implement repairs unless
the user's broader delivery request separately authorizes them through Build/Honey.

Use the [review format](../../references/review-format.md) for classification and
the machine-readable completion summary. Select concerns by risk: correctness and
coverage normally matter; security, data, performance or UI expertise is useful
when those surfaces are affected. File count alone does not mandate agents.

Use independent reviewers where ambiguity or impact warrants them. Give each a
bounded question, relevant files and raw evidence. Validate actionable findings by
tracing the real caller and guards; use a fresh validator when independence adds
confidence. Do not invent findings or perform an automatic second full pass.

Reuse current test evidence. Run a focused diagnostic only to resolve a concrete
review uncertainty. Review does not rerun a passing suite solely for ownership of
the verdict. Use [Test Value](../../references/test-value.md) for test concerns;
do not demand new tests for labels, boilerplate or already covered behavior.

For a persisted slim topic, final verification must be passed before reporting
delivery as done. Write its `review.md` with the scope, evidence, findings and
completion summary. A review performed earlier can provide feedback, but the
topic remains awaiting implementation/verification as applicable.

For ad-hoc work, report inline. Keep the user-facing explanation proportional to
the findings; no formal risk dossier for a minor observation. Close remains a
separate accepted-work operation.
