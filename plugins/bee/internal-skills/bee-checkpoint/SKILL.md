---
name: bee-checkpoint
description: "Use when the user explicitly invokes /bee-checkpoint on Claude Code or $bee-checkpoint on Codex, or asks for this Bee workflow: Save Bee context before using the built-in compact command"
---

# Bee Checkpoint

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/checkpoint.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-checkpoint` on Claude Code or `$bee-checkpoint` on Codex.
