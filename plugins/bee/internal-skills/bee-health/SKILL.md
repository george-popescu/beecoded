---
name: bee-health
description: "Use when the user explicitly invokes /bee-health on Claude Code or $bee-health on Codex, or asks for this Bee workflow: Validate .bee/ project structure, check workflow metrics, track baselines, detect degradation trends, and cross-reference forensic findings (13 checks)"
---

# Bee Health

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/health.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-health` on Claude Code or `$bee-health` on Codex.
