---
name: bee-insert-phase
description: "Use when the user explicitly invokes /bee-insert-phase on Claude Code or $bee-insert-phase on Codex, or asks for this Bee workflow: Insert a new phase between existing phases using decimal numbering"
---

# Bee Insert Phase

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/insert-phase.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-insert-phase` on Claude Code or `$bee-insert-phase` on Codex.
