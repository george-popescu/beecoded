---
name: bee-resume
description: "Use when the user explicitly invokes /bee-resume on Claude Code or $bee-resume on Codex, or asks for this Bee workflow: Resume BeeDev work from where you left off with full context restoration"
---

# Bee Resume

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/resume.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-resume` on Claude Code or `$bee-resume` on Codex.
