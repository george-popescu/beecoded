---
name: bee-execute-phase
description: "Use when the user explicitly invokes /bee-execute-phase on Claude Code or $bee-execute-phase on Codex, or asks for this Bee workflow: Execute a planned phase with wave-based parallel TDD implementation"
---

# Bee Execute Phase

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/execute-phase.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-execute-phase` on Claude Code or `$bee-execute-phase` on Codex.
