---
name: bee-update
description: "Use when the user explicitly invokes /bee-update on Claude Code or $bee-update on Codex, or asks for this Bee workflow: Update bee statusline, re-discover config capabilities (MCP, LSP, models), and clean up legacy local copies"
---

# Bee Update

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/update.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-update` on Claude Code or `$bee-update` on Codex.
