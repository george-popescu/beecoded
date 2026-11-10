---
name: nectar-audit
description: Audit whole-repository or whole-codebase health when that broad scope is requested. For a bounded detailed inspection of selected code or documents, use nectar-burciu-inspection instead.
license: MIT
---

# Audit

<!-- Adapted from ponytail-audit 5.3.3, Copyright (c) 2026 DietrichGebert.
MIT notice: [LICENSE](../../internal-skills/nectar-audit/LICENSE). Nectar adaptations retain report safety and summary compatibility. -->

Audit the repo like the senior developer who just inherited it and will be paged
when it breaks. Order of importance: correct, safe, holds under load, tested,
fast, lean. Every extra line must be read, tested and fixed later. Report the
useful findings in full, without repeating them in several sections.

## 1. Map first

- Audit what the user names: a folder, a package, or the whole repo.
  Nothing named: the whole repo.
- Read the README, deploy/build configuration, dependencies, entry points
  (routes, handlers, jobs, CLI commands) and tests.
- Find the expected load: one operator or many users and processes at once.
  Judge scale against that and state consequential assumptions.
- Trace the main flows end to end: input, stored state and output. Read paths
  involving user input, money, auth, data writes, jobs and shared state fully.
- Big repo: go deep where a mistake costs most, not file by file. Say what
  you did not inspect. Reuse relevant context; do not require a context refresh.

## 2. Look for

1. **Bug:** wrong result, crash, missed edge case (empty, zero, last item,
   rounding, time zones), callers that disagree with a return contract, or
   the same rule applied differently in two places.
2. **Risk:** security holes (injection, weak randomness, exposed secrets,
   missing input or permission checks), data loss (swallowed errors, writes
   in the wrong order, missing atomicity).
3. **Scale:** fine for one user, wrong for many: check-then-write races, work
   repeated by every process, growing memory, a query per item, quadratic
   work on large inputs, or per-process state that must be shared.
4. **Missing test:** risky logic (branches, parsers, money, security, data
   writes) without a test that fails when it breaks. One useful test, not
   a coverage target. Reuse existing evidence; no tests for labels or prose.
5. **Speed:** big slowdowns are problems. Small hot-path wins are suggestions;
   some software counts every millisecond. Use the actual workload.
6. **Lean:** code that should not exist or should be smaller.
   - delete: dead code, unused options, flags, configuration, speculative features;
   - reuse: helpers doing the same thing (name the existing replacement);
   - stdlib/native: the platform already does the job of a dependency or wrapper;
   - yagni: an interface, factory or forwarding wrapper with no useful responsibility;
   - merge: near-copies that must change together;
   - split: one function or class doing unrelated jobs. Split by responsibility,
     not by line count or into helpers that merely shorten a function.

## 3. Check before reporting

- Every defect needs a concrete case: this input or situation leads to this
  wrong result. Without one, keep uncertainty separate from confirmed findings.
- Trace real callers and guards. Before calling code unused, search the whole
  tree, including tests, fixtures, configuration and dynamic/string references.
- A documented shortcut with a justified limit is a decision, not a defect,
  unless actual load, requirements or safety already invalidate it. A single
  implementation is not itself evidence that an approved boundary is waste.
- Propose the smallest fix that works and preserves required contracts. Prefer
  deleting unnecessary code; do not add layers, frameworks or configuration
  the problem does not need. Confirm advisory applicability before reporting it.
- No style preferences disguised as defects, vague worries or finding quotas.
  Merge shared causes; do not repeat a full review merely to find more issues.

Inspect read-only. Do not execute application code without authority, install
dependencies, change Git or fix source. Diagnostics that write need a disposable
copy or an explicitly authorized environment. A request to audit is not a request
to repair, publish or deploy.

## 4. Output

Use short sentences and everyday words in the user's language. Explain an
unfamiliar technical term when it matters.

Start with **What this repo does:** two or three sentences and the assumed load.
Then group findings, most important first; skip empty groups:

- **Must fix:** confirmed bugs, security/data loss or failure at expected load.
- **Should fix:** meaningful coverage gaps, duplication, mixed responsibilities
  or other demonstrated maintenance cost.
- **Nice to have:** optional small speed-ups or simpler forms.

Number findings across all groups. Each finding has a file/line and four short
parts, one or two sentences each: **What this is**, **Problem**, **Fix** and
**If we skip it**. State uncertainty where it affects the claim or remedy.
Do not add separate chapters restating findings, rejected candidates or every
healthy subsystem.

End with **Verdict:** what to fix first, and **Not checked:** material coverage
and execution limits. If nothing is wrong, give the repo summary, **Healthy.
Nothing to fix within the inspected scope.**, and the limits; no empty findings
or long correctness essay.

Write the report to the requested path, otherwise `docs/work/audit-YYYY-MM-DD.md`.
It is the only project write. Check the destination and its ancestors for symlinks;
write only within the repository to a normal file, atomically when supported.
If safe writing cannot be established, report the blocker instead of writing.

For Nectar consumers, finish the report with this compact summary outside code
fences. Count defects by credible severity, not count of hypothetical outcomes.
Only confirmed MEDIUM-or-higher runtime code defects count as Blocking; other
observations are non-blocking. A source-only audit records absent execution evidence
under Not checked, not as a new acceptance gate.

```text
Confirmed code defects: Critical N, High N, Medium N, Low N
Non-code findings: coverage N, test defects N, documentation N, maintainability N, hardening N
Blocking: N
Deferred: N
Stylistic: N
Refuted: N
```

One-shot audit. No automatic repairs or workflow closure.

## Optional indexed context

Use [context guidance](../../references/context-use.md) when Atlas or generated
project context helps prioritize the audit. Check current source before issuing
a finding; an incomplete index is not complete audit coverage.
