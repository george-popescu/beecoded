---
name: nectar-orient
description: Use when returning to a project — "where were we", "what's next", "continue", any new session touching existing work in docs/work/, or right after a context compaction mid-session. Reconstructs status purely from artifacts and git, then proposes exactly one next action. Not for starting brand-new work (shape).
---

# Orient

Reconstruct where the work stands from artifacts and git alone, then propose exactly one next action. Orient reads, reports, and proposes — it never creates or edits a file, never ticks a box, never deletes anything, never commits. The single next action is a proposal for the user to accept or override, not something to execute unprompted.

## Project context

At entry, run `node "../../scripts/run-context.mjs" status "$PWD" --json`.
If context is stale or expired, Ask the user whether to refresh it with
`nectar-context`. If the user declines stale context, use it with a warning; if
the user declines expired context, omit it. Missing context is omitted without
blocking Orient. After that choice, Do not refresh again during this invocation.

Load only relevant `Architecture and entry points` and `Commands` sections when
they help explain the proposed next action. Project context never replaces the
artifact-derived topic status. Native `AGENTS.md` and `CLAUDE.md` instructions
always have higher priority than generated context.

## Scan

Read everything before concluding anything:

1. List `docs/work/` recursively to exactly two levels of topic directories:
   - dated feature roots: `YYYY-MM-DD-<feature-slug>/`
   - ordered children directly below them: `NN-<topic-slug>/`
   - legacy flat `docs/work/<topic>/` directories, which remain fully supported for existing work
   - each topic's `design.md`, `plan.md`, `review.md`, and any `debug-<slug>.md`
   - root `backlog.md`, the topicless `debug/` folder, and any root `audit-YYYY-MM-DD.md`
   Never treat a third-level topic directory as valid. Surface it as an unsupported hierarchy instead of silently recursing.
2. Run `git log --oneline -15` and `git status`.
3. Run `node "../../scripts/run-close.mjs" discover` and use its exact topic
   entries as the completion/status authority. Do not reproduce its review-tail
   parser in prose.

Artifacts and git are the only sources. Never trust memory of a past session — not a summary, not a recollection of "where we got to" — over what the files say now. A context-compaction summary is memory, not an artifact: after a compaction lands mid-work, re-run this scan before continuing, and let the files override anything the summary claims. If `docs/work/` does not exist or is empty, and `git status` is clean or shows only changes unrelated to any docs/work/ topic, say so plainly and suggest the shape skill for whatever the user wants to start; there is nothing to resume.

## Status derivation

First classify every directory as one of:

- **Direct leaf:** a dated feature root with no ordered child directories. Its `design.md`, `plan.md`, and `review.md` describe one feature directly.
- **Project parent:** a dated feature root whose `design.md` contains `## Topics` and which has ordered child directories. The parent is a container; never call it `designed, needs plan` merely because it has no parent-level `plan.md`.
- **Nested leaf:** an `NN-<topic-slug>/` directly below a project parent.
- **Legacy flat leaf:** an existing undated `docs/work/<topic>/` directory. Derive and report it exactly like a direct leaf; never require migration before resuming it.

Derive each leaf topic's status mechanically from its files. The rules, in the order to check them:

- Any `debug-<slug>.md` in the topic folder, or any file under `docs/work/debug/` → *open debug hunt*. Report its frontier line — the next test to run and what each outcome means — verbatim from the file. An open hunt outranks the topic's other statuses: a known-broken thing is resolved before anything else advances.
- design.md only, no plan.md → *designed, needs plan*.
- plan.md with unchecked `- [ ]` boxes and any missing canonical investigation,
  candidate, Evidence, `Solution fit: FIT`, or current Plan revision/approval
  field — including unchecked legacy work missing `Solution fit: FIT` or
  `Plan approval: APPROVED YYYY-MM-DD` — → *awaiting gate migration*. This is a
  technical-fit migration, not simple reapproval.
- plan.md with unchecked boxes, complete canonical Investigation and fit,
  `Solution fit: FIT`, but a missing Test Value map, decision, or completion
  evidence route → *awaiting plan migration*. Preserve the fitted technical
  solution, add the records in a new Plan revision, present it, and obtain
  explicit approval. When the technical solution is unchanged, this requires no
  fresh Investigation or Solution Fit.
- plan.md with unchecked boxes, the complete canonical Investigation and fit
  schema, `Solution fit: FIT`, and a structurally valid fitted plan, but no
  approved in-memory receipt from this uninterrupted run → *awaiting approval
  refresh*. A persisted `PENDING` or `APPROVED` marker changes audit history,
  not this status. After fresh approval, Build resumes *building, wave N of M*,
  where N is the first wave containing an unchecked box and M is the total.
- plan.md exists and all boxes are ticked, and deterministic Close discovery reports `in review` → *in review*. Confirmed non-blocking findings may remain without preventing completion; a missing report also stays in review.
- plan.md exists and all boxes are ticked, and deterministic Close discovery reports `legacy-needing-adjudication` → *legacy-needing-adjudication*. It is neither done nor safe to clean until a user adjudicates the historical evidence.
- plan.md exists and all boxes are ticked, and deterministic Close discovery reports `done` → *done*. The helper's shared completion parser is the only completion authority.
- Anything else — an empty folder, a review.md with no plan.md, files outside the convention, any combination the workflow cannot produce → no status. Name what is there and ask the user.

Completed work does not require a retrofitted gate: all-checked plans continue
to `in review` or `done` under the review rules above. State each topic's status
using exactly these names — they are the shared vocabulary across sessions.

## Fit migration and approval refresh

Read the [Test Value contract](../../references/test-value.md). An approved
`NO_NEW_TEST` decision is valid building work after receipt approval; do not
invent or demand a test file. Preserve every completion evidence route and any
explicit suite-review scope or frozen review scope when resuming.

Use only the installer-rendered opaque launcher:

```text
APPROVAL_LAUNCHER = {{NECTAR_APPROVAL_LAUNCHER}}
```

For every unfinished plan, choose exactly one recovery branch before proposing
Build:

1. **True legacy or incomplete gate:** when any canonical Investigation and fit
   field is missing, return through read-only Investigation, compare candidates,
   obtain a fresh independent `FIT`, write a new Plan revision, present it, and
   obtain explicit approval. Status is `awaiting gate migration`. Reusing the old
   candidate or merely changing its approval marker is forbidden.
2. **Fitted but missing Test Value:** keep the confirmed technical solution,
   write a new Plan revision with complete behavior maps and evidence routes,
   present it, and obtain explicit approval. Status is `awaiting plan migration`;
   this is not a new technical cause and needs no fresh Investigation while the
   solution is unchanged.
3. **Already fitted, pre-digest, or cross-session:** from the project cwd run
   `APPROVAL_LAUNCHER discover`, select only the current helper-emitted token for
   the untrusted display path, then run
   `APPROVAL_LAUNCHER snapshot-token <TOPIC_TOKEN>` read-only. Re-present the exact
   derived parent/design/plan surfaces and digest and request fresh approval. Do not
   increment the Plan revision when content is unchanged. Fresh approval creates
   a new in-memory `CURRENT_RUN` receipt with digest, revision, derived paths,
   ordered/completed task baseline, completed review-pass count, and frozen
   review-pass maximum. Status is `awaiting approval refresh` until that happens.
4. **Completed:** an all-checked plan continues to review/done classification
   without any receipt or gate retrofit.

In explicit migration terms: an active legacy plan missing the canonical
`Investigation and fit` schema requires full migration through Investigation,
candidate comparison, a fresh independent `FIT`, a new Plan revision,
presentation, and approval. An already-fitted pre-digest plan and an ordinary
cross-session plan use digest re-presentation and fresh approval on the same Plan
revision. Already-fitted work needs no new investigation unless material drift
is discovered. Completed all-checked or done work needs no gate, receipt, or
approval retrofit.

If the snapshot helper rejects hierarchy, paths, UTF-8, gate structure, tasks,
or canonical review state, surface the exact structural discrepancy as the one
next action. Do not guess a digest or downgrade it to reapproval. A marker-only
resume must stop; `Plan approval` and Honey mode markers are audit/routing data,
never authority. A context-compaction summary or prior session cannot carry a
`CURRENT_RUN` receipt into a new run.

A partially completed ordinary wave or completed ordinary task in a future-wave
baseline is a structural discrepancy, never an approval-refresh case. Ordinary
completed waves must form one whole-wave prefix. Struck tasks remain recorded as
completed audit history but do not move the runnable ordinary-task frontier.

Before proposing Build, rediscover and recompute through `snapshot-token`; then
cross-session recovery must re-present the exact parent, design, and plan
surfaces plus digest for fresh approval. Fresh approval creates a new
`CURRENT_RUN` receipt. A persisted approval or mode marker is audit data, not
authority, and marker-only recovery must stop. `CURRENT_RUN` is in-memory and
cannot persist or resume across sessions.

Never place a display path, project root, topic, or installed helper path into
shell source. Tokens are transport data, not authority; raw path flags and
noncanonical or non-current tokens are structural discrepancies.

## Parent validation and aggregation

For every project parent, parse its `## Topics` list and compare it to the filesystem before choosing work:

1. Every child directory matches `NN-<topic-slug>/` with two-digit padding.
2. Numeric prefixes are unique and contiguous from `01`; gaps, duplicates, or mixed padding are invalid.
3. The `## Topics` paths and filesystem child paths are the same ordered list. A missing directory, stale unlisted child, or order mismatch is invalid.
4. Every entry declares `depends on: none` or a comma-separated list of individually backticked exact sibling paths from the same list. Every dependency points only to an earlier-numbered child; unknown, forward, self, and circular references are invalid.
5. A child with a checked plan task, review artifact, or debug hunt while any declared dependency is not `done` is inconsistent progress, not runnable work.

Any invalid parent has no actionable status. Report the concrete mismatch and make resolving it the single next action; never guess numbering or dependencies.

**Aggregate parent status:** after validation, derive every child status, then derive the parent:

- `done` only when every child is `done`.
- Otherwise use the highest-priority active child status: `open debug hunt`
  beats `in review` beats `awaiting gate migration` beats `awaiting plan
  migration` beats `awaiting approval
  refresh` beats `building` beats `designed, needs plan`.
- Append the selected child's path to make the source explicit, for example: `checkout-rebuild — building via 02-checkout-api`.

Display the whole group compactly in numeric order:

```text
checkout-rebuild — building via 02-checkout-api
├── 01-payment-domain — done
├── 02-checkout-api — building, wave 2/3; depends on: 01-payment-domain
└── 03-checkout-ui — designed, needs plan; blocked by: 02-checkout-api
```

A child is dependency-ready only when all its declared dependencies are done. When selecting the next action within a valid parent, consider only children whose declared dependencies are done, then apply the normal status priority and numeric order. A future child may be displayed as blocked, but never proposed for planning or building early.

## Cross-check

The cross-check runs for every direct, nested, and legacy flat leaf in addition to whichever status rule matched — it never changes the derived status, it annotates it. Checkboxes are trusted by default — build only ticks verified work — so the cross-check exists to catch external edits, not to re-verify every task.

- A ticked task whose `- files:` paths show no related change in git history → say so explicitly: "T3 is ticked but I see no commit or change touching `src/auth/session.ts`." Before flagging, check the specific files with `git log --oneline -- <path>` — absence from the 15-commit scan is not evidence of absence; older commits count. Exception: a struck task (`- [x] ~~...~~ struck: <reason>`) is expected to have no matching history — it was removed, not built; not a mismatch.
- Any commit or uncommitted change touching a `- files:` path while its task's box is unticked → same, in reverse.
- design.md present, and `git status` shows uncommitted changes that diverge from what the design describes → flag the discrepancy and ask, instead of guessing which is current.

Report the mismatch as a fact and let the user decide which is true. Do not untick, tick, or "repair" anything — orient has no write access to reality, only a description of it.

## Propose

Propose exactly ONE next action. Name it concretely, name the skill that does it, and give a one-line reason:

> Wave 2 of payments: T4 and T5 can run in parallel — build skill. Reason: wave 1 is fully ticked and the suite was green at the last commit.

Not a menu, not "you could either…", not a ranked list of options. One action. The mapping from status to action:

- *open debug hunt* → resume the hunt from its frontier — debug skill.
- *designed, needs plan* → plan the topic — plan skill.
- *awaiting gate migration* → run read-only Investigation, Solution Fit, Plan
  revision, and explicit approval; never propose Build while fit or approval is
  missing.
- *awaiting plan migration* → preserve the fitted technical solution, add the
  missing Test Value records in a new Plan revision, and obtain explicit
  approval.
- *awaiting approval refresh* → re-present the exact derived surfaces and digest
  and obtain fresh approval; keep the fitted revision unchanged unless the
  content changes.
- *building, wave N of M* → execute wave N (name its unticked tasks) — build skill.
- *in review* → when no report exists, run one single-pass review — review skill. When a report exists, propose its one recommended caller action instead; Orient never repeats review or repairs findings itself.
- *done* → close the complete root through `nectar-close`; if other active topics outrank it, the next action still comes from them instead.
- *legacy-needing-adjudication* → adjudicate the historical review evidence; never route it to Close as complete.
- Flagged discrepancy (design vs. working tree, a cross-check mismatch, or a no-status folder) → resolving that ambiguity IS the next action; nothing else is safe to propose on top of it.

**Autonomous runs:** an unstruck `Autonomous run confirmed ...` marker routes a
structurally valid run back to Honey but grants no write authority. Before
proposing Build, require the frozen scope, complete canonical fit,
`Solution fit: FIT`, current Plan revision, `Plan blocking: 0`, and fresh
digest approval that creates a `CURRENT_RUN` receipt. Never propose Build with
missing approval, never replenish Honey's plan/review maximum, and never treat
the resume request or marker as approval of a revision. Missing canonical fit
state remains `awaiting gate migration`; fitted cross-session state is
`awaiting approval refresh`. A declined resume can strike the mode marker only
through a separately approved edit and returns the topic to interactive routing.

To resume Honey, preserve its frozen delivery scope, completed plan-pass count,
plan-pass maximum, completed review-pass count, and review-pass maximum; never
replenish either budget. Re-present those exact surfaces and the helper digest
for fresh approval, then pass the new receipt to Honey. Never propose Build
before `Plan blocking: 0` and receipt approval are both present.

To resume Honey's plan, preserve completed plan-pass count and plan-pass maximum;
never replenish them or the corresponding review budget.

If multiple parents or standalone leaves are open, first discard structurally
blocked children. Priority is *open debug hunt*, *in review*, *awaiting gate
migration*, *awaiting plan migration*, *awaiting approval refresh*, *building*, then *designed, needs
plan*. Within one parent, numeric order breaks ties; across roots, lexical path
order does. A discrepancy preempts normal work.

## Backlog and audit surfacing

If `docs/work/backlog.md` exists, mention its entry count in one line. If any `audit-YYYY-MM-DD.md` exists at the docs/work root, mention the date of the newest one. Do not act on either — no surfacing of individual entries, no re-running audits; the backlog belongs to shape, the report speaks for itself.
