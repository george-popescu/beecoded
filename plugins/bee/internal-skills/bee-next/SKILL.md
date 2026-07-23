---
name: bee-next
description: "Use when the user explicitly invokes /bee-next on Claude Code or $bee-next on Codex, or asks for this Bee workflow: Auto-detect workflow state and dispatch the next logical command"
---

# Bee Next

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/next.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-next` on Claude Code or `$bee-next` on Codex.
