---
name: bee-test
description: "Use when the user explicitly invokes /bee-test on Claude Code or $bee-test on Codex, or asks for this Bee workflow: Generate manual test scenarios and verify with developer"
---

# Bee Test

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/test.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-test` on Claude Code or `$bee-test` on Codex.
