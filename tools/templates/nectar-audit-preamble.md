---
name: nectar-audit
description: Audit whole-repository or whole-codebase health when that broad scope is requested. For a bounded detailed inspection of selected code or documents, use nectar-burciu-inspection instead.
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

Judge scale and performance against evidenced data size, concurrency and deployment
shape; state consequential assumptions. For simplification, identify a concrete
maintenance cost and the smallest viable alternative, including the exact reusable
helper or component when one exists. Inspect configuration, registration and dynamic
consumers before declaring code unused. An abstraction or dependency is not a defect
merely because it has one consumer; preserve required contracts and safeguards.

Number actionable findings consistently and explain what fails or costs effort,
why it matters and the proportional correction in the user's language. Respect
justified limitations, but not ones that violate current requirements or safety.
Do not turn removed-line counts or a fixed finding limit into audit objectives.
