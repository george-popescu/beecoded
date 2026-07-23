---
name: bee-ui-review
description: "Use when the user explicitly invokes /bee-ui-review on Claude Code or $bee-ui-review on Codex, or asks for this Bee workflow: Audit frontend implementation with a 6-pillar visual review -- design system, accessibility, performance, responsiveness, interaction quality, and polish"
---

# Bee Ui Review

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/ui-review.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-ui-review` on Claude Code or `$bee-ui-review` on Codex.
