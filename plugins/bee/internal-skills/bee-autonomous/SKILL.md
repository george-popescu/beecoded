---
name: bee-autonomous
description: "Use when the user explicitly invokes /bee-autonomous on Claude Code or $bee-autonomous on Codex, or asks for this Bee workflow: Execute all remaining phases autonomously — chains plan, execute, and review per phase with fresh context, pausing only for decisions"
---

# Bee Autonomous

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/autonomous.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-autonomous` on Claude Code or `$bee-autonomous` on Codex.
