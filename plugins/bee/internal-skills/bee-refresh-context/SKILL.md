---
name: bee-refresh-context
description: "Use when the user explicitly invokes /bee-refresh-context on Claude Code or $bee-refresh-context on Codex, or asks for this Bee workflow: Re-run codebase context extraction, producing multi-document output (STACK.md, ARCHITECTURE.md, CONVENTIONS.md, CONCERNS.md)"
---

# Bee Refresh Context

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/refresh-context.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-refresh-context` on Claude Code or `$bee-refresh-context` on Codex.
