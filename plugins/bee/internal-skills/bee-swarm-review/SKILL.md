---
name: bee-swarm-review
description: "Use when the user explicitly invokes /bee-swarm-review on Claude Code or $bee-swarm-review on Codex, or asks for this Bee workflow: Multi-agent parallel review with segmentation, consensus scoring, and evidence chains -- dispatches specialized reviewers per code segment"
---

# Bee Swarm Review

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/swarm-review.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-swarm-review` on Claude Code or `$bee-swarm-review` on Codex.
