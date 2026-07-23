---
name: bee-archive-spec
description: "Use when the user explicitly invokes /bee-archive-spec on Claude Code or $bee-archive-spec on Codex, or asks for this Bee workflow: Archive the current spec to .bee/archive/ and reset STATE.md"
---

# Bee Archive Spec

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/archive-spec.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-archive-spec` on Claude Code or `$bee-archive-spec` on Codex.
