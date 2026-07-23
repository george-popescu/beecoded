---
name: bee-complete-spec
description: "Use when the user explicitly invokes /bee-complete-spec on Claude Code or $bee-complete-spec on Codex, or asks for this Bee workflow: Run the full spec lifecycle ceremony -- audit, changelog, git tag, archive, and spec history"
---

# Bee Complete Spec

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/complete-spec.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-complete-spec` on Claude Code or `$bee-complete-spec` on Codex.
