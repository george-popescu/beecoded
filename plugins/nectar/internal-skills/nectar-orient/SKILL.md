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
- plan.md with unticked `- [ ]` boxes → *building, wave N of M*, where N is the first wave containing an unticked box and M is the total wave count.
- plan.md exists and all boxes are ticked, and review.md still reports blocking code defects, or review.md does not end with `Clean pass: zero blocking code defects remain.` → *in review*. Confirmed non-blocking findings may remain without preventing completion.
- plan.md exists and all boxes are ticked, and review.md ends with `Clean pass: zero blocking code defects remain.` → *done*. This exact canonical clean marker is the only review completion marker Orient treats as done. plan.md fully ticked with no review.md at all means the review pass has not happened: that is *in review* too — the review skill still owes a clean pass.
- Anything else — an empty folder, a review.md with no plan.md, files outside the convention, any combination the workflow cannot produce → no status. Name what is there and ask the user.

State each topic's status using exactly these names — they are the shared vocabulary across sessions.

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
- Otherwise use the highest-priority active child status: `open debug hunt` beats `in review` beats `building` beats `designed, needs plan`.
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
- *building, wave N of M* → execute wave N (name its unticked tasks) — build skill.
- *in review* → when no report exists, run one single-pass review — review skill. When a report exists, propose its one recommended caller action instead; Orient never repeats review or repairs findings itself.
- *done* → close the topic — honey skill's closing steps (changelog, final commits, folder cleanup); if other topics are open, the next action comes from them instead.
- Flagged discrepancy (design vs. working tree, a cross-check mismatch, or a no-status folder) → resolving that ambiguity IS the next action; nothing else is safe to propose on top of it.

**Autonomous runs:** a topic whose design.md `## Decisions` section opens with an unstruck honey mode marker (`Autonomous run confirmed ...`) is a honey run. Whatever its derived status, the proposed action is to resume the honey run at that status's step — honey skill, not build or review directly. Before proposing a building step, inspect Honey's plan control record: unless exact `Plan blocking: 0` is persisted, resume Honey's plan-classification revision sequence with its recorded completed plan-pass count and plan-pass maximum. Never propose Build before `Plan blocking: 0`, never grant a fresh plan pass, and when the maximum is exhausted propose Honey's recorded hard-stop report rather than another classification. In review, say explicitly to resume Honey with its recorded frozen delivery scope, completed review-pass count, and review-pass maximum; Honey restores that control record without granting a fresh pass. A flagged discrepancy or no-status folder preempts this proposal exactly as it preempts the interactive mapping: resolving the ambiguity is the next action. The user's acceptance of the proposal is the resume gate: a declined proposal ends the run's autonomous contract — the skill that takes over interactively strikes the marker first (`~~...~~ cancelled YYYY-MM-DD.`; orient itself never edits files), and the topic continues under the interactive mapping above.

If multiple parents or standalone leaves are open, first discard structurally blocked children from the actionable set. Pick among dependency-ready children, direct leaves, legacy flat leaves, and topicless debug hunts by priority: *open debug hunt* beats *in review* beats *building* beats *designed, needs plan*. Within one parent, numeric child order breaks ties. Across separate roots, the lexically earliest path breaks ties so the choice is deterministic. A flagged structural or cross-check discrepancy preempts normal work. Say why in one line. Every other open root gets one aggregate or leaf status line; children stay grouped beneath their parent.

## Backlog and audit surfacing

If `docs/work/backlog.md` exists, mention its entry count in one line. If any `audit-YYYY-MM-DD.md` exists at the docs/work root, mention the date of the newest one. Do not act on either — no surfacing of individual entries, no re-running audits; the backlog belongs to shape, the report speaks for itself.
