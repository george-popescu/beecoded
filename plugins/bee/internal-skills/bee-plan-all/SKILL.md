---
name: bee-plan-all
description: "Use when the user explicitly invokes /bee-plan-all on Claude Code or $bee-plan-all on Codex, or asks for this Bee workflow: Plan all unplanned phases sequentially with plan review and cross-plan consistency check"
---

# Bee Plan All

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/plan-all.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-plan-all` on Claude Code or `$bee-plan-all` on Codex.
