---
name: bee-audit-to-spec
description: "Use when the user explicitly invokes /bee-audit-to-spec on Claude Code or $bee-audit-to-spec on Codex, or asks for this Bee workflow: Convert audit findings into actionable specs -- generates bee-new-spec or bee-quick tasks from AUDIT-REPORT.md"
---

# Bee Audit To Spec

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/audit-to-spec.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-audit-to-spec` on Claude Code or `$bee-audit-to-spec` on Codex.
