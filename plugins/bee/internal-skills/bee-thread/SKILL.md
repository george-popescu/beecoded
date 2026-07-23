---
name: bee-thread
description: "Use when the user explicitly invokes /bee-thread on Claude Code or $bee-thread on Codex, or asks for this Bee workflow: Persistent cross-session knowledge threads -- create, list, resume, close"
---

# Bee Thread

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/thread.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-thread` on Claude Code or `$bee-thread` on Codex.
