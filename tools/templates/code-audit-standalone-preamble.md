---
name: code-audit
description: Use for whole-codebase health checks, pre-release sweeps, or taking over an unfamiliar repository. Produces an evidence-backed risk report without requiring Bee, Nectar, or project initialization. Not for reviewing one change, debugging one known failure, or UI/UX browser verification.
---

# Code Audit

Audit the whole codebase as a point-in-time health snapshot. The report is the only write. Do not change source, tests, configuration, dependencies, Git state, agent state, or workflow state, and never fix findings during the audit.

This skill is self-contained. Read native `AGENTS.md`, `CLAUDE.md`, and equivalent repository instructions that apply to the audited paths, but do not require or initialize Bee, Nectar, Atlas, or any other project state.

If the request is limited to a diff/change, one known failure, or rendered UI/UX, state that this whole-codebase audit is the wrong boundary and stop without writing a report.
