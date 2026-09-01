---
name: nectar-honey
description: Use when the user wants work delivered end-to-end autonomously — "drop the honey", "build X autonomously", "do it all and don't stop to ask" — running investigation→fit→plan→build→review with one confirmation after the exact fitted plan exists. Not for step-by-step collaboration (shape, plan, build, review individually), diagnosing a failure (debug), or parking an idea (capture).
---

# Honey

One confirmation, then implementation. Honey first investigates read-only,
validates Solution Fit, drafts the exact plan, and brings its blocking count to
zero. The user then approves both the outcome and that plan revision; only then
may Honey persist artifacts and execute without mid-flight questions.

## Project context

At lifecycle entry, run
`node "../../scripts/run-context.mjs" status "$PWD" --json`. When context is
stale, use that snapshot with a warning during preflight; when it is expired or
missing, omit it. Do not refresh before confirmation because refresh writes
repository-local context state. After approval, at the mutation lifecycle entry
before Build, stale or expired context may refresh automatically.
Do not ask the user. Capture one frozen context snapshot, then Do not refresh again during the run,
including between review passes.

Pass downstream skills and agents only the evidence-linked sections relevant to
their current step. Native `AGENTS.md` and `CLAUDE.md` instructions always have
higher priority than generated context.

## The contract

Honey trades mid-flight questions for one informed agreement:

- The user confirms the **outcome and exact Plan revision** after investigation,
  Solution Fit, and plan classification are complete.
- The plan-pass maximum defaults to three full plan classification passes. An explicit positive integer chosen by the user becomes the plan-pass maximum instead; one, two, and values greater than three are all valid choices.
- The default maximum is three full review passes. An explicit positive integer chosen by the user becomes the review-pass maximum instead; one, two, and values greater than three are all valid choices.
- Every non-material micro-decision along the way is yours: take the recommended
  path and retain it in memory for the final report, never ask. Do not append it
  to an approved design or plan because that would change the receipt digest.
- The run stops early only at the hard stops below. Everything else waits for the final report.

Nothing about quality changes — each skill runs with its full discipline. Only the stops collapse.

## Read-only preflight and plan

Read the [Solution Fit contract](../../references/solution-fit.md) completely.
Read the [Test Value contract](../../references/test-value.md) completely. Every
changed behavior must have one approved coverage map, exact decision, and
separate completion evidence route before Honey asks for confirmation.
Use only the installer-rendered opaque launcher:

```text
APPROVAL_LAUNCHER = {{NECTAR_APPROVAL_LAUNCHER}}
```

Before asking for Honey's single confirmation:

1. Ground the request with Shape's duplicate/backlog checks and dispatch
   `nectar:investigator` for read-only investigation. No source, tests,
   configuration, dependencies, or repository instrumentation may change.
2. Write the candidate solution from confirmed evidence and dispatch a fresh
   investigator for independent validation. Only `Solution fit: FIT` proceeds.
3. Detect scale and draft the complete proportional plan. For feature/project
   work, draft the design, hierarchy, exact files, waves, tasks, one Test Value
   coverage map per behavior, evidence routes, and Plan revision in memory; do
   not materialize them yet. Trivial/quick plans keep the same maps inline.
4. Run the Plan-classification revision sequence below before confirmation.
   Revise between fresh single passes until `Plan blocking: 0` or the plan-pass
   maximum is exhausted. A nonzero result is hard stop 3, not an approvable plan.
5. For feature/project work, run `APPROVAL_LAUNCHER create-stage`. Retain its
   opaque `STAGE_TOKEN`; treat `displayPath` as data and use filesystem tools,
   never shell interpolation, to mirror the final `docs/work/` paths there. Stage the complete
   parent/child directory skeleton and the exact final bytes of every parent
   design, leaf design, and leaf plan, including every coverage map and evidence
   route before confirmation. The staged parent design and every staged
   leaf design use the same complete `## Investigation and fit` schema as Shape
   and Debug:

   ```markdown
   ## Investigation and fit
   - **Investigation scope:** <files, callers, API/version boundary>
   - **Confirmed current behavior:** <evidence-backed behavior or cause>
   - **Selected candidate:** <chosen solution and rejected alternatives>
   - **Evidence:** <current source, tests, and authoritative external evidence>
   - **Solution fit:** FIT
   - **Remaining uncertainty:** <non-material uncertainty or none>
   ```

   Include the final `## Decisions` marker
   `Autonomous run confirmed YYYY-MM-DD.` before hashing, plus frozen scope and
   final plan-pass state. Each leaf design, but not the project parent, also
   carries canonical `completed review-pass count: 0` and its frozen review-pass
   maximum. A leaf plan includes the prospective audit marker
   `Plan approval: APPROVED YYYY-MM-DD`; outside the repository this marker has
   no authority. Run `APPROVAL_LAUNCHER seal-stage <STAGE_TOKEN>` only after every
   final byte exists; retain the replacement sealed token and its exact manifest.
6. Run `APPROVAL_LAUNCHER stage-discover <SEALED_STAGE_TOKEN>`, then
   `APPROVAL_LAUNCHER stage-snapshot-token <SEALED_STAGE_TOKEN> <TOPIC_TOKEN>`
   once per emitted leaf to compute each staged digest. Keep one candidate
   `CURRENT_RUN` receipt packet per leaf. The complete project skeleton must exist
   before the first nested snapshot so hierarchy validation sees the exact final
   parent. These are candidate digests, not write authority until confirmation. No
   design, plan, mode marker, pass counter, `## Decisions` entry, source, test,
   configuration, dependency, context refresh, or repository instrumentation is
   persisted before confirmation.

## Outcome and plan confirmation

Present one approval block containing:

> **After this you'll have:** <the user-visible outcome and acceptance criteria>
>
> **Solution Fit:** `FIT` — <confirmed evidence boundary and remaining non-material uncertainty>
>
> **Plan revision N:** <wave count, task count, exact create/modify scope, and one line per task>
>
> **Approval digest(s):** <one digest per exact leaf, with the exact staged parent/design/plan surfaces>
>
> **Decided for you:** <material defaults and rejected alternatives>
>
> **Not included:** <explicit adjacent exclusions>
>
> Confirm and I will execute this outcome and Plan revision without another mid-flight approval unless material drift invalidates them.

The confirmation approves the displayed outcome, Plan revision N, exact staged
surfaces, and their digests. It promotes each candidate snapshot to that leaf's
in-memory `CURRENT_RUN` receipt. Never start on silence, an earlier request, or
approval of another revision. A change to the candidate, tasks, files, reads,
criteria, hierarchy, Decisions, or outcome requires a new fit, plan, staging
snapshot, and confirmation.

Present every leaf digest beside its exact plan and identify the exact staged
parent/design/plan paths that produced it.

## Autonomous run

After explicit confirmation, rerun `stage-discover` to require the exact sealed
manifest, then materialize every approved feature/project artifact from staging
as byte-equivalent final content using filesystem tools. Compare every live byte
to its staged source, run `APPROVAL_LAUNCHER discover` from the live project cwd,
then recompute every leaf with `snapshot-token`. Require the same digest, revision,
`derivedPaths`, task order and baseline, and review maximum before Build. A
post-confirmation mismatch must stop without any source, test, or configuration
edit; a persisted marker never substitutes for a receipt. After live verification,
run `APPROVAL_LAUNCHER dispose-stage <SEALED_STAGE_TOKEN>`. If the manifest has
drifted, retain and report the stage path; never recursively delete it anyway.
Then execute with each skill's discipline intact; only non-material
micro-decisions remain delegated.

Scale decides the artifacts, and honey overrides shape's and plan's no-artifact rules in one direction only: a trivial- or quick-scale run writes no lifecycle artifacts — it follows build's inline discipline and the review-repair sequence, keeping in-session only its frozen delivery scope, completed pass count, and review-pass maximum. It is not resumable: an interruption restarts it from the confirmation. One exception survives an interrupted quick run: a debug hand-off may have written its persistence file, and that file resumes as a debug hunt, not as the honey run. A feature- or project-scale run writes the full artifact set:

- **Shape:** materialize the staged `design.md` bytes containing the complete
  Investigation and fit schema and final `## Decisions` mode marker.
- **Plan:** materialize the staged plan bytes with `Solution fit: FIT`,
  `Plan revision: N`, the audit-only `Plan approval: APPROVED YYYY-MM-DD`, final
  completed plan-pass count, plan-pass maximum, and `Plan blocking: 0`. Any
  difference from staging invalidates approval before Build.
- **Build:** pass the leaf's full `CURRENT_RUN` receipt packet, opaque tokens,
  identical `APPROVAL_LAUNCHER`, derived paths, and the exact staged Test Value
  maps into Build. Native and fallback paths receive the same Test Value
  decisions and completion evidence routes. `ADD_PRODUCT_TEST` uses conditional
  red/green/refactor; `REUSE_EXISTING_TEST`, `NO_NEW_TEST`, and
  `ISOLATED_REHEARSAL` replay their approved evidence without invented tests.
  A valid task may report `zero new test files`. After a wave verifies
  green, `advance-task-token` atomically writes exactly the pending current-wave
  checkboxes and returns the replacement receipt and tokens; Honey
  never pre-edits progress. Per-task commit suggestions and Build's
  project-instructions command offer are deferred to the final report.
- **Review:** Honey owns the bounded review-repair sequence; direct review remains
  a single-pass, read-only classifier. The staged leaf design already freezes the
  delivery scope from the confirmed outcome and non-struck task `- files:`, with
  canonical `completed review-pass count: 0` and the resolved positive
  `review-pass maximum` in `## Decisions`; every pass uses that same frozen
  scope — the same frozen delivery scope for the entire review sequence. The
  default maximum is three full review passes. Any explicit positive
  integer chosen by the user replaces that default.
- **At project scale:** materialize only the hierarchy and child plans shown in
  the approved Plan revision. The confirmation approves that displayed split,
  dependencies, and access scopes. For every dependency-ready child, derive its
  write set as the union of task `- files:` and its read set as the union of
  optional task `- reads:`. Write/write and either direction of write/read
  intersection serialize in numeric plan order; read/read overlap may run in
  parallel. Never close the parent before every child has a clean pass.
- A task failure may be repaired autonomously only when the cause and repair stay
  inside the approved candidate, task, criteria, and file scope. Another cause,
  approach, file, criterion, or outcome is material drift and takes hard stop 1;
  Debug may investigate it read-only, but Honey cannot approve its replacement.

### Plan-classification revision sequence

Pre-confirmation plan-pass state stays in memory or staging only; the repository
has zero writes from this sequence. `## Decisions` is materialized only after
confirmation from the exact staged bytes.

1. Invoke one read-only, single Plan classification pass. After it returns,
   increment the completed plan-pass count in memory, preserve the plan-pass
   maximum, and retain the exact `Plan blocking: N` result plus concise
   outstanding suggested revisions in memory. Before confirmation, never persist
   plan-pass state or a `## Decisions` entry in the repository.
2. When the result is `Plan blocking: 0`, preserve the exact draft for the
   confirmation; after approval, persist it and proceed to Build.
3. When `Plan blocking` is nonzero and at least one plan pass remains, revise the draft using only the classified suggested revisions and the confirmed outcome, then invoke the next read-only, single classification pass. If a revision would change the confirmed outcome, take hard stop 1 instead.
4. When `Plan blocking` is nonzero and the completed plan-pass count has reached the plan-pass maximum, take hard stop 3. Report the blockers and next action; never revise again, silently change the maximum, or enter Build.

Never advance to Build while `Plan blocking` is nonzero, pending, or absent, or
while the zero-blocker Plan revision lacks explicit approval. Plan owns each
classification pass; Honey owns pre-confirmation revision and repetition.

### Review-repair sequence

1. Invoke one single-pass review against the frozen delivery scope. It classifies
   and reports only. After the single-pass review returns, call
   `APPROVAL_LAUNCHER advance-review-token <TOPIC_TOKEN> <RECEIPT_TOKEN>` exactly
   once; the helper prevalidates the
   frozen maximum, atomically increments the canonical completed review-pass
   count, verifies the bytes, and returns the replacement in-memory receipt.
   Never pre-edit the count or replace/replenish the maximum.
2. Stop successfully when the summary reports zero blocking code defects. Preserve non-blocking findings for the final report; they neither trigger repair nor consume another pass. A non-blocking Suite disposition is deferred evidence and never authorizes an autonomous edit, deletion, consolidation, move, or rewrite by Honey.
3. For `BLOCKING + ASK_USER`, an architectural rewrite, or scope-expanding work, take hard stop 1. Never enlarge the delivery scope to make a finding repairable.
4. For `BLOCKING + FIX_NOW` inside the approved solution, task, criteria, and
   file scope, repair through Build only when another review pass remains. An
   in-scope blocker with no review pass remaining takes hard stop 3 and reports
   review-budget exhaustion; no review pass remaining is not material drift.
   Hard stop 1 applies only to actual material drift in cause, outcome, criteria,
   files, or solution scope. After an in-scope repair, run the affected
   verification and the next single-pass review.
5. Stop when the review-pass maximum is reached. Report remaining blockers and the recommended next action without editing again or silently changing the maximum. After pass one, newly observed blockers count only when they are caused by a Honey repair or are proven inside the frozen delivery scope; unrelated pre-existing work is deferred.

After each single-pass review, a `BLOCKING + FIX_NOW` in-scope repair is
verified by the next review pass; Honey never treats the repair itself as the
terminal verdict.

Honey alone owns this repetition. Direct review, lenses, validators, Plan, Orient, and other callers never inherit Honey's pass budget or repair authority.

### Receipt progress invariants

Maintain one monotonic `CURRENT_RUN` receipt per leaf. Each project child owns
its own receipt, task progress, and review progress; never share progress between
leaves. `advance-task-token` consumes the helper-issued token for the exact verified
current wave and returns the replacement `CURRENT_RUN` receipt packet.
`advance-review-token`, after the single-pass review has completed, is called
exactly once and returns the replacement `CURRENT_RUN` receipt packet. The
review-pass maximum remains frozen.

Never directly or manually edit a task checkbox or completed review-pass count.
A skip, rewind, duplicate transition, partial wave, or maximum replacement must
reject or stop with the artifact bytes unchanged.

At project scale, every project child derives a write set from `- files:` and a
read set from `- reads:`. Any write/write or either-direction write/read conflict
must serialize in plan order; read/read overlap may remain parallel.

If an approved feature/project run is interrupted, artifacts are an audit
checkpoint but the in-memory receipt is gone. Resume Honey only after Orient
verifies the frozen delivery scope, `Solution fit: FIT`, approved Plan revision,
completed plan-pass count, plan-pass maximum, `Plan blocking: 0`, completed
review-pass count, and review-pass maximum, then recomputes and re-presents the
exact derived surfaces and digest for fresh approval. Never replenish either
maximum. Missing canonical investigation/candidate/FIT evidence routes to
Orient's `awaiting gate migration`; an already-fitted cross-session run routes
to `awaiting approval refresh`. Neither routes directly to Build. A declined
resume may strike the mode marker only through an explicitly approved follow-up
change and ends the autonomous contract.

A persisted approval or mode marker is audit data, not authority. Marker-only
resume must stop. A `CURRENT_RUN` receipt is in-memory and cannot persist or
resume across sessions. Cross-session recovery must re-present the exact parent,
design, and plan surfaces plus digest for fresh approval; that fresh approval
creates a new `CURRENT_RUN` receipt.

To resume the Honey plan, preserve completed plan-pass count and plan-pass
maximum and never replenish either budget; preserve the review budget the same
way.

## Hard stops

Only four things interrupt an autonomous run:

1. **Material drift invalidates the approved outcome or plan** — another cause,
   approach, file scope, criterion, split, or user-visible result. Stop before
   that change. A fresh investigation, Solution Fit, plan, and approval are
   required; Honey never silently re-confirms them itself.
2. **Debug exhausts its evidence chain** — three dead hypothesis batches is debug's own stop, and it applies unchanged.
3. **The run stops converging** — Honey reaches its plan-pass or review-pass maximum with blockers remaining, or a third debug hand-off within one run shows that the ground is less stable than the confirmation assumed. Stop and report; the individual sequences are bounded, and this bounds their sum.
4. **Anything destructive or irreversible** — dropping data, force-pushing, deleting files the run did not create. These were never yours to decide alone.

## Final report and feedback

When deterministic Close discovery reports the reviewed leaf `done`, report — do not just stop:

1. **Outcome check:** the confirmed block, point by point — delivered, or adjusted with the Decision entry that covers it.
2. **Evidence:** the quoted observed completion evidence route for every behavior,
   including `zero new test files`, plus selected suite/lint/typecheck/build/
   rehearsal summaries and Honey's completed review-pass count and maximum.
3. **Deferred choices:** non-blocking findings, including stylistic choices, plus the ready-made commit message(s) and any deferred project-instructions command offer. If the user later chooses one, treat it as new scoped work; deferred non-blockers do not restart the completed review-repair sequence.
4. **Ask for feedback** — the user's acceptance closes the run, not silence.

Then delegate the complete root to `nectar-close`. Honey does not maintain a
second changelog, backlog, commit-history, deletion, or archive protocol. Close
owns prepare, the user-created commit gate, finalize/recovery, Doctor, and
context refresh. Honey never commits, tags, pushes, publishes, or removes the
topic itself.

## Closing an already-finished topic

Invoked on a topic already reported `done` by deterministic Close discovery,
skip implementation and produce the outcome/evidence report, then delegate to
`nectar-close`. A topic built interactively has no confirmed Honey block; report
against design.md's acceptance criteria instead.
