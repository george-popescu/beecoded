---
name: nectar-audit
description: Use for whole-codebase health checks — "audit this", pre-release sweeps, taking over an unfamiliar project. Selects lenses by codebase shape and produces a risk-classified report. Not for reviewing a specific change or diff (review) or chasing one known bug (debug).
---

# Audit

Audit the whole codebase as a point-in-time health snapshot. Audits inform and never mutate; the report is their only write.

## Project context

At entry, run `node "../../scripts/run-context.mjs" status "$PWD" --json`.
If context is stale or expired, Ask the user whether to refresh it with
`nectar-context`. If the user declines stale context, use it with a warning; if
the user declines expired context, omit it. Missing context is omitted without
blocking Audit. After that choice, Do not refresh again during this invocation.

Load only relevant `Architecture and entry points`, `Modules and relationships`,
and `Conventions` sections, then pass each lens only the evidence-linked
sections relevant to its assigned scope. Native `AGENTS.md` and `CLAUDE.md`
instructions always have higher priority than generated context.

## Test Value audit adapter

Read the [Test Value contract](../../references/test-value.md). For the test-health
lens, pass the contract and the exact frozen audit scope to native or fallback
Lens and Validator roles. Every coverage or existing-test candidate records
**Protected behavior**, **Credible failure**, **Impact**, **Unique existing
coverage**, **Owning layer**, **Implementation independence**, **Runtime class
and cost**, **Test decision**, and separate **Completion evidence**.

A coverage gap is confirmed only when the complete map supports
`ADD_PRODUCT_TEST`. Keep `TEST_OR_COVERAGE_GAP` and `TEST_DEFECT` as finding
classes and add one separate **Suite disposition** for existing tests: `KEEP`,
`REMOVE`, `CONSOLIDATE`, `MOVE`, or `REWRITE`. Apply it only inside the frozen
audit scope or an explicit suite-review/test-health scope. `KEEP` protects unique
valuable ownership; `REMOVE` requires no protected behavior or safely redundant
framework/label noise; `CONSOLIDATE` identifies duplicates; `MOVE` identifies a
valuable test at the wrong layer; `REWRITE` preserves valuable but stale, flaky,
or implementation-coupled coverage. The disposition is a recommendation and
never authorizes Audit, Lens, or Validator to edit or delete tests; the report is
the only write.
