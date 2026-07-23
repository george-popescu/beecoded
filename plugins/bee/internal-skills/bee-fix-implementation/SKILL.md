---
name: bee-fix-implementation
description: "Use when the user explicitly invokes /bee-fix-implementation on Claude Code or $bee-fix-implementation on Codex, or asks for this Bee workflow: Read most recent review output and apply confirmed findings using fixer agents"
---

# Bee Fix Implementation

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/fix-implementation.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-fix-implementation` on Claude Code or `$bee-fix-implementation` on Codex.
