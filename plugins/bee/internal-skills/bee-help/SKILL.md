---
name: bee-help
description: "Use when the user explicitly invokes /bee-help on Claude Code or $bee-help on Codex, or asks for this Bee workflow: Show available bee commands and usage reference"
---

# Bee Help

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/help.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-help` on Claude Code or `$bee-help` on Codex.
