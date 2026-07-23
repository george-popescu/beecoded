---
name: bee-review
description: "Use when the user explicitly invokes /bee-review on Claude Code or $bee-review on Codex, or asks for this Bee workflow: Review current phase implementation against spec, standards, and quality checklist"
---

# Bee Review

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/review.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-review` on Claude Code or `$bee-review` on Codex.
