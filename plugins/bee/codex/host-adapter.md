# Bee host adapter

The parent of this `codex/` directory is the plugin root. Files under `workflows/`, `agents/`, and `claude-skills/` are Bee's canonical sources. Entry skills are deliberately thin so Claude Code and Codex share one workflow definition.

Determine the current host before applying mappings:

- On Claude Code, follow the canonical workflow directly. Its `/bee-<name>` invocation, tool names, named `bee:<role>` agents, `CLAUDE_PLUGIN_ROOT`, `CLAUDE.md`, hooks, and user settings are native. Do not apply the Codex substitutions below.
- On Codex, apply every substitution below. The native invocation is `$bee-<name>`.

## Codex substitutions

- `/bee-<name>` means `$bee-<name>` on Codex.
- Read, Glob, Grep, Bash, Write, and Edit mean the equivalent Codex file and shell capabilities. Preserve the command's read-before-write and confirmation rules.
- `AskUserQuestion` means ask the user a concise direct question. Continue without asking only when the canonical workflow explicitly allows a safe default.
- `Skill(skill: "bee-<name>")` means invoke `$bee-<name>`, or open `../internal-skills/bee-<name>/SKILL.md` from the plugin root and execute it directly when nested skill invocation is unavailable.
- For `Task`, `Agent`, or a `bee:<role>` subagent, read the matching role from `../agents/<role>.md` and pass those instructions plus only the requested task payload to a Codex subagent. If subagents are unavailable, perform the work inline while preserving the role boundaries, fresh-context checks, and parallelism requirements as closely as the host permits.
- When a command requests a Bee knowledge skill, load its canonical file from `../claude-skills/<skill>/SKILL.md`. Resolve nested stack and standards skills under that same `claude-skills/` tree.
- Do not edit Claude global configuration from Codex. The substitutions below override the canonical workflow where applicable.

## Init-specific Codex substitutions

When running `$bee-init` on Codex:

- Do not inspect or modify `~/.claude/settings.json`, `~/.claude/hooks/`, Claude statusline settings, Claude notification hooks, or `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`.
- Skip statusline, Claude notification, and Agent Teams configuration steps. Report them as Claude-only capabilities, not as failures.
- When project instructions are approved, update `AGENTS.md` instead of `CLAUDE.md`. Preserve existing content and add a clearly delimited Bee section that points to `.bee/STATE.md`, `.bee/config.json`, and `$bee-progress`.
- Treat Codex subagents as available only when the current surface exposes them. Do not write host configuration merely to enable them.
- Resolve package-relative files from the durable Bee managed payload; do not depend on `CLAUDE_PLUGIN_ROOT` being set.
- In the completion summary, list only files actually created or changed. Never claim that Claude-only global configuration was installed.

Keep `.bee/` artifacts and their schemas host-neutral. The disk state is the source of truth on both hosts, and neither host may auto-commit.
