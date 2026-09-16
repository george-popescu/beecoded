---
name: nectar-build
description: Implement an authorized change or plan, then verify the integrated result.
---

# Build

Use the [workflow contract](../../references/workflow.md). Implement the agreed
outcome and acceptance criteria using existing repository conventions. Read the
current code needed for each change; reuse relevant helpers and current evidence.

## Execute

For a persisted plan, use the [plan format](../../references/plan-format.md).
Resume from implementation progress and actual files. The new workflow needs no
approval receipts, per-wave tokens or staged duplicate plans.

Choose task and wave size freely. Respect dependencies and avoid concurrent writes
to the same files. Group related work when that saves context and coordination.
Delegate independent work when useful; use [implementer](../../agents/implementer.md)
with the outcome, task scope, relevant context and acceptance criteria. A task
does not need its own agent, and task count is separate from concurrent worker count.

Update the plan when implementation reveals a better local breakdown, a necessary
file or a more appropriate verification command inside the agreed outcome.
Escalate changed outcomes, material external effects or unresolved product choices.
Do not restart investigation and approval solely because a file was not predicted.

Mark a task implemented when its change is present. Partially implemented waves
are valid. Keep final verification pending until the integrated work is checked.

## Verify once the deliverable is implemented

Run the selected tests, lint, typecheck, build and/or rendered checks appropriate
to the change. [Test Value](../../references/test-value.md) guides test selection;
writing tests and choosing when to run them are separate decisions.

An early focused test is useful when it reproduces a bug, verifies an uncertain
contract or prevents building dependent work on a false assumption. Explain that
reason briefly. Do not run the full suite just because a wave ended.

Use an observed subagent result when the command, working directory, scope and
relevant inputs match the current state. Inspect evidence instead of replaying it
automatically. Rerun when relevant code/environment changed, evidence is missing,
a failure appeared or integration introduces a new concern.

Fix failures caused by this work, rerun affected checks and update the final
Verification status/evidence. Broaden testing only when justified by changed
dependencies or unresolved risk. Repeated failure without new evidence calls for
a focused investigation, not blind retries or an automatic new approval ceremony.

## Finish

When Build is standalone, own a proportional final review of the integrated change.
When Honey coordinates delivery, return implementation and verification evidence to
Honey; it owns the final review, so do not start another review here. A review-request-only
workflow remains read-only. Fix authorized defects and verify the repair; preserve
non-blocking observations without extending the work.

Report the delivered outcome, meaningful evidence and remaining limitations.
A coherent commit can be proposed at delivery; do not suggest one after every task.
Use Close only for accepted completed work and its separate archive operation.
