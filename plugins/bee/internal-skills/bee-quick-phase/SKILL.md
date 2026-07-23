---
name: bee-quick-phase
description: "Use when the user explicitly invokes /bee-quick-phase on Claude Code or $bee-quick-phase on Codex, or asks for this Bee workflow: Generate a single-phase spec (TASKS.md with waves) and execute via TDD waves — fills the gap between /bee-quick (single task) and /bee-new-spec (full ceremony)"
---

# Bee Quick Phase

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/quick-phase.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-quick-phase` on Claude Code or `$bee-quick-phase` on Codex.
