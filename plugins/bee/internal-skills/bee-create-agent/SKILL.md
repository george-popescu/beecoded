---
name: bee-create-agent
description: "Use when the user explicitly invokes /bee-create-agent on Claude Code or $bee-create-agent on Codex, or asks for this Bee workflow: Create a custom project-local agent extension for bee"
---

# Bee Create Agent

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/create-agent.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-create-agent` on Claude Code or `$bee-create-agent` on Codex.
