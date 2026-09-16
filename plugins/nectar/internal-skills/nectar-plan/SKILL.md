---
name: nectar-plan
description: Plan tasks, dependencies and final verification for a defined outcome.
---

# Plan

Use the [workflow contract](../../references/workflow.md). Plan the requested
outcome from the design, current code and known constraints. Small work needs only
a concise inline plan. For durable work, use the
[plan format](../../references/plan-format.md).

## Decompose by delivery

Each task names a coherent result and an observable acceptance condition. Include
expected write paths for coordination; keep them current as implementation reveals
necessary local changes. Do not split tasks just because the description contains
"and" or because a numerical quota has been reached.

There is no fixed maximum number of tasks, waves or tasks per wave. Choose the
smallest useful decomposition. Split into topics when outcomes, ownership, context
size or independent delivery justify it. Propose material scope changes before
performing them; routine scheduling and decomposition are implementation choices.

Waves describe dependencies. Tasks can run together when neither needs unfinished
output from the other and their writes will not conflict. Use explicit dependency
notes for less obvious relationships. A wave can contain many queued tasks while
only a few agents run at once, according to host capacity and coordination cost.

## Verification

Choose the meaningful final checks once for the deliverable. Use
[Test Value](../../references/test-value.md) for coverage decisions when needed.
The default is final verification after implementation; do not allocate repeated
full-suite runs to every task or wave. Name early checks only where their result
will decide or unblock dependent work.

Keep acceptance separate from evidence: a task checkbox records implementation,
and the plan's Verification section records whether the integrated result passed.

## Review and handoff

Check that the plan covers the outcome, dependencies are feasible, scope is
proportional and the evidence can observe success. Use one focused independent
review for uncertain or high-impact plans; no automatic review loop.

A request to plan stops here. A request to implement or an existing approval of
this outcome permits Build to continue. Reordering, regrouping or adding a
necessary local file does not restart approval. Resolve a genuinely new product
choice or consequential external action with the user before taking it.
