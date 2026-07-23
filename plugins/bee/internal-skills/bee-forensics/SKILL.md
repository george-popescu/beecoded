---
name: bee-forensics
description: "Use when the user explicitly invokes /bee-forensics on Claude Code or $bee-forensics on Codex, or asks for this Bee workflow: Diagnose failed or stuck workflows with evidence-based git history analysis, artifact consistency checks, and recovery suggestions"
---

# Bee Forensics

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/forensics.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-forensics` on Claude Code or `$bee-forensics` on Codex.
