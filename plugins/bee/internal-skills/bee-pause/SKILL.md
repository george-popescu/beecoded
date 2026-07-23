---
name: bee-pause
description: "Use when the user explicitly invokes /bee-pause on Claude Code or $bee-pause on Codex, or asks for this Bee workflow: Pause work and create a handoff file for seamless resumption"
---

# Bee Pause

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/pause.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-pause` on Claude Code or `$bee-pause` on Codex.
