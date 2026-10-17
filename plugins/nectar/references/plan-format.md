# Persisted plans

Use `docs/work/YYYY-MM-DD-<slug>/` for new durable work. Keep a short `design.md`
with outcome, constraints, solution and acceptance criteria, and a `plan.md` with
tasks and final verification. Existing topic locations may stay in place.

## Slim plan format

```markdown
# Search — Plan

Workflow: nectar-slim-v1

## Scope
Rank the current search results; preserve the public response contract.

## Wave 1
- [ ] T1: Implement score ordering — done when: higher scores appear first.
  - files: `src/search.js`, `test/search.test.js`

## Wave 2
- [ ] T2: Connect the existing results view — done when: the page uses the ordering.
  - files: `src/SearchResults.js`

## Verification
Status: pending
Commands: node --test test/search.test.js; npm run build; inspect results in browser.
Evidence:
```

`Workflow: nectar-slim-v1` is a format identifier. Task IDs are unique positive
T-numbers. `[x]` means implemented, not tested. Partial waves are valid. Choose any
useful number of tasks or waves, and explain non-obvious dependencies. Record exact
actual create/modify paths in `- files:` for coordination and Close; update them
as authorized implementation evolves. They are not an immutable approval boundary.

The single `## Verification` section uses `Status: pending`, `passed` or `failed`.
Record the command/observation and observed result on its `Evidence:` line; details
may follow it. A passed result requires all tasks implemented and non-empty evidence.
Missing verification remains pending. Examples inside code fences are not state.

The implementation owner can update checkboxes directly. No approval-receipt tokens
are used, so token length does not limit task count. Practical artifact/context
limits still apply: split a genuinely large delivery into meaningful topics rather
than creating an unreadable file. Doctor bounds individual artifact reads to 256 KiB.

When explicitly reviewing a draft, distinguish PLAN_CORRECTNESS_DEFECT,
PLAN_COVERAGE_GAP, PLAN_DEPENDENCY_DEFECT, PLAN_VERIFICATION_GAP and PLAN_SCOPE_DEFECT.
Explain the evidence, credible consequence and proportional correction; these are
risks of following the plan, not current production CODE_DEFECT findings. A concise
`Plan blocking: N` summary is sufficient when a caller needs a planning gate.

When implementation changes affect required evidence, set Status back to pending
and identify the checks and review scope made stale. Keep unaffected evidence;
verify the repair and its dependencies instead of restarting every check. Once
required evidence is current, review the current change
and write `review.md` using [review format](review-format.md). Doctor/Close require
both final verification and a clean review before a slim topic is done.

## Project hierarchy

Use children only for independent outcomes or delivery boundaries. The parent
`design.md` lists them in dependency order:

```markdown
## Topics
1. `01-domain/` — define the rules; depends on: none
2. `02-ui/` — expose the flow; depends on: `01-domain/`
```

Prefixes remain contiguous and consistently padded. Dependencies use exact earlier
child paths. Each child owns its design/plan/review; the parent closes only when all
children are done. Preserve existing hierarchies when resuming.

## Older plans

Unversioned plans retain their legacy runtime interpretation. On an authorized
continuation, an active legacy plan may adopt the slim header and final Verification
section without resetting its tasks or evidence. Keep supported task IDs, convert
struck tasks into ordinary checked entries with their cancellation reason, set
verification pending and continue. Do not migrate completed history or reinterpret
an existing pending Close manifest.

The old approval-receipt helper remains packaged for explicitly retained 3.2
workflows. It is not required for new plans or normal resumption. User authorization
must still be established from the conversation; a stored approval marker alone
does not authorize a new task.
