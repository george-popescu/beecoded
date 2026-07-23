---
name: bee-test-e2e
description: "Use when the user explicitly invokes /bee-test-e2e on Claude Code or $bee-test-e2e on Codex, or asks for this Bee workflow: Generate and run Playwright E2E tests for the current feature or ad-hoc scenarios"
---

# Bee Test E2e

Read both files completely before acting:

1. [Host adapter](../../codex/host-adapter.md)
2. [Canonical workflow](../../workflows/test-e2e.md)

Execute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as `/bee-test-e2e` on Claude Code or `$bee-test-e2e` on Codex.
