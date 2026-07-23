---
name: bee-init
description: "Use when the user explicitly invokes /bee-init on Claude Code or $bee-init on Codex, or asks for this Bee workflow: Initialize BeeDev for a project -- detect stack, create .bee/, configure workflow"
---

# Bee Init

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/init.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-init` on Claude Code or `$bee-init` on Codex.
