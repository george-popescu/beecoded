---
name: bee-eod
description: "Use when the user explicitly invokes /bee-eod on Claude Code or $bee-eod on Codex, or asks for this Bee workflow: Run end-of-day integrity check with 4 parallel audits"
---

# Bee Eod

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/eod.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-eod` on Claude Code or `$bee-eod` on Codex.
