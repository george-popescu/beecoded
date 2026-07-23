---
name: bee-audit
description: "Use when the user explicitly invokes /bee-audit on Claude Code or $bee-audit on Codex, or asks for this Bee workflow: Run a comprehensive code audit with specialized agents -- security, errors, database, architecture, API, frontend, performance, testing, integration wiring, and end-to-end bug detection"
---

# Bee Audit

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/audit.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-audit` on Claude Code or `$bee-audit` on Codex.
