---
name: code-audit
description: Use for whole-codebase health checks, pre-release sweeps, or taking over an unfamiliar repository. Produces an evidence-backed risk report without requiring Bee, Nectar, or project initialization. Not for reviewing one change, debugging one known failure, or UI/UX browser verification.
---

# Code Audit

Audit the whole codebase as a point-in-time health snapshot. The report is the only write. Do not change source, tests, configuration, dependencies, Git state, agent state, or workflow state, and never fix findings during the audit.

This skill is self-contained. Read native `AGENTS.md`, `CLAUDE.md`, and equivalent repository instructions that apply to the audited paths, but do not require or initialize Bee, Nectar, Atlas, or any other project state.

If the request is limited to a diff/change, one known failure, or rendered UI/UX, state that this whole-codebase audit is the wrong boundary and stop without writing a report.

## Audit boundary and repository survey

Resolve the actual repository root and instructions before selecting lenses. Inventory tracked source, manifests, entry points, routes, jobs, migrations, schemas, tests, build and deployment configuration, and generated-code boundaries. Trace framework registration and dynamic loading; grep alone never proves code is dead or reachable.

Use read-only inspection by default. Do not fetch, install, migrate, seed, build, format, or run commands that can create caches or artifacts. Explicit authorization for additional diagnostics never expands the report-only write boundary. Run a diagnostic only when it is demonstrably artifact-free inside the audited repository; otherwise run it in a disposable copy outside the repository or omit it and record the limitation.

Survey entry points once. Give every lens an exact, non-overlapping scope and only the native instructions or evidence-linked context relevant to that scope. Generated context may guide navigation but is never finding evidence.

## Lens library

- **security:** OWASP categories, authentication, authorization, secrets, unsafe input, and trust boundaries
- **error handling:** unhandled failure paths, swallowed exceptions, unsafe fallback, and recovery behavior
- **database:** query shape, N+1 behavior, indexes, migrations, constraints, transactions, and persistence drift
- **API:** input validation, response/error contracts, versioning, authorization, and integration boundaries
- **performance:** demonstrably live hot paths, repeated work, caching, memory, query count, and bundle cost
- **frontend:** loading, empty, error, concurrency, state ownership, data exposure, and code-level accessibility
- **architecture:** module boundaries, dependency direction, duplication, lifecycle ownership, and reachable dead paths
- **dependencies:** known advisories from available lockfile evidence, runtime support, abandonment, and supply-chain surface
- **test health:** missing behavioral coverage, false-green tests, stale fixtures, wrong-layer assertions, and flakiness
- **integration:** cross-layer wiring, events, jobs, routes, policies, callbacks, dynamic imports, and unreachable UI or APIs

Select lenses from codebase shape. Always include security and error handling. Drop frontend, database, API, or other lenses only when the surveyed repository lacks that surface, and record every drop with its evidence. More than two selected lenses or more than 50 tracked source files means one parallel `code-audit:lens` role per lens. Otherwise run lenses inline. On hosts without named roles, load `../../agents/lens.md` as the general agent's role instructions.

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

A dependency advisory requires current lockfile/package evidence and an authoritative advisory source when network access is available. Only confirmed CODE_DEFECT findings at MEDIUM, HIGH, or CRITICAL are BLOCKING. Low code defects and every non-code class are NON_BLOCKING.

## Deduplication and adversarial validation

Merge candidates with the same file, line, root cause, and proportional fix. Agreement between lenses raises confidence but never upgrades a non-code class into a code defect.

Validate every candidate adversarially. Read the cited code, trace the real entry point and complete runtime path, inspect callers, guards, middleware, framework guarantees, configuration, and gating tests, and verify that all preconditions are simultaneously satisfiable. Try to refute or reclassify before calibrating risk. Reject fixes whose complexity is disproportionate to credible risk.

For more than eight candidates, group by file or module and dispatch fresh parallel `code-audit:validator` roles. Otherwise validate inline. On hosts without named roles, load `../../agents/validator.md`. Validators report verdicts only and never edit.

Verdicts:

- CONFIRMED — evidence verifies the adjusted class and its stated risk; this does not imply the class is a code defect or a convergence blocker.
- REFUTED — evidence or runtime wiring disproves the candidate; discard it.

Every verdict records the adjusted class and severity, Runtime path, Reachability, Exposure/preconditions, Likelihood, Exploitability, Impact, Solution opportunity, Confidence, convergence, disposition, and a note naming what was checked. A finding without quotable evidence is `REFUTED`. Evidence for a useful concern without a production defect becomes a confirmed non-code class. Re-examine the two weakest findings when an entire batch survives without any refutation, reclassification, or severity adjustment.

## Report contract

Write the report to a path explicitly requested by the user, otherwise `code-audit-YYYY-MM-DD.md`. Before writing, verify with no-follow filesystem inspection that the destination remains inside the repository, every existing ancestor from the repository root is a normal directory, and the destination is absent or a normal file. If the report path or any existing ancestor is a symbolic link, the destination escapes the repository, or the destination is another entry type, stop without writing and report the blocked path to the user. Re-check immediately before replacement and use a normal temporary file in the verified destination directory plus atomic rename when the host supports it; if the host cannot guarantee a no-follow write, stop without writing. A later audit targeting the same default date replaces only that verified normal report. The report is the only write: do not edit source, tests, configuration, dependencies, Git state, Bee/Nectar state, or any other project artifact.

The report contains:

1. Repository boundary, point-in-time limitations, and the exact report path.
2. Lens manifest with the reason and evidence for every selected or dropped lens.
3. Validated findings grouped first by Class and then by severity.
4. Validation kill rate and reclassification count.
5. Top three follow-up opportunities ordered by credible risk, then Solution opportunity.
6. The exact parseable summary:

```text
Confirmed code defects: Critical N, High N, Medium N, Low N
Non-code findings: coverage N, test defects N, documentation N, maintainability N, hardening N
Blocking: N
Deferred: N
Stylistic: N
Refuted: N
```

Clean audit means zero blocking code defects, not zero observations. Offer blocking defects for a separate debugging or delivery workflow and retain non-blockers as optional follow-up. Never apply fixes, commit, push, publish, or deploy during the audit.
