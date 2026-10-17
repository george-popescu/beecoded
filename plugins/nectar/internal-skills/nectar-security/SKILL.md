---
name: nectar-security
description: Review a specified change or component for reachable security flaws when a focused security assessment is needed.
---

# Security

Review the requested diff or component and relevant callers. Keep source and
application state unchanged; report inline unless a saved report was requested.
This focused source review is not an automatic gate for ordinary delivery.

Trace affected trust boundaries: identity, authorization, tenant isolation,
untrusted input, secrets, data exposure and dependency changes. Inspect guards and
real callers before claiming exploitability. Use a relevant existing threat
model to prioritize assets and entry points, checking assumptions against current
source; do not require creating one for a focused review. Confirm advisories against
the installed version and an authoritative source. A scanner alert or dangerous
function alone does not establish a reachable vulnerability.

Reuse applicable [native evidence](../../references/host-capabilities.md). Run a
focused diagnostic only for concrete uncertainty, using disposable local fixtures
when execution is needed. Source review does not authorize external probing, live
exploits, scanner installation or a full pentest.

Give each actionable finding file/line evidence, a reachable trigger, bounded
impact, confidence and a proportional remedy. Separate confirmed flaws, unresolved
hypotheses and optional hardening. State inspected scope and material limitations;
zero findings does not certify security. Use [review format](../../references/review-format.md)
only when a persisted Nectar delivery needs its completion summary.

If fixes were requested too, hand confirmed in-scope defects to the delivery
workflow and verify the repaired boundary. Active pentesting needs separately
authorized targets and environment. Use an available specialized skill or tool
under that scope; Nectar does not bundle one or bypass provider limits.
