---
name: bee-plan-review
description: "Use when the user explicitly invokes /bee-plan-review on Claude Code or $bee-plan-review on Codex, or asks for this Bee workflow: Review a phase plan (TASKS.md) against the original spec to find coverage gaps and discrepancies"
---

# Bee Plan Review

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/plan-review.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-plan-review` on Claude Code or `$bee-plan-review` on Codex.
