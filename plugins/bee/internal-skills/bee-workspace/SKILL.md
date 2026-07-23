---
name: bee-workspace
description: "Use when the user explicitly invokes /bee-workspace on Claude Code or $bee-workspace on Codex, or asks for this Bee workflow: Create and manage isolated workspaces for parallel feature development"
---

# Bee Workspace

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/workspace.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-workspace` on Claude Code or `$bee-workspace` on Codex.
