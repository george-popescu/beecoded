---
name: nectar-honey
description: Deliver an authorized outcome through planning, implementation, verification and review.
---

# Honey

Use the [workflow contract](../../references/workflow.md). Own the requested result
end to end. Determine completion from the user's outcome and acceptance criteria.

## Prepare

Inspect the affected area, resolve material uncertainties and choose a fitted
approach. Draft a proportional plan with final verification. For persisted work,
use the [plan format](../../references/plan-format.md).

If the user already asked for implementation or approved the proposed outcome,
continue. Present an unresolved product choice or material scope change for a
decision when needed. No mandatory second approval of exact file lists, digests,
task counts or a staged copy of the plan.

Use the source directly when generated context is unavailable or stale. Context
refresh and Atlas indexing are optional support operations, not prerequisites for
every delivery. Load [context guidance](../../references/context-use.md) when those
resources would actually help.

## Deliver

- Shape/Plan establish the outcome and useful dependency graph.
- Build executes it with freely sized tasks and waves. Delegate only where the
  independent work justifies the overhead.
- Track implemented tasks. Run selected verification at the end of the integrated
  deliverable; allow early focused checks only to resolve concrete uncertainty.
- Own the final review once Build returns implementation and verification evidence;
  do not ask Build to perform a separate final review. Reuse an already completed
  review of the same unchanged scope. Use additional expertise for actual risk, not
  a file-count threshold. A direct Review call classifies; Honey owns any repair.
- Fix confirmed in-scope defects, rerun affected evidence and review the repaired
  area. Reuse valid evidence and accepted decisions across handoffs.

Use the user's review limit when provided; otherwise allow up to three review
passes and stop early when clean. A new pass needs an unresolved defect or a repair
to assess. No repeated full review for wording, style or deferred observations.
If progress stalls without new evidence, report the specific blocker.

## Resume and finish

Resume authorized work from current artifacts and source after interruption.
A lost in-memory token does not revoke the user's authorization. An active legacy
plan can adopt the new format as part of the authorized continuation; preserve
its tasks, evidence and boundaries and mark final verification pending.

Report outcome, final verification, review findings and any real limitation.
Do not stop at the first implementation when the authorized result still needs
verification or repair. Commit, publication and deployment follow the user's
actual instructions. Accepted work may then use Close to archive its artifacts;
that operation keeps its own exact-state recovery checks.
