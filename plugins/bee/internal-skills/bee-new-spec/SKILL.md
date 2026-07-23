---
name: bee-new-spec
description: "Use when the user explicitly invokes /bee-new-spec on Claude Code or $bee-new-spec on Codex, or asks for this Bee workflow: Create a new feature specification through conversational discovery"
---

# Bee New Spec

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/new-spec.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-new-spec` on Claude Code or `$bee-new-spec` on Codex.
