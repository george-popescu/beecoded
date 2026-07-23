---
name: nectar-honey
description: Use when the user wants work delivered end-to-end autonomously — "drop the honey", "build X autonomously", "do it all and don't stop to ask" — running the full shape→plan→build→review lifecycle with exactly one confirmation up front. Confirms the destination in user-visible terms, then executes every step without pausing until the final report. Not for step-by-step collaboration (shape, plan, build, review individually), diagnosing a failure (debug), or parking an idea (capture).
---

# Honey

One confirmation, then the whole lifecycle. Understand the goal, confirm the destination, and run shape → plan → build → review without stopping. The user hears from you twice: once to confirm where this lands, and once when it has landed — built, reviewed, clean.

## Project context

At lifecycle entry, run
`node "../../scripts/run-context.mjs" status "$PWD" --json`. When context is
stale or expired, invoke `nectar-context` refresh automatically before Shape.
Do not ask the user; this refresh is part of the confirmed autonomous lifecycle.
Missing context is omitted. After entry, keep one frozen context snapshot and
Do not refresh again during the run, including between review passes.

Pass downstream skills and agents only the evidence-linked sections relevant to
their current step. Native `AGENTS.md` and `CLAUDE.md` instructions always have
higher priority than generated context.

## The contract

Honey trades mid-flight questions for one up-front agreement:

- The user confirms the **outcome** — what exists after the run, described in their terms.
- The plan-pass maximum defaults to three full plan classification passes. An explicit positive integer chosen by the user becomes the plan-pass maximum instead; one, two, and values greater than three are all valid choices.
- The default maximum is three full review passes. An explicit positive integer chosen by the user becomes the review-pass maximum instead; one, two, and values greater than three are all valid choices.
- Every micro-decision along the way is yours: take the recommended path, log it, never ask.
- The run stops early only at the hard stops below. Everything else waits for the final report.

Nothing about quality changes — each skill runs with its full discipline. Only the stops collapse.

## Outcome confirmation — the single stop

Before touching anything:

1. **Ground.** Read enough of the codebase to know what exists — shape's grounding rule. Read `docs/work/backlog.md` if it exists; a related entry gets folded into the outcome block now or not at all — its backlog line is deleted only after the user confirms the outcome.
2. **Detect scale** with shape's table. Trivial or quick: the confirmation is one or two sentences. Feature or project: the full block below.
3. **Present the destination in user-visible terms** — what the user will see, click, or run; never the implementation:

> **After this you'll have:**
> - <2–6 short sentences: screens, buttons, behaviors, commands, endpoints — as the user experiences them>
>
> **Decided for you:** <defaults chosen, one line each — only decisions that shape the outcome>
>
> **Not included:** <adjacent things this run will NOT build>
>
> Confirm and I run the whole lifecycle — design, plan, build, review — without stopping. The next thing you'll see is the final report.

Revise until the user confirms. Never start on silence. The confirmed block becomes design.md's acceptance criteria — the run is measured against it, point by point, at the end.

## Autonomous run

After the yes, execute the lifecycle with each skill's discipline intact; only the approval stops are replaced.

Scale decides the artifacts, and honey overrides shape's and plan's no-artifact rules in one direction only: a trivial- or quick-scale run writes no lifecycle artifacts — it follows build's inline discipline and the review-repair sequence, keeping in-session only its frozen delivery scope, completed pass count, and review-pass maximum. It is not resumable: an interruption restarts it from the confirmation. One exception survives an interrupted quick run: a debug hand-off may have written its persistence file, and that file resumes as a debug hunt, not as the honey run. A feature- or project-scale run writes the full artifact set:

- **Shape:** write design.md directly from the confirmed outcome — the confirmation replaces design approval. Add a `## Decisions` section whose first line is the mode marker, `Autonomous run confirmed YYYY-MM-DD.` — this line is how a later session knows the topic is a honey run from artifacts alone. Every choice made in flight lands below it with a one-line reason.
- **Plan:** decompose with the plan skill's checks and write plan.md in full even for few tasks. Before the first Plan self-review, record `completed plan-pass count: 0`, the resolved `plan-pass maximum`, and `Plan blocking: pending` in the topic's `## Decisions`. Then run the caller-owned plan-classification revision sequence below. Honey supplies plan approval only after the persisted result is `Plan blocking: 0`; Build never starts earlier.
- **Build:** waves, TDD, evidence-quoted closes — unchanged. Per-task commit suggestions and build's project-instructions command offer are deferred: keep them for the final report, ask nothing mid-run.
- **Review:** Honey owns the bounded review-repair sequence; direct review remains a single-pass, read-only classifier. Before the first pass, freeze the delivery scope from the confirmed outcome and the completed plan's non-struck task file lists. Record that exact scope, `completed review-pass count: 0`, and the resolved `review-pass maximum` in the topic's `## Decisions`; every later pass uses the same frozen delivery scope. The default maximum is three full review passes. Any explicit positive integer chosen by the user replaces that default as the review-pass maximum.
- **At project scale:** use the dated feature parent and Plan's approved hierarchy contract. The up-front Honey confirmation authorizes the recommended split, so materialize it without a second question and record the complete split, dependencies, and boundary rationale in the parent `## Decisions`. Repeatedly select the lowest-numbered dependency-ready child whose declared dependencies are `done`; each child gets its own design.md and plan → build → review cycle under the same confirmation. Independent dependency-ready children may run in parallel only when their plan file sets are disjoint. Every child design's `## Decisions` opens with the same mode marker, so Orient routes an interrupted child back to the run. Never close or clean up the parent until every child has a clean pass and aggregate status `done`. The final report covers every child and the parent outcome. A discovery inside one child that changes the confirmed project outcome is hard stop 1.
- A task failure routes through build's failure handling with one override: build's wait-for-go-ahead on an obvious fix is replaced — apply the fix through the TDD loop and log it in Decisions. When the cause is not obvious, continue into the debug skill autonomously, up to debug's own stop. Debug's commit suggestion is deferred like build's; its persistence file, if written, follows debug's own rule — deleted during the closing steps once the user accepts the commits, kept if they decline.

### Plan-classification revision sequence

1. Invoke one read-only, single Plan classification pass. After it returns, increment and persist the completed plan-pass count, preserve the plan-pass maximum, and record the exact `Plan blocking: N` result plus concise outstanding suggested revisions in `## Decisions`.
2. When the result is `Plan blocking: 0`, persist it and proceed to Build.
3. When `Plan blocking` is nonzero and at least one plan pass remains, revise the draft using only the classified suggested revisions and the confirmed outcome, then invoke the next read-only, single classification pass. If a revision would change the confirmed outcome, take hard stop 1 instead.
4. When `Plan blocking` is nonzero and the completed plan-pass count has reached the plan-pass maximum, take hard stop 3. Report the blockers and next action; never revise again, silently change the maximum, or enter Build.

Never advance to Build while `Plan blocking` is nonzero, pending, or absent. Plan owns each classification pass; Honey alone owns revision and repetition between passes.

### Review-repair sequence

1. Invoke one single-pass review against the frozen delivery scope. It classifies and reports only; after it returns, increment and persist Honey's completed review-pass count.
2. Stop successfully when the summary reports zero blocking code defects. Preserve non-blocking findings for the final report; they neither trigger repair nor consume another pass.
3. For `BLOCKING + ASK_USER`, an architectural rewrite, or scope-expanding work, take hard stop 1. Never enlarge the delivery scope to make a finding repairable.
4. For `BLOCKING + FIX_NOW`, repair the root cause through Build's TDD discipline only when at least one review pass remains to verify that repair. Run the affected verification, then invoke the next review pass as a single-pass review against the same frozen delivery scope.
5. Stop when the review-pass maximum is reached. Report remaining blockers and the recommended next action without editing again or silently changing the maximum. After pass one, newly observed blockers count only when they are caused by a Honey repair or are proven inside the frozen delivery scope; unrelated pre-existing work is deferred.

Honey alone owns this repetition. Direct review, lenses, validators, Plan, Orient, and other callers never inherit Honey's pass budget or repair authority.

If a feature- or project-scale run is interrupted — session end, crash, compaction — the artifacts are the checkpoint: orient sees the mode marker in design.md and proposes resuming the honey run; the user's acceptance of that proposal is the resume gate, so a deliberately abandoned run is never silently restarted. The confirmation itself is not re-asked — the confirmed criteria live in design.md. When plan.md exists but `Plan blocking: 0` is not persisted, resume the plan-classification revision sequence from the recorded completed plan-pass count and plan-pass maximum; never recompute or replenish the plan maximum, and never route to Build. When the plan-pass maximum is exhausted, resume only to report hard stop 3 with no fresh pass. Otherwise resume at the first unchecked build box or the review-repair sequence, as derived. Resume review from the recorded frozen delivery scope, completed review-pass count, and review-pass maximum; never recompute or replenish that maximum. A declined resume ends the autonomous contract: the skill that takes over interactively strikes the marker first (`~~Autonomous run confirmed ...~~ cancelled YYYY-MM-DD.`), and a struck marker never re-proposes the run.

## Hard stops

Only four things interrupt an autonomous run:

1. **The confirmed outcome cannot be delivered as stated** — a technical wall, or a discovery that changes what the user would get. Stop, explain in the same user-visible terms, and re-confirm the adjusted outcome. Never silently deliver something other than what was confirmed.
2. **Debug exhausts its evidence chain** — three dead hypothesis batches is debug's own stop, and it applies unchanged.
3. **The run stops converging** — Honey reaches its plan-pass or review-pass maximum with blockers remaining, or a third debug hand-off within one run shows that the ground is less stable than the confirmation assumed. Stop and report; the individual sequences are bounded, and this bounds their sum.
4. **Anything destructive or irreversible** — dropping data, force-pushing, deleting files the run did not create. These were never yours to decide alone.

## Final report and feedback

When review ends with `Clean pass: zero blocking code defects remain.`, report — do not just stop:

1. **Outcome check:** the confirmed block, point by point — delivered, or adjusted with the Decision entry that covers it.
2. **Evidence:** the quoted suite / lint / typecheck summary lines plus Honey's completed review-pass count and review-pass maximum.
3. **Deferred choices:** non-blocking findings, including stylistic choices, plus the ready-made commit message(s) and any deferred project-instructions command offer. If the user later chooses one, treat it as new scoped work; deferred non-blockers do not restart the completed review-repair sequence.
4. **Ask for feedback** — the user's acceptance closes the run, not silence.

Then close the topic:

- **Changelog entry** when the project keeps one — written for outside readers: what changed and why it matters to them, never referencing internal workflow artifacts. Propose a version bump per the project's own convention when the project versions.
- **Commits:** suggest the commit(s) covering the implementation plus the resolved dated parent or standalone legacy topic, so the design, plans, and review records survive in git history. For a split project, suggest deleting only the complete parent directory and only after every child is done; never delete completed children piecemeal while their parent is still active. `docs/work/` holds only live work, but the user may decline cleanup.
- **Backlog:** quote any `backlog.md` entries this delivery satisfied and suggest deleting those lines.

Never run `git commit`, `git tag`, or `git push` yourself — autonomy covers building, never shipping.

## Closing an already-finished topic

Invoked on a topic that is already done — orient hands these over, and review's post-clean-pass hand-off arrives here too — skip straight to the final report: verify plan.md is fully ticked and review.md ends with `Clean pass: zero blocking code defects remain.`, then run the report, changelog, commit, and cleanup steps above. A topic built interactively has no confirmed block; report against design.md's acceptance criteria instead.
