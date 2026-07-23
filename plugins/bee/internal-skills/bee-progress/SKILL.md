---
name: bee-progress
description: "Use when the user explicitly invokes /bee-progress on Claude Code or $bee-progress on Codex, or asks for this Bee workflow: Show current BeeDev project state and suggest next action"
---

# Bee Progress

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/progress.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-progress` on Claude Code or `$bee-progress` on Codex.
