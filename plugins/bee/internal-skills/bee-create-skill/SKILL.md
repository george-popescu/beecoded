---
name: bee-create-skill
description: "Use when the user explicitly invokes /bee-create-skill on Claude Code or $bee-create-skill on Codex, or asks for this Bee workflow: Create a custom project-local skill extension for bee"
---

# Bee Create Skill

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/create-skill.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-create-skill` on Claude Code or `$bee-create-skill` on Codex.
