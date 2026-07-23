---
name: bee-spec
description: "Use when the user explicitly invokes /bee-spec on Claude Code or $bee-spec on Codex, or asks for this Bee workflow: List active specs, switch focus, show spec status, or promote a spec to a worktree (multi-spec registry)"
---

# Bee Spec

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/spec.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-spec` on Claude Code or `$bee-spec` on Codex.
