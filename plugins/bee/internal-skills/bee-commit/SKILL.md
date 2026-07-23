---
name: bee-commit
description: "Use when the user explicitly invokes /bee-commit on Claude Code or $bee-commit on Codex, or asks for this Bee workflow: Show diff summary and create a commit with user approval"
---

# Bee Commit

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/commit.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-commit` on Claude Code or `$bee-commit` on Codex.
