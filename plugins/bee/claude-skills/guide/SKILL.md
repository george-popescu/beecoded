---
user-invocable: false
name: guide
description: Bee workflow intelligence -- decision trees, command routing by intent, smart feature suggestions, anti-patterns. Teaches Claude HOW to use Bee, not just which commands exist.
---

# Bee Mastery Guide

This guide teaches you to use Bee intelligently -- when to suggest commands, what to recommend proactively, and what to never do. Complements `do.md` (keyword matching) and `help.md` (command reference) with workflow intelligence.

## 1. Workflow Decision Tree

### Spec-Level States

| Spec Status | Condition | Suggest | Why |
|-------------|-----------|---------|-----|
| NO_SPEC | No uncommitted changes | `/bee-new-spec` | Start a new feature |
| NO_SPEC | Uncommitted changes | `/bee-review-implementation` | Review existing work first |
| SPEC_CREATED | -- | `/bee-plan-phase 1` | Plan the first phase |
| IN_PROGRESS | See phase table below | (varies) | Phase-dependent |
| COMPLETED | -- | `/bee-complete-spec` | Run completion ceremony |
| ARCHIVED | -- | `/bee-new-spec` | Start fresh |

These states reflect the FOCUSED spec (the global STATE.md mirror). With 2+ active specs a spec command shows a picker; if the global shows NO_SPEC but the registry has active specs, suggest `/bee-spec use <slug>` / `/bee-spec list` (do NOT assume the project is idle).

### Phase-Level Substates (within IN_PROGRESS)

| Phase Status | Suggest | Notes |
|--------------|---------|-------|
| PENDING | `/bee-plan-phase N` | Must plan before execute |
| PLANNED | `/bee-plan-review` | Review plan quality first |
| PLAN_REVIEWED | `/bee-execute-phase N` | Ready to build |
| EXECUTING | `/bee-execute-phase N` | Resume interrupted execution |
| EXECUTED | `/bee-review` | Per-phase review (NOT review-implementation) |
| REVIEWING | `/bee-review` | Resume interrupted review |
| REVIEWED | `/bee-test` | Generate test scenarios |
| TESTING | `/bee-test` | Resume testing |
| TESTED | `/bee-commit` | All verified, safe to commit |
| COMMITTED | `/bee-plan-phase N+1` | Next phase, or complete-spec if last |

### Multi-Phase Intelligence

| Condition | Suggest | Why |
|-----------|---------|-----|
| 3+ phases remain unplanned | `/bee-plan-all` | Batch plan saves time |
| All phases PLAN_REVIEWED | `/bee-autonomous` or `/bee-ship` | Batch execute with review loops |
| Urgent bug mid-execution | `/bee-insert-phase N.1` | Decimal phase insertion |
| Multiple independent features | `/bee-spec promote <slug>` (spec-first) or `/bee-workspace new` (ad-hoc) | `/bee-spec promote` carries the spec's plan and state into a dedicated worktree; `/bee-workspace new` is for generic/ad-hoc parallel work without an existing spec |
| Switch focus between active specs | `/bee-spec use <slug>` | Re-focuses the session on a different active spec |
| See all active specs at a glance | `/bee-spec dashboard` | Multi-spec roster with stage/location per spec |
| All phases COMMITTED | `/bee-complete-spec` | Full ceremony (audit + changelog + tag + archive) |
| Promoted spec finished (phases COMMITTED, location is a worktree) | `/bee-workspace complete spec-<slug>` THEN `/bee-complete-spec` | Merge code+state back BEFORE the completion ceremony — otherwise the worktree's code is stranded |
| Start a 2nd feature while one is in progress | `/bee-new-spec` (it no longer archives the active spec — both queue) | Multiple active specs are expected; switch with `/bee-spec use` |
| Per-spec memory | `.bee/specs/<slug>/memory.md` is injected when exactly one spec is active | Keeps spec-scoped preferences and context in scope |

## 2. Command Reference by Intent

### Start Something
| Intent | Command | When |
|--------|---------|------|
| New feature (vague idea) | `/bee-discuss` then `/bee-new-spec` | Explore before defining |
| New feature (clear requirements) | `/bee-new-spec` | Requirements already known |
| Quick bug fix or small change | `/bee-quick` | Single-phase fast loop |
| Defer an idea for later | `/bee-seed` | Capture with trigger conditions |
| Start another feature while one is still building | `/bee-new-spec` (queues alongside; does NOT archive the active spec) | -- |

### Plan Work
| Intent | Command |
|--------|---------|
| Break phase into tasks | `/bee-plan-phase N` |
| Review plan quality | `/bee-plan-review` |
| Plan all remaining phases | `/bee-plan-all` |
| Add phase to spec | `/bee-add-phase` |
| Insert urgent phase mid-spec | `/bee-insert-phase N.1` |
| UI design contract | `/bee-ui-spec` |

### Build
| Intent | Command |
|--------|---------|
| Execute planned phase | `/bee-execute-phase N` |
| Run everything hands-free | `/bee-autonomous` (plan+execute+review per phase) |
| Execute + review + commit all | `/bee-ship` (for PLAN_REVIEWED phases) |
| Work on two specs in parallel (spec-first) | `/bee-spec promote <slug>` — promotes existing spec + its plan/state into its own worktree |
| Merge a finished promoted spec back in-place | `/bee-workspace complete spec-<slug>` |
| Ad-hoc parallel work (no existing spec) | `/bee-workspace new {name}` |
| Switch focused spec | `/bee-spec use <slug>` |
| See all active specs | `/bee-spec list` or `/bee-spec dashboard` |

### Review and Fix
| Intent | Command | Scope |
|--------|---------|-------|
| Per-phase code review | `/bee-review` | Single phase |
| Multi-agent deep review | `/bee-swarm-review` | Segmented parallel |
| Cross-phase compliance | `/bee-review-implementation` | All executed phases |
| Fix confirmed findings | `/bee-fix-implementation` | Apply fixes |
| Visual/UI audit | `/bee-ui-review` | 6-pillar visual |

### Test
| Intent | Command |
|--------|---------|
| Manual test scenarios | `/bee-test` |
| Generate tests from requirements | `/bee-test-gen` |
| E2E Playwright tests | `/bee-test-e2e` |

### Audit
| Intent | Command |
|--------|---------|
| Full 10-agent codebase audit | `/bee-audit` |
| Convert audit to spec | `/bee-audit-to-spec` |
| Spec traceability matrix | `/bee-audit-spec` |

### Debug and Diagnose
| Intent | Command | Use When |
|--------|---------|----------|
| Systematic bug investigation | `/bee-debug` | Complex, multi-symptom bug |
| Stuck/failed workflow diagnosis | `/bee-forensics` | Workflow anomaly, not code bug |
| Project health diagnostics | `/bee-health` | 14-check structural validation |
| Forensics found root cause | Forensics handoff | Transitions to debug with pre-populated symptoms |

### Agent Teams (experimental, opt-in)

Bee supports Claude Code Agent Teams (v2.1.32+, requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). Teams unlock peer-to-peer reviewer debate and scientific-debate debugging at ~7x the token cost of subagents. `/bee-init` and `/bee-update` detect availability and offer opt-in.

**When teams add value (use `--team` flag):**
| Scenario | Command | Why team beats subagent |
|---|---|---|
| Intermittent bug, multi-subsystem error | `/bee-debug --team` | Adversarial hypothesis debate beats single-investigator anchoring bias |
| Pre-merge review of security-critical code | `/bee-swarm-review --team` | Real-time cross-lens dedup; security challenger questions performance verdicts |
| Cross-stack architectural phase planning | `/bee-plan-phase --team` | Architects negotiate contracts upfront before implementation discovers mismatches |
| Large codebase audit (200+ files) | `/bee-audit --team` | Domain-split (auth/payments/reporting) eliminates discipline-overlap noise |

**When subagents are sufficient (no flag — default):**
- Routine post-phase reviews
- Single-file fixes
- Quick tasks
- Sequential dependencies
- Anything where the 7x cost isn't justified by exploration depth

**Auto-mode behavior:** if `agent_teams.allow_in_auto_mode == true` in `.bee/config.json`, `/bee-ship`, `/bee-plan-all`, and `/bee-autonomous` MAY auto-spawn ONE team per run when the operation scores ≥ 70 on the team-decisions scorer (5-axis weighted: hypothesis breadth, cross-layer coverage, independence, uncertainty, stakes). Hard cap: one team per autonomous run (slow shutdown + one-team-per-session limit).

**Anti-patterns:**
- Don't use teams for execute-phase, fix-implementation, or quick (wave/file structure already parallelizes)
- Don't auto-enable teams without measuring cost
- Don't use plan mode unless the architectural decision justifies 7x cost

See `claude-skills/team-decisions/SKILL.md` for full scoring rules, `claude-skills/agent-teams/SKILL.md` for skill bridge mechanism, `claude-skills/team-templates/SKILL.md` for spawn prompt patterns.

### Per-Wave Test Scoping (`/bee-execute-phase`, `/bee-quick`)

After each wave, `/bee-execute-phase` runs **only the tests affected by the wave's changed files** instead of the full suite. Same primitive (`Scoped Test Selection`) is available to `/bee-quick`. Phase-end full suite always runs as the safety net before the phase is marked EXECUTED.

**Per-runner behavior:**

| Runner | Scoping mechanism |
|---|---|
| vitest | Native `vitest related --run` (import-graph) |
| jest | Native `jest --findRelatedTests` (import-graph) |
| pest / phpunit | Filename heuristic (composer.json psr-4 source-root → `{Basename}*Test.php` matches) |
| pytest | Filename heuristic; `-k` form on src-layout |
| `none` / unsupported | Falls back to full suite |

**Config knob:** `phases.post_wave_validation` in `.bee/config.json`:

| Value | Behavior |
|---|---|
| `auto` (default) | Scoped where supported, full elsewhere |
| `full` | Always full (legacy behavior) |
| `scoped` | Always scoped, skip-with-warn if runner unsupported |
| `skip` | No per-wave tests; phase-end full suite is sole validation |

**When to suggest changing it:**
- Suite slow + runner supports scoping → leave `auto` (default)
- Suite very slow AND many waves AND user accepts deferred fail-detection → `skip` (rely entirely on phase-end safety net)
- Suite small (< 30s full run) → `full` (no scoping overhead worth it)

**Anti-patterns:**
- Don't promise users a specific speedup percentage — depends entirely on suite size + wave file count
- Don't disable the phase-end safety net (it always runs regardless of `post_wave_validation`)

See `claude-skills/command-primitives/SKILL.md` Scoped Test Selection for the per-runner command templates and the heuristic mapping rules.

### Session Management
| Intent | Command |
|--------|---------|
| Check progress | `/bee-progress` |
| Auto-suggest next step | `/bee-next` |
| Pause work for later | `/bee-pause` |
| Resume after break | `/bee-resume` |
| Quick note capture | `/bee-note` |
| Cross-session knowledge | `/bee-thread` |
| Save context before compact | `/bee-checkpoint` |
| End of day integrity check | `/bee-eod` |
| View/manage memory — global user.md + per-spec memory.md | `/bee-memory` |
| Commit changes | `/bee-commit` |
| Full spec completion ceremony | `/bee-complete-spec` |
| Quick archive (skip ceremony) | `/bee-archive-spec` |
| Manage seed backlog | `/bee-backlog` |

### Setup and Maintenance
| Intent | Command |
|--------|---------|
| Initialize Bee for project | `/bee-init` |
| Update Bee plugin | `/bee-update` |
| View/edit user profile | `/bee-profile` |
| Rebuild codebase context | `/bee-refresh-context` |
| Get help and command list | `/bee-help` |
| Natural language intent routing | `/bee-do` |
| Create custom agent | `/bee-create-agent` |
| Create custom skill | `/bee-create-skill` |

## 3. Smart Feature Suggestions

Proactively suggest these when conditions are met -- don't wait for the user to ask.

### Metrics and Performance
- IF 3+ phases completed: mention bottleneck detection in `/bee-progress`
- IF review iterations > 2 on recent phase: suggest checking metrics for workflow health
- IF execution taking long: mention predictive complexity scoring in plan-phase

### Testing Intelligence
- IF phase reviewed with findings + test coverage unclear: suggest `/bee-test-gen`
- IF building UI phase: suggest `/bee-test-e2e` for Playwright tests
- IF requirements.md shows low test mapping: mention test-gen maps criteria to tests

### Debugging Intelligence
- IF user says "stuck" or "something failed": suggest `/bee-forensics` first (read-only), then `/bee-debug`
- IF debug session resolved root cause: mention pattern extraction (patterns auto-suggested in future)
- IF forensics found CRITICAL/HIGH anomaly: mention handoff to `/bee-debug`

### Workflow Efficiency
- IF all phases planned: suggest `/bee-ship` or `/bee-autonomous` over manual per-phase
- IF multiple unrelated tasks: suggest `/bee-workspace` for ad-hoc parallel worktrees; suggest `/bee-spec promote` when the second track already has an active spec with a plan
- IF a second spec is about to execute while another is running in-place: `/bee-execute-phase` auto-offers promote/queue/pause — promote creates a dedicated worktree, queue defers, pause halts the current spec
- IF long session with growing context: mention `/bee-checkpoint` preserves Bee state
- IF end of day: suggest `/bee-eod` for integrity check
- IF spec complete AND it lives in a promoted worktree (location != in-place): suggest `/bee-workspace complete spec-<slug>` FIRST (merges code + state back in-place, removes the worktree), THEN `/bee-complete-spec`. NEVER send a promoted spec straight to `/bee-complete-spec` — its code is stranded on `bee/spec/<slug>`.
- IF spec complete AND location is in-place: suggest `/bee-complete-spec` (full ceremony) over bare `/bee-archive-spec`
- IF 2+ active specs and the user asks for status/overview ("what are my specs", "where am I", "what's active", "ce spec-uri am"): suggest `/bee-spec list` (quick roster), or `/bee-spec dashboard` when any spec is promoted to a worktree (shows in-place vs worktree topology + merge commands).
- IF the user wants to begin another feature while one is executing: `/bee-new-spec` queues a 2nd spec (the prior stays active & untouched); switch with `/bee-spec use`, or build both at once with `/bee-spec promote`.

### Memory Capture
- IF the user states a durable constraint / pattern / invariant / gotcha scoped to the CURRENT feature (one active spec): offer `/bee-memory` → spec memory (`.bee/specs/<slug>/memory.md`, auto-injected into agents working on this spec). IF the rule is project-wide, use global user.md instead.

### Idea Capture
- IF user mentions "later" or a tangent: suggest `/bee-seed` with trigger conditions
- IF quick thought: suggest `/bee-note` for zero-friction capture
- IF starting new spec: `/bee-new-spec` auto-surfaces matching seeds

### Review Escalation
- IF single-phase review found many issues: suggest `/bee-swarm-review` for deeper analysis
- IF multiple phases done without cross-phase review: suggest `/bee-review-implementation`

## 4. Anti-Patterns

1. NEVER auto-commit. User commits via `/bee-commit` only.
2. NEVER suggest `/bee-review-implementation` after a single phase. Use `/bee-review` per phase.
3. NEVER skip review between execute and test. Cycle: execute -> review -> test -> commit.
4. NEVER skip plan-review. Phases should be PLAN_REVIEWED before execute-phase.
5. NEVER write production code without a failing test first. TDD is non-negotiable.
6. NEVER trust conversation memory for state. Read STATE.md and TASKS.md from disk.
7. NEVER auto-approve decision checkpoints. Present options; "Custom" always last.
8. NEVER accumulate context in autonomous. Each phase: fresh subagent, only SUMMARY.md carries forward.
9. NEVER expect LEARNINGS.md in fresh autonomous runs. It requires prior manual reviews.
10. NEVER sort decimal phases lexicographically. Sort numerically: 2, 2.1, 2.2, 3 (not 2, 2.1, 3, 2.2).
11. NEVER run `/bee-ship` on unplanned phases. All must be PLAN_REVIEWED first.
12. NEVER suggest `/bee-checkpoint` or `/clear` as blockers. Execute directly with available context.
13. NEVER run full test suite, linter, or static analysis inside parallel agents. Agents test ONLY their files; conductor validates ONCE per wave (~70% time savings).

## 5. Ecosystem Model

**Commands -> Agents:** Commands are orchestrators. They read state from disk, validate guards, spawn specialized agents via Task tool. 50 commands orchestrate 36 agents. Agents inherit the parent model unless the conductor explicitly passes `model: "sonnet"` for structured/economy tasks.

**Hooks -> Scripts:** 8 lifecycle events drive 8+ scripts. SessionStart loads project state (load-context.sh) and configures statusline (setup-statusline.js). PostToolUse auto-lints (auto-lint.sh). SubagentStart injects user preferences (inject-memory.sh). SubagentStop validates agent output (per-agent prompts in hooks.json). PreToolUse gates commits (pre-commit-gate.sh). PreCompact saves session context. Stop reminds about unreviewed work. SessionEnd writes session metrics.

**Skills -> Knowledge:** Skills are composable knowledge packs. Core skill provides workflow rules (TDD, disk-is-truth). Stack skills (10 stacks) provide framework conventions. Standards skills (global, frontend, backend, testing) provide universal practices. This guide provides workflow intelligence. Skills load into agent context via frontmatter `skills:` arrays.

## 6. When to Read This Guide

Read this guide when:
- **Session start:** The compact excerpt in load-context.sh gives basic awareness. Read the full guide for decision logic.
- **User seems unsure:** Consult the decision tree (Section 1) to suggest the right next step.
- **User describes intent without naming a command:** Consult the intent map (Section 2).
- **Phase just completed:** Consult the decision tree to know what comes next.
- **Contextual trigger detected:** Check smart suggestions (Section 3) for proactive recommendations.
- **About to take an action:** Check anti-patterns (Section 4) to avoid workflow violations.
- **User asks "what can Bee do?":** The intent map (Section 2) is the comprehensive capability reference.
