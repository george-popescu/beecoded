---
name: nectar-shape
description: Clarify a new feature or change and choose a solution before planning implementation.
---

# Shape

Use the [workflow contract](../../references/workflow.md). Establish the outcome,
acceptance criteria, relevant constraints and a technically fitted approach.

Read the affected entry points and useful existing work first. Check for a related
active topic before creating another. Use existing context only where it helps;
stale context can be replaced by current source inspection without pausing.

Ask only questions whose answers could materially change the outcome. Resolve
ordinary implementation choices from the repository and the user's instructions.
A clear request may need no questions.

For non-obvious changes, use [Solution Fit](../../references/solution-fit.md):
identify the current behavior or cause, compare meaningful alternatives, check
callers and choose a proportional solution. Use independent investigation when
its perspective adds confidence; no fixed agent count or mandatory candidate list.

Small work stays inline. For a feature that benefits from durable context, create
`docs/work/YYYY-MM-DD-<slug>/design.md` containing the problem, chosen approach,
acceptance criteria, important risks and exclusions. Keep evidence links close to
the decisions they support. Create a project hierarchy only for distinct outcomes
or ownership boundaries, never to satisfy a wave or task limit.

Shape is discovery/planning. If the request is only to discuss or plan, stop with
that result. If implementation was also requested and the outcome is settled,
continue to Plan/Build under that authority. Request a product decision only when
an unresolved choice materially changes the agreed outcome.
