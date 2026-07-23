---
name: bee-test-gen
description: "Use when the user explicitly invokes /bee-test-gen on Claude Code or $bee-test-gen on Codex, or asks for this Bee workflow: Generate behavioral tests from requirement coverage gaps"
---

# Bee Test Gen

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/test-gen.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-test-gen` on Claude Code or `$bee-test-gen` on Codex.
