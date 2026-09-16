---
name: nectar-audit
description: Audit whole-codebase health and report concrete risks and useful follow-up.
---

# Audit

Produce a point-in-time health report. Use the canonical audit methodology below;
the report is this workflow's only write.

Use relevant current source and any useful project context. If context is stale or
unavailable, inspect the needed code directly. Context refresh is not a prerequisite.

For test-health findings, use [Test Value](../../references/test-value.md). A concise
protected behavior, existing owner and recommended KEEP/REMOVE/CONSOLIDATE/MOVE/REWRITE
disposition suffice. Recommendations do not authorize edits. A request to fix an
accepted finding follows the user's authority and the ordinary delivery workflow.
