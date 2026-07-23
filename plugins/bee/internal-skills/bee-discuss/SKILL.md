---
name: bee-discuss
description: "Use when the user explicitly invokes /bee-discuss on Claude Code or $bee-discuss on Codex, or asks for this Bee workflow: Launch a guided codebase-grounded discussion to clarify requirements before creating a spec"
---

# Bee Discuss

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/discuss.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-discuss` on Claude Code or `$bee-discuss` on Codex.
