---
name: bee-ship
description: "Use when the user explicitly invokes /bee-ship on Claude Code or $bee-ship on Codex, or asks for this Bee workflow: Execute all plan-reviewed phases autonomously with review loops, decision logging, and final implementation review"
---

# Bee Ship

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/ship.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-ship` on Claude Code or `$bee-ship` on Codex.
