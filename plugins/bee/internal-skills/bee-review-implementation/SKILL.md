---
name: bee-review-implementation
description: "Use when the user explicitly invokes /bee-review-implementation on Claude Code or $bee-review-implementation on Codex, or asks for this Bee workflow: Context-aware implementation review -- full spec compliance or ad-hoc code review with four-agent pipeline"
---

# Bee Review Implementation

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/review-implementation.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-review-implementation` on Claude Code or `$bee-review-implementation` on Codex.
