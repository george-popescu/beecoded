---
name: nectar-review
description: Use after implementation is complete, or whenever the user asks to review code — "review this", "review what we did", "check my changes" — covering a change, diff, or recent work. Runs evidence-backed multi-lens review with risk-aware convergence. Not for whole-codebase health sweeps (audit) or diagnosing a specific failure (debug).
---

# Review

Review the change at hand — never the whole codebase. Resolve the diff scope by precedence:

1. Files the user explicitly named.
2. The union of `- files:` lists from the resolved leaf topic directory's `plan.md` ticked, non-struck tasks. A dated parent with children is a container: review one child at a time.
3. Uncommitted work — staged, unstaged, and untracked.
4. Clean tree: commits on this branch since its merge-base with the main branch.

If none yields files, say there is nothing to review and stop. Otherwise state the resolved scope in one line and freeze it for this pass.

Run one single, read-only classification pass: lenses produce classified candidates → deduplicate → adversarially validate and reclassify → report. Useful non-code findings remain visible without masquerading as defects. Never edit reviewed files and never run a repair or fix loop; dispositions are recommendations to the caller, not actions owned by review.

## Project context

At entry, run `node "../../scripts/run-context.mjs" status "$PWD" --json`.
For stale context, Ask the user whether to refresh; if declined, retain it with
a warning. For expired context, ask to refresh and omit it if declined. Missing
context is omitted. Freeze one project-context snapshot after this choice and
never refresh or reread context files mid-run, including during validation.

Give each lens and validator only the evidence-linked sections relevant to its
scope, normally selected from `Architecture and entry points`, `Modules and
relationships`, and `Conventions`. Generated context guides navigation but is
not finding evidence. Native `AGENTS.md` and `CLAUDE.md` instructions always
have higher priority than generated context.

## Lens selection

- **≤3 files:** correctness + conventions, inline.
- **4–15 files:** add tests; add security when input, auth, or data paths are touched. Inline or agents.
- **16+ files:** correctness, conventions, tests, security, and performance; dispatch one `nectar:lens` role per lens in parallel.

Lens definitions:

- **correctness:** logic, reachable edge cases, error paths
- **conventions:** surrounding idioms, naming, simplicity, duplication, dead code, unjustified abstraction
- **security:** injection, authz, secrets, unsafe input
- **tests:** behavior coverage, stale tests, false-green tests, wrong-layer assertions
- **performance:** N+1 and unnecessary work in demonstrably live hot paths

Each lens receives only the frozen scope and its lens definition. Named Nectar agents use `nectar:lens`; on hosts without named agent types, load `../../agents/lens.md` as the general agent's role instructions. A lens reports findings only and never edits.

## Finding classes

- CODE_DEFECT — current production code can produce an incorrect, unsafe, unavailable, corrupt, or materially inefficient runtime outcome through a demonstrably live path.
- TEST_OR_COVERAGE_GAP — production behavior may be correct, but meaningful behavior is unverified, tested at the wrong layer, or false-green.
- TEST_DEFECT — a test is stale, flaky, misleading, over-specified, or asserts an implementation detail without proving a production defect.
- DOCUMENTATION_GAP — documentation or a declared contract disagrees with implemented behavior, without evidence that runtime code is wrong.
- MAINTAINABILITY — duplication, complexity, naming debt, or dead abstraction with no concrete current incorrect runtime outcome.
- STYLISTIC — a defensible preference with no objective defect.
- HARDENING_IDEA — defense-in-depth or resilience work whose triggering defect is absent, unreachable, or not demonstrated.

## Finding format

Every finding, from every lens, uses exactly this format:

```markdown
### [SEVERITY] <one-line title>
- **Class:** <CODE_DEFECT | TEST_OR_COVERAGE_GAP | TEST_DEFECT | DOCUMENTATION_GAP | MAINTAINABILITY | STYLISTIC | HARDENING_IDEA>
- **Where:** path/to/file.ext:line
- **Evidence:** <the actual code or reproduced behavior, quoted>
- **Runtime path:** <live entry point → affected gate/API → outcome, or NOT_APPLICABLE>
- **Reachability:** <REACHABLE | CONDITIONALLY_REACHABLE | UNREACHABLE | NOT_APPLICABLE> — <gating evidence>
- **Exposure/preconditions:** <specific caller, permissions, state, data, or provider behavior>
- **Likelihood:** <COMMON | OCCASIONAL | RARE | VERY_RARE | NOT_APPLICABLE> — <reasoning>
- **Exploitability:** <NOT_APPLICABLE | ACCIDENTAL_ONLY | OPPORTUNISTIC | DELIBERATE> — <use NOT_APPLICABLE with a reason for non-security findings>
- **Impact:** <credible bounded consequence, blast radius, duration, and recovery>
- **Solution opportunity:** <HIGH | MEDIUM | LOW> — <locality, complexity, regression risk, architectural fit, and whether approved or planned work will replace, delete, or own this path>
- **Confidence:** <HIGH | MEDIUM | LOW> — <evidence strength and remaining assumptions>
- **Convergence:** <BLOCKING | NON_BLOCKING>
- **Disposition:** <FIX_NOW | ASK_USER | DEFER | DISCARD>
- **Suggested fix:** <specific proportional change, or none>
```

Medium, High, and Critical findings, regardless of class, include every field in the format. Every finding always includes Exploitability; use `NOT_APPLICABLE` with a concise reason for non-security findings. Low findings may use a compact record, but still include Class, Reachability or applicability, Likelihood, Exploitability, Impact, Solution opportunity, Confidence, Convergence, and Disposition.

Solution opportunity explicitly accounts for approved or planned work that will replace, delete, or own the affected path. Work already scheduled to remove the path normally lowers the opportunity for an independent fix.

## Severity scale

- CRITICAL = a reachable, credible catastrophic outcome: material data loss or corruption, broad security compromise, or sustained outage of a primary path.
- HIGH = a reachable code defect with severe user, security, or operational impact and meaningful exposure, or likely broad incorrect behavior.
- MEDIUM = a reachable code defect with bounded impact, uncommon preconditions, recoverability, or limited blast radius.
- LOW = a minor bounded defect, very rare multi-condition failure, small inefficiency, or non-code engineering concern.

Severity is a risk conclusion, not the opening label. Derive it from credible impact, exposure, and likelihood; do not use confidence as likelihood or worst-case possibility as credible impact.

## Deduplicate

Merge candidates with the same file, line, root cause, and fix. Keep independent lens agreement as a confidence signal, but treat the highest claimed severity and strongest claimed class as provisional. Deduplication never upgrades a non-code concern into a code defect.

## Adversarial validation

For diffs beyond the ≤3-file tier, dispatch deduplicated groups by file to fresh `nectar:validator` roles in parallel. Small diffs may validate inline. On hosts without named agent types, load `../../agents/validator.md` as role instructions.

For every candidate:

1. Read the cited code and trace its real entry point and complete runtime path.
2. Check callers, guards, middleware, framework guarantees, and tests at the gating layer.
3. Verify all preconditions are simultaneously satisfiable.
4. Refute or reclassify the candidate before calibrating severity.
5. Separate likelihood, bounded impact, exploitability, solution opportunity, and confidence. Use `NOT_APPLICABLE` exploitability when no adversary is involved.
6. Reject suggested fixes whose complexity or scope is disproportionate to credible risk.
7. Check whether approved or planned work already replaces, deletes, or owns the affected path before rating Solution opportunity.

Verdicts:

- CONFIRMED — evidence verifies the adjusted class and its stated risk; this does not imply the class is a code defect or a convergence blocker.
- REFUTED — evidence or runtime wiring disproves the candidate; discard it.

Every verdict records the adjusted class and severity, Runtime path, Reachability, Exposure/preconditions, Likelihood, Exploitability, Impact, Solution opportunity, Confidence, convergence, disposition, and a note naming what was checked. A finding without quotable evidence is `REFUTED`. Evidence for a useful concern without a production defect becomes a confirmed non-code class. Re-examine the two weakest findings when an entire batch survives without any refutation, reclassification, or severity adjustment.

## Convergence policy

Only `CONFIRMED` `CODE_DEFECT` findings at `MEDIUM`, `HIGH`, or `CRITICAL` are `BLOCKING`. A `LOW` `CODE_DEFECT` is `NON_BLOCKING`; every non-code class is also `NON_BLOCKING`, regardless of hypothetical impact.

- A blocker with Solution opportunity `HIGH` or `MEDIUM` and a proportional, in-scope fix receives the caller recommendation `FIX_NOW`.
- A blocker with Solution opportunity `LOW`, an architectural rewrite, scope expansion, or planned replacement/deletion receives the caller recommendation `ASK_USER`.
- Non-blocking findings are `DEFER`, except `STYLISTIC` may be `ASK_USER`.
- Refuted candidates are `NON_BLOCKING + DISCARD`.

## Single-pass boundary

Review performs the classification pipeline exactly once and stops after reporting. It does not repair findings, modify production or test files, repeat itself, or decide whether the caller should request a later pass. `FIX_NOW`, `ASK_USER`, `DEFER`, and `DISCARD` communicate proportional next actions; the caller owns every follow-up.

## Report

Group validated findings first by Class and then by severity. Each record includes the complete adjusted risk record, verdict, validation note, convergence, disposition, and resolution. End every report with this parseable summary shape:

```text
Confirmed code defects: Critical N, High N, Medium N, Low N
Non-code findings: coverage N, test defects N, documentation N, maintainability N, hardening N
Blocking: N
Deferred: N
Stylistic: N
Refuted: N
Recommended caller action: <accept | repair blockers | ask user | optional follow-up>
```

Choose one recommended caller action from the validated dispositions: `accept` when no blockers remain, `repair blockers` for proportional `FIX_NOW` blockers, `ask user` for any `ASK_USER` blocker, or `optional follow-up` when only deferred non-blockers remain. The recommendation never executes the action.

When `Blocking: 0`, append this exact final line after every other report line: `Clean pass: zero blocking code defects remain.` Never emit that clean marker when Blocking is nonzero.

Feature/project work writes `review.md` in the resolved leaf topic and records the frozen scope, available verification evidence, and the summary. Writing that report is the only allowed mutation; reviewed production and test files remain untouched. Quick/trivial work reports inline. Never commit.
