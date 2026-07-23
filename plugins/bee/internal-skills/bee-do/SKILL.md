---
name: bee-do
description: "Use when the user explicitly invokes /bee-do on Claude Code or $bee-do on Codex, or asks for this Bee workflow: Route natural language intent to the right bee command"
---

# Bee Do

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/do.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-do` on Claude Code or `$bee-do` on Codex.
