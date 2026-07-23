---
name: bee-audit-spec
description: "Use when the user explicitly invokes /bee-audit-spec on Claude Code or $bee-audit-spec on Codex, or asks for this Bee workflow: Generate a traceability matrix cross-referencing spec requirements to phases, reviews, and tests"
---

# Bee Audit Spec

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/audit-spec.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-audit-spec` on Claude Code or `$bee-audit-spec` on Codex.
