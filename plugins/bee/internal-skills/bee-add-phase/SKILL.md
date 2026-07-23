---
name: bee-add-phase
description: "Use when the user explicitly invokes /bee-add-phase on Claude Code or $bee-add-phase on Codex, or asks for this Bee workflow: Add a new phase to the current spec's phases.md and STATE.md"
---

# Bee Add Phase

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/add-phase.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-add-phase` on Claude Code or `$bee-add-phase` on Codex.
