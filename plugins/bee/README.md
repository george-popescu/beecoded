# Bee - Spec-Driven Development Workflow

A dual-host Claude Code and Codex plugin that enforces disciplined, spec-driven development with TDD, parallel agent execution, multi-stack support, interactive flow control, review gates, and comprehensive code auditing.

| Host | Invocation example |
|---|---|
| Claude Code | `/bee-init` |
| Codex | `$bee-init` |

The workflows are shared. The npm installer creates standalone `bee-*` user
skills for each selected host; each entry reads a canonical internal workflow
and applies only the current host's tool and subagent mappings. The plugin
manifest does not expose a second namespaced command surface.

## Install

```bash
npx @beecoded/bee@latest
```

Bee detects Claude Code and Codex in `PATH` and installs into both when both are available. Use `--claude` or `--codex` to target just one host.

For a reusable global runner:

```bash
npm install --global @beecoded/bee@latest
bee
```

No manual marketplace command is required. Reinstalling upgrades all
Beecoded-owned standalone skills atomically. A same-named user skill without
Beecoded ownership metadata is never overwritten. To remove the user-scoped
installation, run `npx @beecoded/bee@latest uninstall`.

## What Bee Does

Bee structures your development workflow into a lifecycle: **Spec > Plan > Execute > Review > Test > Commit**. Each step produces artifacts on disk, every feature goes through review gates, and specialized agents handle different aspects of the work — including dedicated audit agents for deep codebase analysis.

## Commands (51)

### Setup & Navigation
| Command | Args | Description |
|---------|------|-------------|
| `/bee-init` | | Initialize Bee for a project — detect stack, create `.bee/`, configure workflow, enable notifications |
| `/bee-progress` | | Show project state, phase progress, and suggest next action |
| `/bee-resume` | | Resume work from previous session with full context restoration |
| `/bee-checkpoint` | | Preserve Bee context before running Claude Code's built-in `/compact` |
| `/bee-memory` | | View and manage memory — global preferences (`user.md`) and per-spec memory |
| `/bee-refresh-context` | | Re-run codebase context extraction, overwriting CONTEXT.md with fresh analysis |
| `/bee-create-agent` | `[agent-name]` | Create a custom project-local agent extension for bee |
| `/bee-create-skill` | `[skill-name]` | Create a custom project-local skill extension for bee |
| `/bee-update` | | Update bee statusline and clean up legacy local copies |

### Multi-Spec
| Command | Args | Description |
|---------|------|-------------|
| `/bee-spec` | `[list\|use <slug>\|status\|promote <slug>\|dashboard]` | List active specs, switch focus, show status, promote to a parallel worktree, or dashboard all active specs |

### Specification
| Command | Args | Description |
|---------|------|-------------|
| `/bee-new-spec` | `[--amend] [--from-discussion PATH] [description]` | Create or amend a feature spec through brainstorming-style adaptive discovery (no fixed round limit) with spec review loop |
| `/bee-plan-phase` | `[phase-number]` | Plan a phase with tasks, acceptance criteria, research, wave grouping, and auto-fix review loop |
| `/bee-plan-all` | | Plan ALL phases sequentially with autonomous review per phase + cross-plan consistency review |
| `/bee-plan-review` | `[phase-number]` | Standalone plan review — find gaps, auto-fix, re-review |
| `/bee-add-phase` | | Append a new phase to the current spec |
| `/bee-discuss` | `[topic description]` | Guided brainstorming-style codebase-grounded discussion before creating a spec |

### Execution
| Command | Args | Description |
|---------|------|-------------|
| `/bee-execute-phase` | `[phase-number]` | Execute a phase with wave-based parallel TDD agents |
| `/bee-ship` | | Autonomous pipeline: execute all phases → review loop each → final implementation review. Zero interaction. Full decision logging. |
| `/bee-quick` | `[--fast] [--amend N] [--review] [description]` | Fast-track task — TDD default, `--fast` for direct, `--amend` to modify existing, `--review` for 4-agent review |

### Quality
| Command | Args | Description |
|---------|------|-------------|
| `/bee-review` | | Multi-agent parallel review (4 specialists) with finding validation, escalation, auto-fix, and unlimited re-review |
| `/bee-review-implementation` | | Context-aware review — full spec mode (5 agents per stack including audit-bug-detector) or ad-hoc mode (3 agents) |
| `/bee-fix-implementation` | `[path/to/REVIEW.md]` | Standalone fix — reads review output and fixes confirmed findings (parallel across files, sequential within same file) |
| `/bee-test` | | Generate manual test scenarios and verify with developer |
| `/bee-test-e2e` | `[description] [--run]` | Generate and run Playwright E2E tests with Page Object Model |

### Audit
| Command | Args | Description |
|---------|------|-------------|
| `/bee-audit` | `[--only security,database,...] [--skip-validation] [--severity critical,high]` | Comprehensive multi-agent code audit — 9 specialists scan in parallel, validator filters hallucinations, structured report output |
| `/bee-audit-to-spec` | `[--critical] [--high] [--all] [--dry-run]` | Convert audit findings into actionable specs — groups by severity, generates spec descriptions for `/bee-new-spec` |

### Finalization
| Command | Args | Description |
|---------|------|-------------|
| `/bee-commit` | | Show diff summary and create a commit with user approval |
| `/bee-archive-spec` | | Archive completed spec, reset STATE.md, bump plugin version |
| `/bee-eod` | | End-of-day integrity check with 4 parallel audits |

### Additional Commands
| Command | Args | Description |
|---------|------|-------------|
| `/bee-audit-spec` | `[--verbose]` | Generate a requirements-to-phases/reviews/tests traceability matrix |
| `/bee-autonomous` | `[--from N] [--to N]` | Execute remaining phases autonomously, pausing only for decisions |
| `/bee-backlog` | `[list\|promote S-NNN\|archive S-NNN]` | List, promote, or archive ideas from the seed backlog |
| `/bee-complete-spec` | `[--skip-audit] [--skip-tag]` | Run the complete spec lifecycle ceremony and archive |
| `/bee-debug` | `[bug description] \| --resume {slug} \| --team \| --no-team` | Investigate a bug through persistent hypothesis-driven sessions |
| `/bee-do` | `[describe intent]` | Route natural-language intent to the right Bee command |
| `/bee-forensics` | `[problem description]` | Diagnose failed or stuck workflows from git and artifact evidence |
| `/bee-health` | | Validate Bee structure, metrics, baselines, and workflow integrity |
| `/bee-help` | `[command-name]` | Show the complete command list or detailed command usage |
| `/bee-insert-phase` | `N.M "phase description"` | Insert a decimal-numbered phase between existing phases |
| `/bee-next` | | Detect workflow state and dispatch the next logical command |
| `/bee-note` | `[text] \| list \| promote [N]` | Capture, list, or promote zero-friction notes |
| `/bee-pause` | | Pause work and create a resumable handoff |
| `/bee-profile` | | Profile behavioral preferences across eight dimensions |
| `/bee-quick-phase` | `[--review] [--amend [N]] [--mode=quick\|phase\|plan-only] [description]` | Plan and execute a lightweight single-phase spec |
| `/bee-seed` | `"idea" --trigger "condition"` | Capture a deferred idea with an auto-surfacing trigger |
| `/bee-swarm-review` | `[path] [review filters] [--team\|--no-team]` | Run segmented multi-agent review with evidence validation |
| `/bee-test-gen` | `[phase-number]` | Generate behavioral tests from requirement coverage gaps |
| `/bee-thread` | `new\|list\|resume\|close [name]` | Manage persistent cross-session knowledge threads |
| `/bee-ui-review` | `[phase-number]` | Run a six-pillar visual implementation review |
| `/bee-ui-spec` | `[phase-number or name]` | Generate a UI design and accessibility contract |
| `/bee-workspace` | `[action] [name] [args]` | Manage isolated workspaces for parallel feature development |

## Workflows

### Full Feature Workflow (Spec to Done)

```
1. /bee-init                    # One-time project setup (stack detection, notifications, context extraction)
2. /bee-discuss                 # Optional: brainstorm ideas before formal spec
3. /bee-new-spec                # Adaptive discovery, spec-writer, spec-review loop
4. /bee-plan-phase 1            # 3-pass planning (decompose → research → waves) + auto-fix review loop
5. /bee-execute-phase 1         # Parallel TDD implementation (wave-based)
6. /bee-review                  # 4-agent review + validate + auto-fix
7. /bee-test                    # Manual test scenarios
8. /bee-test-e2e                # Optional: Playwright E2E tests
9. /bee-commit                  # Reviewed commit
   --- repeat steps 4-9 for each phase ---
10. /bee-review-implementation  # Final spec compliance check (5 agents including audit-bug-detector)
11. /bee-archive-spec           # Archive and reset
```

### Multiple Specs in Parallel

`/bee-new-spec` always creates a new spec without touching the currently focused one. Use `/bee-spec promote <slug>` to move a spec into its own git worktree for isolated execution, then `/bee-workspace complete` to merge back.

### Autonomous Pipeline Workflow (Walk Away)

```
1. /bee-init                    # One-time setup
2. /bee-new-spec                # Adaptive discovery + spec creation
3. /bee-plan-all                # Plan ALL phases + cross-plan consistency review (autonomous)
4. /bee-ship                    # Execute all → review each → final review (fully autonomous)
   --- walk away, come back to shipped feature ---
5. /bee-commit                  # Review decision log, commit
```

`/bee-ship` is fully autonomous: zero AskUserQuestion during pipeline, structured decision logging, optimistic continuation on max review iterations, resumable after crash. Cross-plan review catches inter-phase bugs (data contract mismatches, dependency chain breaks) that per-phase reviews miss.

### Quick Task Workflow (No Spec)

```
/bee-quick fix the login button alignment     # TDD default (researcher + implementer agents)
/bee-quick --fast fix the button color         # Direct mode (inline, no agents)
/bee-quick --amend 3                           # Modify existing quick task plan #3
/bee-quick --review refactor auth middleware    # Execute + 4-agent review before commit
```

### Code Audit Workflow (Vibecoded Project Takeover)

```
1. /bee-init                                   # Initialize Bee on the inherited project
2. /bee-audit                                  # Full 9-agent parallel audit
   --- 9 specialists scan → validator filters → report generated ---
3. /bee-audit-to-spec                          # Convert findings into specs by severity
   --- CRITICAL → individual specs, HIGH → grouped, MEDIUM → cleanup, LOW → consolidated ---
4. /bee-new-spec --from-discussion .bee/audit-specs/critical-{slug}.md   # Fix critical issues first
5. /bee-plan-phase 1 → execute → review → test → commit             # Standard Bee pipeline per fix
```

Selective auditing:
```
/bee-audit --only security,database            # Run specific audit agents only
/bee-audit --skip-validation                   # Skip hallucination filtering (faster)
/bee-audit-to-spec --critical                  # Generate specs for CRITICAL findings only
/bee-audit-to-spec --dry-run                   # Preview what specs would be created
```

## Agents (33)

### Core Agents
| Agent | Role | Model |
|-------|------|-------|
| **implementer** | TDD full-stack implementation with defense-in-depth | inherit |
| **quick-implementer** | TDD-enforced implementer for quick tasks | inherit |
| **fixer** | Minimal targeted fixes with root cause investigation | inherit |
| **researcher** | Codebase patterns, Context7 docs, reusable code | inherit |
| **spec-writer** | Write spec and phase breakdown from requirements | inherit |
| **spec-shaper** | Interactive requirements gathering (amend mode) | inherit |
| **spec-reviewer** | Validate spec completeness, consistency, clarity, YAGNI | inherit |
| **phase-planner** | Decompose phases into tasks and waves | inherit |
| **plan-reviewer** | Review plan coverage against spec | inherit |
| **discuss-partner** | Codebase-grounded brainstorming (scan + write-notes modes) | inherit |
| **context-builder** | Scan codebase, extract patterns into CONTEXT.md | inherit |

### Review Agents (4 Specialists + Validator)
| Agent | Role | Model |
|-------|------|-------|
| **bug-detector** | Bugs, logic errors, security vulnerabilities | inherit |
| **pattern-reviewer** | Deviations from established project patterns | inherit |
| **plan-compliance-reviewer** | Spec compliance, cross-phase integration, requirements tracking | inherit |
| **stack-reviewer** | Stack-specific best practice violations (dynamically loaded skill) | inherit |
| **finding-validator** | Classify findings as real bug / false positive / stylistic | inherit |

### Audit Agents (11 — used by `/bee-audit`)
| Agent | Prefix | Role |
|-------|--------|------|
| **security-auditor** | SEC | OWASP Top 10, auth bypass, injection, secrets exposure, CORS/CSRF |
| **error-handling-auditor** | ERR | Missing error handling, crash vectors, silent failures, happy-path-only code |
| **database-auditor** | DB | Schema design, N+1 queries, missing indexes, transactions, data integrity |
| **architecture-auditor** | ARCH | Separation of concerns, god files, code duplication, dependency patterns |
| **api-auditor** | API | Endpoint validation, response consistency, rate limiting, CORS config |
| **frontend-auditor** | FE | Missing UI states, memory leaks, accessibility, form handling, performance |
| **performance-auditor** | PERF | Bundle size, caching, async bottlenecks, resource optimization |
| **testing-auditor** | TEST | Coverage gaps, test quality, stale tests, test infrastructure |
| **audit-bug-detector** | BUG | End-to-end flow tracing, cross-layer bugs, contract mismatches |
| **audit-finding-validator** | — | Validates findings against actual code, filters hallucinations (CONFIRMED / FALSE POSITIVE / NEEDS CONTEXT) |
| **audit-report-generator** | — | Merges validated findings into AUDIT-REPORT.md + audit-findings.json |

### EOD Agents
| Agent | Role | Model |
|-------|------|-------|
| **test-planner** | Generate manual test scenarios | inherit |
| **test-auditor** | Audit test suite health | inherit |
| **integrity-auditor** | Verify STATE.md matches disk reality | inherit |

### Stack-Specific Agents
| Agent | Stack | Role |
|-------|-------|------|
| **laravel-inertia-vue-bug-detector** | laravel-inertia-vue | Stack-specific bug detection |
| **laravel-inertia-vue-pattern-reviewer** | laravel-inertia-vue | Stack-specific pattern review |
| **laravel-inertia-vue-implementer** | laravel-inertia-vue | Stack-specific TDD implementation |

## Implementation Modes

Three modes control which model tier each agent uses:

| Agent Role | Economy | Quality (default) | Premium |
|-----------|---------|-------------------|---------|
| Scanning/planning (researcher, planner, spec-writer, etc.) | sonnet | sonnet | opus |
| Critical (implementer, review agents, fixer, finding-validator) | sonnet | opus | opus |

Set via `config.implementation_mode` in `.bee/config.json` or during `/bee-new-spec` discovery.

## Stack Skills (10)

| Stack | Detection | Words | Notes |
|-------|-----------|-------|-------|
| **laravel-inertia-vue** | composer.json + vue | 5,428 | Gold standard. 3 stack-specific agents |
| **laravel-inertia-react** | composer.json + react | 5,162 | React 19, useForm, Inertia deep dive |
| **nestjs** | @nestjs/core | 4,320 | Custom decorators, Prisma/TypeORM, GraphQL, Swagger |
| **vue** | package.json has vue (no Laravel) | 4,146 | Composition API, Pinia, Vue Router 4, VeeValidate+Zod |
| **nextjs** | package.json has next | 3,597 | App Router, Server Actions, Next.js 15 caching |
| **react** | package.json has react (no next/expo) | 3,311 | React 19 hooks, Router v7, Suspense, state detection |
| **angular** | @angular/core | 2,416 | Signals, standalone, OnPush, inject(), modern control flow |
| **react-native-expo** | expo + react-native | 2,308 | Expo Router, native modules, platform-specific patterns |
| **kmp-compose** | build.gradle.kts multiplatform | 2,227 | Compose Multiplatform, Voyager, Koin, Ktor |
| **claude-code-plugin** | manual | 2,366 | Meta-stack for developing bee itself |

### Library Skills (Auto-Detected)

| Library | Detection | Notes |
|---------|-----------|-------|
| **shadcn-ui** | `components.json` or `@/components/ui/` | Component patterns, theming, cn() utility, composition |
| **nestjs-rabbitmq** | `@nestjs/microservices` + `amqplib` | Transport config, message patterns, ACK, DLQ, CQRS |
| **playwright** | Invoked by `/bee-test-e2e` | POM, fixtures, selectors, assertions, auth, network mocking |

### Audit Skill

| Skill | Scope | Notes |
|-------|-------|-------|
| **audit** | All audit agents | Severity definitions (CRITICAL/HIGH/MEDIUM/LOW), finding format with agent prefixes, validation rules, report template, spec generation rules |

### Standard Skills (Always Active)

| Skill | Scope | Notes |
|-------|-------|-------|
| **frontend-standards** | All frontend stacks | Component architecture, a11y, responsive, design quality, CSS methodology |
| **core** | All agents | TDD Iron Law, disk-is-truth, no auto-commit, firm rules R1-R9, model delegation, Context7 integration |

## Claude Code Hooks

| Event | Purpose |
|-------|---------|
| **SessionStart** | Load project context (STATE.md, config) + configure statusline |
| **PostToolUse** | Auto-lint modified files after Write/Edit |
| **PreToolUse** | Pre-commit validation gate — linter + test checks |
| **PreCompact** | Snapshot session context before compaction |
| **SubagentStart** | Inject user preferences from `.bee/user.md` (cross-platform, strips `bee:` prefix) |
| **SubagentStop** | Validate agent output — 24 role-specific validators (TDD red-green cycle, evidence chain, output format, completeness, audit finding format) |
| **Stop** | Check for unreviewed executed phases |
| **SessionEnd** | Session summary |

## Claude Code Notifications (Optional)

`/bee-init` offers to enable native push notifications:
- **macOS**: osascript (built-in)
- **Linux**: notify-send (requires libnotify)
- **Windows**: PowerShell toast notifications

Events: task completed (Stop), background agent finished (Notification), permission needed (PermissionRequest).

## Configuration

```json
{
  "stacks": [
    { "name": "laravel-inertia-vue", "path": ".", "linter": "pint", "testRunner": "pest" },
    { "name": "nestjs", "path": "api", "linter": "eslint", "testRunner": "jest" }
  ],
  "implementation_mode": "quality",
  "ci": "github-actions",
  "context7": true,
  "review": {
    "against_spec": true,
    "against_standards": true,
    "dead_code": true,
    "loop": false,
    "max_loop_iterations": 3
  },
  "phases": { "require_review_before_next": true },
  "ship": { "max_review_iterations": 3, "final_review": true },
  "quick": { "review": false, "fast": false }
}
```

## License

MIT
