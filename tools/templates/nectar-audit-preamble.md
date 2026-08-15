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
