# Code Audit

`@beecoded/code-audit` provides one focused whole-codebase audit skill for Claude Code and Codex. It works in an unfamiliar repository without Bee, Nectar, Atlas, or project initialization.

## Install

```bash
npm install --global @beecoded/code-audit
code-audit install --all
```

Use `--claude` or `--codex` to target one host. Managed updates refuse downgrades unless `--allow-downgrade` is supplied. `code-audit uninstall --all` removes only package-owned registrations and the managed `code-audit` skill.

Running `code-audit --all` again updates both detected hosts. A deliberately version-pinned older runner must be invoked as `code-audit --all --allow-downgrade`; without that explicit override, the installed version and skills are preserved.

## Use

- Claude Code: `/code-audit`
- Codex: `$code-audit`

Ask for a whole-repository health snapshot. This skill is intentionally not a diff review, single-bug debugger, or browser UI/UX audit.

By default the report is written to `code-audit-YYYY-MM-DD.md` at the repository root. You may request another report path. The report is the only allowed write: Code Audit does not change source, tests, configuration, dependencies, Git state, or agent workflow state, and it never applies fixes.

It also never commits, pushes, publishes, deploys, initializes Bee/Nectar state, or ships audited code. Findings are handed to a separate, explicitly requested repair workflow.

## Risk model

Every candidate is adversarially validated and remains in one of seven classes: code defect, test/coverage gap, test defect, documentation gap, maintainability, stylistic, or hardening. Only confirmed reachable code defects at Medium, High, or Critical are blocking. A clean audit means zero blocking code defects, not zero observations.

The report records inspected scope, important coverage gaps, validated findings,
useful next actions and a stable parseable summary. Inspection depth and delegation
follow risk; no file-count or finding-count thresholds require additional agents.

## Development

```bash
npm test --workspace @beecoded/code-audit
node ../../tools/validate-package.mjs code-audit
node ../../tools/run-plugin-evals.mjs --product code-audit --all --dry-run
```

Behavioral runs use the host-neutral repository evaluator. Claude Code uses its native plugin-eval adapter; Codex uses the same fixtures and deterministic checks through `codex exec`.
