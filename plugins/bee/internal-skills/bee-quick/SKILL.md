---
name: bee-quick
description: "Use when the user explicitly invokes /bee-quick on Claude Code or $bee-quick on Codex, or asks for this Bee workflow: Execute a quick task without the full spec pipeline — just describe, execute, commit"
---

# Bee Quick

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/quick.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-quick` on Claude Code or `$bee-quick` on Codex.
