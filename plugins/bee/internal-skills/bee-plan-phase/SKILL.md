---
name: bee-plan-phase
description: "Use when the user explicitly invokes /bee-plan-phase on Claude Code or $bee-plan-phase on Codex, or asks for this Bee workflow: Create a detailed execution plan for a spec phase with researched tasks and wave grouping"
---

# Bee Plan Phase

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/plan-phase.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-plan-phase` on Claude Code or `$bee-plan-phase` on Codex.
