---
name: bee-profile
description: "Use when the user explicitly invokes /bee-profile on Claude Code or $bee-profile on Codex, or asks for this Bee workflow: Profile behavioral preferences across 8 dimensions with evidence-based scoring"
---

# Bee Profile

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/profile.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-profile` on Claude Code or `$bee-profile` on Codex.
