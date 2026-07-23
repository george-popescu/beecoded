# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [5.0.0] - 2026-07-17 -- Prefixed standalone commands

### Changed
- Replaced the plugin-namespaced public command surface with standalone `bee-*` skills: `/bee-init`, `/bee-plan-phase`, and the rest of the 51-workflow roster on Claude Code, with `$bee-*` equivalents on Codex.
- The npm installer now materializes every entry into the selected host's user skill directory, backed by the durable managed package under `~/.beecoded/`.
- Plugin manifests retain Bee's hooks and agents but no longer auto-register public or internal skills.

### Safety
- Installation preflights the complete skill roster and refuses to overwrite an unowned same-named user skill before staging or host mutation.
- Update, downgrade, dry-run, host selection, and uninstall manage only entries marked as owned by `@beecoded/bee`.

### Breaking
- Removed the previous colon-style command names. Re-run `npx @beecoded/bee@latest` and use the new `bee-*` commands.

## [4.9.1] - 2026-07-15 -- Built-in compact autocomplete fix

### Fixed
- Renamed Bee's context-preservation command from `/bee:compact` and `$bee:compact` to `/bee:checkpoint` and `$bee:checkpoint`. Claude Code autocomplete can now resolve its built-in `/compact` command without Bee offering a competing command name.
- Kept the existing checkpoint workflow intact: it saves `COMPACT-CONTEXT.md`, then directs the user to run the host's built-in `/compact` command.
- Added package validation that rejects any future `compact` Bee workflow or skill directory.

## [4.9.0] - 2026-07-14 -- One-command npm installer

### Added
- Added the `bee` npm executable and the `npx @beecoded/bee@latest` installation flow.
- The installer detects Claude Code and Codex in `PATH`, installs into both when available, and supports `--claude`, `--codex`, `--all`, `--dry-run`, and `uninstall`.
- Added a persistent managed marketplace under `~/.beecoded/marketplaces/bee`, so temporary npx directories are never registered with either host.
- Added automated installer coverage for dual-host install, repeatable update, uninstall, explicit host selection, and dry-run behavior.

### Changed
- Manual marketplace registration is now an internal implementation detail; users install and update Bee through the npm runner.

## [4.8.3] - 2026-07-14 -- Claude plugin discovery fix

### Fixed
- Removed the unnecessary custom `agents` directory declaration from the Claude plugin manifest. Claude Code now uses its default root-level agent discovery and loads the plugin skills normally.
- Added native Claude Code manifest validation to the release verification performed for this patch.

## [4.8.2] - 2026-06-21 -- Faster meta-test runner

### Changed
- The meta-test runner (`run-meta-tests.js`) now runs suites in a bounded concurrency pool instead of one at a time, cutting a full local run from ~49s to ~33s. Performance suites that measure real wall-clock run isolated first (on a quiet machine) so their measurements stay accurate, and the pre-commit gate's budgeted path is unchanged. Override the pool size with `BEE_META_CONCURRENCY`.
- Plugin version: 4.8.1 → 4.8.2 (`plugins/bee/.claude-plugin/plugin.json`)
- Marketplace version: 1.10.1 → 1.10.2 (`.claude-plugin/marketplace.json` lockstep)

## [4.8.1] - 2026-06-20 -- Execution speed

### Changed
- Faster agent validation in normal use: the per-agent SubagentStop validators only act during autonomous runs, so in manual runs a lightweight shell gate now skips starting Node entirely. A review or audit that stops many agents no longer pays a Node start per agent. (The gate checks for an active autonomous run under either candidate project root, so validation is never skipped while one is running.)
- `/bee:audit` quality mode runs all ten auditors in a single parallel batch instead of two sequential batches — the end-to-end bug detector and the integration checker scan the codebase themselves and consume no output from the other auditors, so they no longer wait on a first batch to finish.
- Less per-command overhead: the "resolve which spec this command acts on" procedure shared by `/bee:plan-phase`, `/bee:execute-phase`, `/bee:ship`, `/bee:discuss`, `/bee:archive-spec`, and `/bee:complete-spec` is now single-sourced in the command-primitives skill — identical behavior with less duplicated instruction text loaded on each run.
- Plugin version: 4.8.0 → 4.8.1 (`plugins/bee/.claude-plugin/plugin.json`)
- Marketplace version: 1.10.0 → 1.10.1 (`.claude-plugin/marketplace.json` lockstep)

## [4.8.0] - 2026-06-20 -- Bee Multi-Spec — parallel specs, per-spec memory, worktree promotion, dashboard

### Added
- Multi-spec support: bee now tracks multiple concurrent active specs in a `.bee/specs.json` registry, each with its own state and phases. `/bee:spec list` shows them, `/bee:spec use <slug>` focuses one for this chat, `/bee:spec status` reports the focused spec. Single-spec projects are unaffected (byte-for-byte the same).
- Per-spec memory: each spec can carry `.bee/specs/<slug>/memory.md` with guidance that is injected into agents while that spec is the active one. View and edit it with `/bee:memory`.
- Worktree promotion: promote any active spec to its own git worktree with `/bee:spec promote <slug>` to build it in parallel; merge back with `/bee:workspace complete`.
- Execute-time guard: starting a second spec's execution in the same tree now offers to promote it to a worktree, queue it, or pause the other — never a hard stop.
- Multi-spec dashboard: the hive dashboard and `/bee:spec dashboard` now show every active spec — its stage, whether it's in-place or in a worktree, and last activity — not just the last-touched one.

### Changed
- `/bee:memory` now manages both global preferences (`user.md`) and the active spec's memory.
- `/bee:health` now validates the multi-spec registry (per-spec snapshots, promoted-worktree locations, orphaned entries); `/bee:update` backfills the spec registry for existing single-spec projects on upgrade.
- Performance: the dashboard activity-feed hook no longer cold-starts Node on every tool call — a tiny shell gate boots Node only when a consumer (the hive dashboard or an autonomous run) is actually reading events. The redundant pre-tool-use event was dropped (the dashboard already hid it) and the team-collaboration validators fast-exit when Agent Teams is disabled. No change to linting, the commit gate, or the per-agent validators.
- Internal: the 25 per-agent SubagentStop validators are now routed by a single in-process dispatcher instead of 25 separate hook entries — identical validation (proven by an equivalence test), fewer moving parts in `hooks.json`.
- Plugin version: 4.7.0 → 4.8.0 (`plugins/bee/.claude-plugin/plugin.json`)
- Marketplace version: 1.9.2 → 1.10.0 (`.claude-plugin/marketplace.json` lockstep)

### Removed
- Retired the unused project-global agent-memory archiving (`.bee/memory/` and `archive-memory.sh`). `user.md` remains the global persistent memory; per-spec memory now lives with each spec.

---

## [4.5.2] - 2026-06-03 -- Bee Velocity — Conversation context capture + per-install MCP tool discovery

Two context-fidelity fixes. First, bee commands no longer lose the conversation when they hand work to subagents. Second, bee's Context7 and Laravel Boost integrations now work regardless of how those MCP servers were installed.

### Added
- **Conversation Context Capture primitive (`skills/command-primitives/SKILL.md`):** before spawning any subagent, the orchestrator distills the live conversation into three buckets — Decisions (what was agreed), Constraints (what bounds the work), and Ruled-out (rejected alternatives and why) — and propagates them. Previously, running `/bee:quick`, `/bee:quick-phase`, `/bee:new-spec`, or `/bee:discuss` after discussing a feature in chat passed only the short task description to the spawned agents; every decision and constraint agreed in conversation was dropped. A hybrid confirmation gate keeps it low-friction: small extractions (≤5 points) are injected silently; larger ones surface for Accept / Edit / Skip / Custom review. A source boundary limits capture to conversation after the most recent state-loading command (`/bee:resume`, `/bee:thread`, `/bee:progress`) so already-persisted context isn't re-injected, and an empty extraction is a silent no-op.
- **Wired into four entry-point commands** (`/bee:quick`, `/bee:quick-phase`, `/bee:new-spec`, `/bee:discuss`): each writes captured context into its plan/notes artifact as a `## Conversation Context` section and injects a `## Prior Discussion` block into every spawned subagent prompt. Single-task commands filter against the one task; multi-task commands capture against the whole feature, then slice the relevant subset into each task's subagent. `/bee:new-spec` respects the source boundary so a discussion file loaded via `--from-discussion` isn't double-captured from chat.
- **Per-install MCP tool discovery (`config.mcp`):** bee previously hardcoded `mcp__context7__*` and `mcp__laravel-boost__*` tool names, so projects where those servers were installed under a different name (e.g. Anthropic's Context7 plugin, which exposes a differently-named tool) silently lost the integration. `/bee:init` and `/bee:refresh-context` now discover the actual tool names (via tool introspection), fingerprint-match them to capabilities, and record them in a new `config.mcp` section. The `researcher` and `phase-planner` agents resolve Context7 through config instead of a hardcoded name; the shared `context7` skill keeps the canonical name as a fallback default so agents with restricted toolsets keep working. Laravel Boost resolution is config-driven in both Laravel stack implementers, with graceful fallback to `php artisan` over Bash when unavailable. Nothing hard-fails when an MCP server is absent.

### Changed
- Plugin version: 4.5.1 → 4.5.2 (`plugins/bee/.claude-plugin/plugin.json`)
- Marketplace version: 1.9.1 → 1.9.2 (`.claude-plugin/marketplace.json` lockstep)

---

## [4.5.1] - 2026-05-13 -- Bee Velocity — /bee:quick-phase command + thinking-principles surfacing

Adds a new command that fills the gap between `/bee:quick` (single task) and `/bee:new-spec` (full ceremony) — generates a single TASKS.md with research-enriched tasks and wave plan, with three execute paths (quick / phase / plan-only).

### Added
- **`/bee:quick-phase` command — single-phase spec generator with wave execution:** fills the gap between `/bee:quick` (single task, no wave dependencies) and `/bee:new-spec` (full spec/requirements/phases ceremony). Generates a single TASKS.md (no separate spec.md / requirements.md / phases.md) with research-enriched tasks + wave plan. Composes existing primitives: lightweight researcher pass for codebase context + `bee:phase-planner` merged-Pass-1 decompose+research + plan-checker static pre-filter + optional 4-agent plan-review (with Review Quality Rules operational expansions copied verbatim from `/bee:plan-phase` Step 6). Offers 3 execute paths via interactive menu OR `--mode=` flag: (a) **quick** — TDD implementers wave-by-wave, parallel intra-wave, no per-wave aggregate-validate gates (faster, for small phases); (b) **phase** — full per-wave aggregate-validate via the execute-phase wave loop (safer, for 3+ wave phases); (c) **plan-only** — stop after TASKS.md, defer execution. Flags: `--review` (4-agent code review before commit), `--amend N` (re-execute prior quick-phase), `--no-plan-checker`. Tracked in STATE.md Quick Tasks table with `[quick-phase]` description prefix. Paired-contract pinning enrolls `quick-phase.md` in 6 cross-cutting rosters (VG_COMMANDS, BTG_AUTONOMOUS, CC_COMMANDS, MSI_REASONING, MSI_SCANNING, AFL_AUTONOMOUS) + MIN_REFERENCES to prevent inline-boilerplate drift.
- **`/bee:update` and `/bee:init` surface `thinking-principles` skill awareness:** both commands now display a reminder that the `thinking-principles` skill (R7 Surface Conflicts / R8 Read Before Write / R9 Test Intent / R12 Fail Visibly) is auto-loaded for 6 consumer agents (implementer, quick-implementer, researcher, bug-detector, pattern-reviewer, fixer) via their `skills:` frontmatter — and is critical to bee's review/fix quality. Raises developer awareness of the rules that drive agent output ("Rule 7" / "Rule 8" / "Rule 12" inline callouts).

### Changed
- Plugin version: 4.5.0 → 4.5.1 (`plugins/bee/.claude-plugin/plugin.json`)
- Marketplace version: 1.9.0 → 1.9.1 (`.claude-plugin/marketplace.json` lockstep)

---

## [4.5.0] - 2026-05-12 -- Bee Velocity — Validator optimization: Node-script SubagentStop validators + batch aggregation + autonomous-flag opt-out

**User-facing speedup — `/bee:plan-phase` and `/bee:plan-all` are the primary beneficiaries.** Before v4.5.0, every spawned subagent (phase-planner / researcher / 4-agent review / 3-analyzer / cross-plan agents) triggered an LLM-prompt validator on SubagentStop costing ~200-500 tokens + 2-8s wallclock per agent. A typical `/bee:plan-all` run on a 2-phase spec with 3-iteration plan-reviews accumulates **~3-5 minutes of pure validator-LLM overhead** before the subagents do their actual work. After v4.5.0, the same validators run as deterministic Node scripts in 20-26ms p95 each (NFR-02 budget 200ms, ~174ms headroom) — that's **~99% reduction in validator-attributable wallclock and zero token cost on the validator path**. Phase 2's batch aggregation additionally collapses N per-agent SubagentStop hooks into a single batch verdict per parallel-spawn wave at 15 aggregation points across 7 parent commands. Subagent-LLM cost (the agent's actual planning work) is unchanged — this release fixes the validator overhead, not the planning compute itself.

### Added
- **Node-script SubagentStop validators (Phase 1, REQ-01 + REQ-03 + NFR-02):** Node-script validators replace **24 retained** prompt validators (3 redundant matchers removed entirely per REQ-03 — `spec-reviewer`, `discuss-partner`, `ui-auditor`; zero token cost; <200ms p95 Mac/Linux; cross-platform). 24 dedicated validator scripts live at `plugins/bee/scripts/hooks/validators/<agent>.js` with matching paired-contract pinning in `scripts/tests/hooks-validators-rewire.test.js` (509/509 tests across Phase 1; p95 wallclock 20-26ms with 174ms headroom inside the NFR-02 200ms budget). Each validator parses the agent's final transcript message via the shared `parseStopHook(payload)` helper and emits a structured `Validation:` verdict consumed by downstream review/audit pipelines. Per-validator matcher hash pinned at `scripts/hooks/validators/_matcher-hash.txt` so any regex drift is caught by the test before it ships. (REQ-01, REQ-03, NFR-02)
- **Batch aggregation at 15 parallel-spawn insertion points across 7 parent commands** (audit / ship / execute-phase / review / review-implementation / plan-phase / plan-all) — each batch validator at `plugins/bee/scripts/hooks/validators/batch/<insertion-point>.js` collects per-agent verdicts from the same wave and emits a single aggregate `Validation:` verdict, eliminating N round-trips on N-agent spawns. Aggregate verdict becomes the authoritative blocking signal; per-agent verdicts remain as opportunistic checks. Shared foundation at `scripts/hooks/validators/batch/batch-lib.js` (101/101 tests in `scripts/tests/validator-batch-lib.test.js`); 15 batch validator scripts ship with 79 paired-contract assertions in `scripts/tests/validator-batch-paired-contract.test.js` plus 106 cross-cutting assertions in `scripts/tests/command-primitives-batch-integration.test.js` (parent-command refs / flag wiring / marker-skip uniformity audit) — 185/185 batch coverage. (REQ-09)
- **`--no-aggregate-validate` flag on 4 autonomous commands** (`commands/ship.md`, `commands/plan-all.md`, `commands/audit.md`, `commands/execute-phase.md`) using the exact-token regex from v4.4.0 F-004 (collision-resistant against neighboring tokens). Distinct from existing `--skip-validation` flag on `audit.md` (per F-STD-004 iter 1 collision-avoidance rename). Lets autonomous runs opt out of the aggregation pass when the human caller has already verified upstream. (REQ-11)
- **Auto-Mode Marker conditional skip in interactive mode (REQ-10):** all 15 batch validators inline a `markerSkipPrelude(payload);` statement-form prelude that detects the `.bee/.autonomous-run-active` marker and short-circuits the validator when running inside an autonomous pipeline — interactive `/bee:execute-phase`, `/bee:review`, etc. still enforce the full aggregate verdict. Canonical statement-form regex `/^\s*markerSkipPrelude\s*\(\s*payload\s*\)\s*;\s*$/m` pinned across the 15 batch validators (rejects predicate-use and assignment forms) per iter 1 FIX 11. (REQ-10)
- **`emit-event.js` per-event `hookDurationMs` field (NFR-03):** SubagentStop telemetry now records wallclock duration of the hook itself (distinct from the tool's reported `durationMs`) so the v4.5 baseline-vs-Node-validator wallclock-savings comparison can be measured from `.bee/events/<today>.jsonl` without a separate trace harness. camelCase field naming per existing schema (iter 1 FIX 9 renamed from `hook_duration_ms`). 30/30 tests in `scripts/tests/hooks-emit-event-duration.test.js`. (NFR-03)
- **`emit-event.js` autonomous-marker bypass (REQ-09 Q5 fallback + NFR-03):** when `.bee/.autonomous-run-active` is present, the event is written unconditionally — the existing `.hive-pid` guard is bypassed so `.bee/events/<today>.jsonl` is reliably populated during autonomous runs even when no dashboard owns the file. Resolves the REQ-09 Q5 fallback transcript-path source for batch validators. (NFR-03, REQ-09)
- **Conductor-sole-writer static source check (REQ-12):** `scripts/tests/validator-batch-no-write.test.js` statically asserts zero `fs.writeFileSync` / `fs.appendFileSync` calls inside the 15 batch validators — validators are pure read-aggregate-emit; only the conductor mutates `.bee/` state. 98/98 assertions across the 15-validator roster. (REQ-12)
- **Static plan-checker (pre-LLM TASKS.md validator):** new deterministic Node CLI at `plugins/bee/scripts/plan-checker.js` runs BEFORE the 4 LLM plan-review agents in `/bee:plan-phase` (new Step 5.5) and `/bee:plan-all` (new Step 3f.1.5). Detects 7 mechanical drift classes — (1) same-wave file-ownership conflicts (CRITICAL), (2) dangling `needs` references (HIGH), (3a) missing `wave:` field (HIGH), (3b) wave gaps + forward-references (MEDIUM), (4) `REQ-NN`/`NFR-NN` anchors missing from `requirements.md` (MEDIUM), (5) missing `files_touched` field (MEDIUM), (6) `depends_on:` typo (HIGH, canonical field is `needs:`), (7) empty/TBD/TODO acceptance (MEDIUM). Parser upgraded to coalesce multi-line `acceptance:` and `files_touched:` sub-bullets (the real v4.5.0 Phase 1 + Phase 2 TASKS.md style) so Check 7 doesn't false-positive on indented bullets. Read-only — never writes TASKS.md. Side artifact: `plan-checker-report.md` next to TASKS.md. Exit codes: 0=clean, 1=issues, 2=internal error (callers FAIL-OPEN). Suppression marker `<!-- plan-checker-allow: F-PC-NNN reason -->` supports file-wide AND task-bound scopes. Findings injected into the 4-agent plan-review context packets under `PRE-LLM PLAN-CHECKER FINDINGS` so LLM reviewers confirm/escalate/dismiss each item. `--no-plan-checker` flag on `/bee:plan-all` (autonomous opt-out following the v4.4.0 `--no-aggregate-validate` exact-token pattern); plan-phase is interactive and excluded per REQ-11. Wallclock: 20-21ms p95 on a 50-task fixture (vs the 500ms ceiling). `formatReport` shape satisfies the 7 bug-detector regex contracts (`## Bugs Detected` heading + severity subsections + backtick `file:line` references + total tally + Evidence/Impact/Test Gap per finding). 107/107 tests in `scripts/tests/plan-checker.test.js` + 12 paired-contract assertions in `scripts/tests/command-primitives.test.js` (script-existence + literal-presence in both plan-phase.md and plan-all.md + negative `--no-plan-checker` exclusion in plan-phase per REQ-11). ROI: ~5-7 mechanical findings per plan-review iteration caught deterministically in 20ms instead of 200-500 tokens per LLM round-trip, freeing the 4-agent review for semantic concerns only.
- **Fixer agent self-verification:** new Section 4.5 in `plugins/bee/agents/fixer.md` mandates a deterministic self-check after every Edit/Write per a 5-class taxonomy (Remove X / Add Z / Replace X→Z / Rename A→B across N files / Structural inserts) with a retry-once protocol on failure. Same-class enumeration is required for cross-file fixes — when the finding mentions "across N sites" / "all callers", the fixer enumerates all matching sites BEFORE applying any fix, then verifies each one after. Fix Report template extended with a `Verification: PASS | FAILED — <reason> | N/A` field. Catches mechanical fixer failures (typos in Edit pattern, partial application across multiple sites, wrong regex) BEFORE the next review iteration rediscovers them.
- **Mid-pipeline cross-plan consistency review:** `/bee:plan-all` now runs cross-plan consistency review INCREMENTALLY after each phase's plan-review converges (not just once at the end). Each iteration checks `[Phase 1..N]` together so cross-phase issues are caught as soon as Phase N's plan stabilizes — earlier phases never need re-review for cross-cutting drift. A final single-iteration verification pass runs after all phases plan-review, expected to find zero issues (HALTs with diagnostic otherwise). Decision log markers `[Cross-plan mid-pipeline]` per phase and `[Cross-plan final-verification]` at end; the legacy `[Cross-plan consistency review]` marker still emitted alongside to preserve `/bee:ship` inherit-mode detection.
- **Reviewer/fixer rigorous deduplication:** `/bee:review`, `/bee:plan-phase`, `/bee:plan-all`, and `/bee:swarm-review` consolidation steps now apply 3 additional dedup rules beyond the legacy "same file + line range within 5" baseline: (1) root-cause signature match (≥80% body text overlap OR identical `Suggested Fix:` snippet), (2) shared REQ-NN/NFR-NN citation, (3) cross-agent same-class consensus (3+ agents flagging the same file:line area). Merged findings are recorded in a new `## Consolidation Log` section in REVIEW.md preserving the audit trail. Cuts duplicate fixer agent spawns per review iteration when multiple agents independently flag the same root defect.
- **Plan-phase Pass 1 + research merged:** the `bee:phase-planner` agent's Pass 1 (decompose spec into tasks) now also performs codebase research inline using Grep + Read + Context7 docs, producing a research-enriched TASKS.md in one pass instead of two. `/bee:plan-phase` and `/bee:plan-all` per-phase loops drop the separate researcher spawn — net effect is one fewer subagent invocation per phase planned. Pass 2 (wave assignment) consumes the already-research-enriched output unchanged. Estimated ~1-2 minutes saved per `/bee:plan-phase` invocation.

### Changed
- **`hooks.json` SubagentStop block rewired (REQ-02, REQ-05):** every `type:"prompt"` entry replaced with `type:"command"` invoking `node ${CLAUDE_PLUGIN_ROOT}/scripts/hooks/validators/<agent>.js`. Matcher regexes preserved verbatim (matcher hash pinned at `scripts/hooks/validators/_matcher-hash.txt` and validated by `hooks-validators-rewire.test.js`). Zero `type:"prompt"` entries remain in the SubagentStop block; 25 `type:"command"` entries total = 24 per-agent validators + 1 terminal catch-all `emit-event.js` telemetry entry retained at end-of-block per REQ-05. (REQ-02, REQ-05)
- **`commands/ship.md` aggregate-validate failure handling tightened from log-and-continue-optimistically to HALT-with-error** (iter 1 FIX 3) — consistent with audit/review/plan-phase/plan-all, per Rule 12 Fail Visibly and REQ-09 "aggregate verdict is the authoritative blocking signal". Removes the prior optimistic-continuation path where a failed aggregate validation would log and proceed silently into commit. (REQ-09)
- Plugin version: 4.4.0 → 4.5.0 (`plugins/bee/.claude-plugin/plugin.json:3`)
- Marketplace version: 1.8.0 → 1.9.0 (`.claude-plugin/marketplace.json` lines 4 + 14, lockstep)

### Removed
- **`spec-reviewer`, `discuss-partner`, `ui-auditor` SubagentStop hook entries removed entirely (REQ-03):** these three agents' output was already visible in the main caller's context window (spec-writer, discuss flow, ui-review flow respectively), so the SubagentStop validator round-trip added zero verification value — the caller can read the agent output directly. Removing the matchers shrinks the SubagentStop block from 27 entries to 24 per-agent validators + 1 catch-all telemetry entry. The agents themselves (`agents/spec-reviewer.md`, `agents/discuss-partner.md`, `agents/ui-auditor.md`) remain unchanged and continue to be spawned by their owning commands. (REQ-03)

### Reviews
Phase 1 (REVIEWED): 24 Node validators + 8 test files + `hooks.json` LIVE-rewired with 509/509 tests passing; review iteration 1 surfaced 2 MEDIUM findings (both fixed inline); iteration 2 came back CLEAN. Phase 2 (REVIEWED via test-coverage-based predicate): 414+ new assertions across 5 dedicated test files cover the surfaces a code-review pass would check — 185/185 batch paired-contract + integration (T2.10) + 98/98 no-write static scan (T2.9) + 30/30 emit-event duration + autonomous-marker bypass (T2.11) + 101/101 batch-lib foundation (T2.1). Cross-plan consistency review (F-CP-001 through F-CP-009) caught a count-mismatch contract drift before it could ship into the v4.5 release artifacts — load-bearing "24 retained" wording locked into the spec, plan, and this CHANGELOG entry in lockstep.

## [4.4.0] - 2026-05-12 -- Speed wins for implementation + review pipeline

### Added
- **Thinking Principles skill** (Quick 019, cross-cutting): new `plugins/bee/skills/thinking-principles/SKILL.md` curates 4 meta-rules (R7 Surface Conflicts, R8 Read Before Write, R9 Test Intent, R12 Fail Visibly) from Forrest Chang's "beyond Karpathy 1-4" rule set. 6 of the published rules rejected as REDUNDANT with existing bee surfaces (R1 = discuss/plan pipeline; R2 = implementer Section 2 simplicity; R3 = surgical-changes Section 2; R4 = TDD Red-Green-Refactor; R10 = STATE.md/TASKS.md/wave checkpointing; R11 = pattern/stack-reviewer agents). R5/R6 are unused in the source taxonomy (numbering = Karpathy 1-4 + author's R7-R12, no R5/R6 in either set). Skill is referenced via canonical Path A form (``See `skills/thinking-principles/SKILL.md` Rule N (<title>).``) in 6 consumer agents with role-specific rule selection: `agents/implementer.md` + `agents/quick-implementer.md` (R8 + R9 + R12), `agents/researcher.md` (R8), `agents/bug-detector.md` (R7 + R12), `agents/pattern-reviewer.md` (R7), `agents/fixer.md` (R12). Each consumer also lists `thinking-principles` in its `skills:` frontmatter so SubagentStart auto-loads the skill (precedent: bug-detector lists `review`, fixer lists `context7` matching their body references). Paired-contract test pinning via new `THINKING_PRINCIPLE_CONSUMERS` roster in `scripts/tests/command-primitives.test.js` (45 new assertions covering rule-section presence + negative no-leak for excluded rules + per-consumer frontmatter + body reference + rule-naming + Section 2.X stale-text guard + escaped-backtick canonical-example guard + plan-file existence). Plan file at `.bee/quick/019-thinking-principles-skill.md` (backfilled retroactively per pattern-reviewer PAT-003). Dogfood pattern identical to Context Cache primitive: single canonical site, distributed references, paired-contract test pinning. 4-agent review gate run AFTER initial implementation caught 4 HIGH + 4 MEDIUM findings (STATE.md row corruption + missing frontmatter loading + un-escaped backticks in skill preamble + missing plan file + stale Section 2.X + R5/R6 accounting + test readFile() helper + CHANGELOG D-sequence placement) — all 8 fixed dogfood-style before commit.
- **D5 — PHPStan cache warm** (REQ-08, NFR-04): `commands/execute-phase.md` gains new **Step 4c** between Step 4b and Step 5 that performs a single per-stack PHPStan warm-up invocation before Step 5 begins, eliminating cold-cache cost on every subsequent wave. Canonical form: `cd "{stack.path}" && vendor/bin/phpstan analyse --no-progress > /dev/null || true` (non-blocking; stderr preserved for diagnostics; matches existing Step 5d.0 + 5f convention). Quality preservation: the warm-up uses the same invocation Step 5d.0 + 5f use — identical results, just faster on the first wave. Per-stack detection (`stacks[i].linter == "phpstan"` OR `vendor/bin/phpstan` exists); zero-PHPStan-stacks branch skipped silently. Validated by `scripts/tests/execute-phase-phpstan-warm.test.js` (5/5 D5 assertions: presence, non-blocking wrap, negative-for-no-PHPStan, idempotency NFR-04, empty-stacks).
- **D6 — STYLISTIC-DECLINED FP-store persistence** (REQ-10, REQ-11, REQ-12, NFR-04): When the user picks "Ignore" on a STYLISTIC finding in `commands/review.md`, `commands/review-implementation.md`, or `commands/swarm-review.md` (all 3 review-pipeline commands — same store, same parse rule), the finding is appended to `.bee/false-positives.md` with `Class: STYLISTIC-DECLINED` field using the canonical persistence phrase "Also append the finding to .bee/false-positives.md with Class: STYLISTIC-DECLINED" (parity-pinned across all 3 producer sites). Extractor reads dual-mode (genuine FP + stylistic-decline) using regex `/(?:\*\*)?Class(?:\*\*)?:?\s*(?:\*\*)?\s*STYLISTIC-DECLINED/` to tolerate markdown bold variants. **Strictness filter (REQ-12, load-bearing):** stylistic-declined entries suppress ONLY candidate findings whose own class is STYLISTIC — a REAL BUG candidate sharing a summary with a past stylistic-decline is NEVER suppressed. Validated by `scripts/tests/stylistic-decline-strictness.test.js` (10/10 D6 assertions: 3 strictness via `STYLISTIC_DECLINE_COMMANDS` named constant + 6 per-site + 1 Step 7.2 re-extraction) and new section-8 STYLISTIC-DECLINED fixture in `scripts/tests/extract-fingerprint.test.js` (55/55).

### Changed
- **D1 — Validator batch cap raised 5 → 10** (REQ-01, NFR-01): batch cap raised in ALL 4 review-pipeline commands at their primary validation blocks: `commands/review.md` (Step 5 finding-validator batch), `commands/review-implementation.md` (Step 6.1 validation block), `commands/swarm-review.md` (Step 8 validation block), `commands/ship.md` Step 3b.8 (MEDIUM-validation batch). Plus Design Notes lockstep mentions in `review.md` and `review-implementation.md` "Batch up to 10 validators" Design-Notes anchors. Quality preservation: each validator instance still runs the full per-finding validation contract (no skimming); the cap controls wave-level concurrency only. Out-of-scope preserver: `commands/quick.md` quick-gate validator block (`up to 5 in parallel`) — different idiom, not touched.
- **D2 — Parallel MEDIUM escalations** (REQ-02, NFR-01): `commands/review.md` MEDIUM-escalation block and `commands/review-implementation.md` MEDIUM-escalation block no longer instruct escalation to run SEQUENTIALLY. Canonical replacement wording (lockstep across both producer sites): `Batch up to 10 validators at a time -- specialist escalations use the same parallel pattern as primary validation; each is a focused re-analysis`. Quality preservation: MEDIUM escalation validators are independent per-finding read-only operations; the SEQUENTIALLY constraint was conservative defaulting, not a correctness requirement. Fixer-section SEQUENTIALLY preservers in the `review.md` Fixer Parallelization Strategy block + `review-implementation.md` Fixer Parallelization Strategy block remain (legitimately sequential because fixers mutate shared files).
- **D3 — Parallel pre-planning analyzers** (REQ-03, NFR-01): `commands/plan-phase.md` **Step 2.5** parallelizes the 3 trailing analyzers — **assumptions-analyzer + dependency-auditor + testing-auditor** — via three Task tool calls in a SINGLE message. Applied to BOTH the "Policy: required" pipeline (`plan-phase.md:80-86`) AND the "recommended/Full analysis" pipeline (`plan-phase.md:106`). The researcher → provenance pair at the head of the chain remains sequential (provenance reads RESEARCH.md). Quality preservation: each analyzer reads independent inputs, never references others' output; parallel execution is mathematically equivalent to serial.
- **D4 — Context Cache primitive extension** (REQ-04, REQ-05, REQ-06, REQ-07, NFR-04): the Context Cache + Dependency Scan primitive at `skills/command-primitives/SKILL.md:337-365` extends consumer surface to 4 new commands: `commands/audit.md` (line 58 — inline prose replaced with canonical reference per REQ-05), `commands/plan-phase.md` Step 2.5, `commands/eod.md` (new Step 2.5), and `commands/execute-phase.md` Step 5a (new inlined `## Stack Skill (inline)` section with multi-stack `### Stack: {name}` subsections + empty-stacks fallback + idempotency claim). Implementer-side contract codified in `agents/implementer.md` and `agents/quick-implementer.md` with canonical anchor phrase: `If your context packet contains a \`## Stack Skill (inline)\` section, use it verbatim and do NOT re-read the stack skill file.` Canonical reference form (Path A, locked in plan-all): `` See `skills/command-primitives/SKILL.md` Context Cache + Dependency Scan. `` (matches existing 4 CC consumers; spec's aspirational `Apply:` form deferred to follow-up doc ticket). Test coverage: CC_COMMANDS roster extended 4→8 in `scripts/tests/command-primitives.test.js`; ~28 new paired-contract assertions (171 → 199 passing).
- **D7 — `/bee:plan-phase` menu collapse** (REQ-13, NFR-03): the Step 7 AskUserQuestion approval menu (4 options) is removed; Accept route flows directly into Step 8 (STATE.md write) and then Step 9 single decision menu. **Step 7 heading PRESERVED** — only the AskUserQuestion + option-list inside it removed, preserving test anchors at `scripts/tests/plan-phase-plan-review-format.test.js:45-46`. The IMPORTANT no-auto-approve line at line ~714 was rewritten to acknowledge the new auto-flow semantics (Step 9 menu IS the approval gate; Revise plan triggers STATE.md rollback).
- **D8 — Conditional Plan Review / Re-review relabel** (REQ-14, NFR-03): Step 9 menu relabels "Plan Review" → "Re-review" when **`$PLAN_REVIEW_ISSUES_COUNT == 0`** (NOT iteration count; signal source is in-memory issue count from Step 6, EXCLUSIVELY — STATE.md `Plan Review` column is NOT read). 8 setpoints introduced, named semantically (not by ordinal): `init` (top-of-Step-6 defensive default) + `clean-converge` (Step 6.3 clean branch) + `early-return` (Step 6.4 early-return when no issues) + `issues-found` (Step 6.4.1 display assignment, outside fenced display block per F-001 fix) + `accept-fixes` (Step 6.4.1 "Accept fixes" branch, added per F-BUG-002 fix) + `max-iterations` (Step 6.4.2 max-iterations carry-forward) + `iteration-convergence` (Step 6.4.2 successful re-review convergence) + `developer-override-skip` (Step 6.4.3 developer-override "skip" path). Quality preservation: every destination remains reachable; Revise plan branch triggers STATE.md rollback using `$PRE_PLAN_STATUS` / `$PRE_PLAN_PLAN_COL` snapshots captured in Step 8 (restoring exact pre-Step-8 values, not generic "prior Status" guesswork) to undo the auto-committed PLAN_REVIEWED state.
- Plugin version: 4.3.0 → 4.4.0 (`plugins/bee/.claude-plugin/plugin.json:3`)
- Marketplace version: 1.7.0 → 1.8.0 (`.claude-plugin/marketplace.json` lines 4 + 14, lockstep)

### Fixed
- **`scripts/notify.sh` Windows PowerShell 5.1 compatibility** (downstream user contribution): the original AppendChild toast pattern silently failed on PS 5.1 with "Collection was modified; enumeration operation may not execute". Rewritten to build the toast XML as a string and use `LoadXml`, which works reliably on both PS 5.1 and PS 7. Adds `xml_escape()` for special-char safety in title/message, explicit `Windows.Data.Xml.Dom.XmlDocument` type load, `-NoProfile` flag, and full stdout+stderr suppression. macOS (osascript) and Linux (notify-send) branches unchanged.
- **`/bee:ship` autonomous loop optimizations** (4 changes — direct lessons from v4.4.0 ship execution, self-applied):
  - **Smart-discuss inherit mode** (Step 3a.0): when spec was planned via `/bee:plan-all` AND all phases show `Plan Review: Yes` AND cross-plan review entry exists in Decisions Log, smart discuss skips AskUserQuestion menus and writes DISCUSS-CONTEXT.md programmatically per phase (decisions auto-inherited from plan-all). v4.4.0 manually did this for all 4 phases; menus added zero new info because plan-all + cross-plan already exhausted grey areas. Estimated wall-time savings: ~10-15% on plan-all-fed ship runs.
  - **Per-wave STATE.md write skip** (Step 3a.4): during `/bee:ship`'s autonomous run, skip wave-level STATE.md updates — TASKS.md checkbox state is the authoritative resume signal; per-wave writes are pure display bookkeeping. Phase-level STATE.md writes (EXECUTING start, EXECUTED end, REVIEWING, REVIEWED) preserved. Interactive `/bee:execute-phase` unaffected (still writes per-wave for live dashboard). Saves ~6 disk Read-Modify-Write cycles per phase.
  - **Test-coverage-based review short-circuit** (new Step 3b.5.5): when a phase touches only markdown files AND added ≥10 new paired-contract assertions AND all assertions pass AND no prior-iteration HIGH findings, skip the 4-agent code-review pipeline and mark phase `REVIEWED (test-coverage-based)`. v4.4.0 marked Phase 3 + Phase 4 this way manually; final review at Step 4 caught the cross-flow bugs that per-phase code review couldn't have caught anyway. Saves 4 agents per qualifying phase.
  - **Lean default final review** (Step 4b): default agent set reduced from `(3 x N) + 2` (5 for single-stack) to 2 agents — `plan-compliance-reviewer` + `audit-bug-detector` in full-spec mode. Per-stack reviewers (bug-detector, pattern-reviewer, stack-reviewer) opt-in via `--full-final-review` flag or `config.ship.final_review_mode == "full"`. v4.4.0 ran with 2 agents; audit-bug-detector caught 8 cross-flow bugs single-handedly; plan-compliance verified 14 REQ + 5 NFR. Per-stack reviewers would have duplicated per-phase coverage. Saves 3 agents per ship run on single-stack projects.
- **`/bee:plan-all` cross-plan review rigor** (lesson from v4.4.0 itself): added `audit-bug-detector` as a third cross-plan agent alongside `plan-compliance-reviewer` and `bug-detector`. Empirical evidence from v4.4.0's plan-all run — the 2-agent cross-plan caught 5 issues at plan-time (Critical + 3 High + 1 informational), but the final implementation review later surfaced ≥2 additional cross-flow bugs (owned-literal leakage, scope-mismatch between similar review-pipeline commands) that should have been caught at plan-time. Cross-flow tracing across all phase plans before execution catches contract-drift and consistency gaps that single-plan reviewers structurally cannot see. Cost: 1 additional agent per cross-plan invocation; benefit: catches bugs at plan-time (cheap to fix in TASKS.md) instead of code-time (expensive code rework).
- **Phase 2 F-001 — multi-stack contract conflict** in the new `## Stack Skill (inline)` injection: explicit multi-stack subsection format (`### Stack: {name}` per resolved stack under one `## Stack Skill (inline)` parent) added to `commands/execute-phase.md`, resolving ambiguity with the existing per-task path-overlap resolution at execute-phase.md:137-147.
- **Phase 3 STYLISTIC parse rule regex tolerance**: parse rule changed to regex `/(?:\*\*)?Class(?:\*\*)?:?\s*(?:\*\*)?\s*STYLISTIC-DECLINED/` with bold-tolerant alternatives. The previous case-sensitive substring match `Class: STYLISTIC-DECLINED` silently failed on the canonical bold-formatted FP entries (`**Class:** STYLISTIC-DECLINED`), which would have shipped a fully-broken D6 persistence feature.
- **Cross-plan CI-001 — `bee:test` terminology**: 9 references across Phases 1, 2, and 4 updated from generic "bee:test" orchestrator language to the canonical `node plugins/bee/scripts/tests/{filename}.test.js` invocation form. Phase 3 was already correct.
- **Phase 4 F-002 — missing developer-override skip-path setpoint**: 6th setpoint added for `$PLAN_REVIEW_ISSUES_COUNT` on the developer-override "skip" path with rationale, plus defensive top-of-Step-6 initialization, preventing D8 from misfiring and showing "Plan Review" when the correct label was "Re-review".
- **Phase 4 F-003 — line-drift fragility**: hardcoded CHANGELOG line numbers replaced with the semantic "before first `## [` versioned header" anchor in T4.3 acceptance. Line-drift warning added with explicit semantic-anchor authoritative guidance for downstream tasks.
- **Phase 1 PAT-002 grammar fix**: "Specialist escalations Batch up to 10..." parses as broken English. Rewritten using pattern-reviewer's canonical idiom as opening imperative: "Specialist escalations: batch up to 10 in parallel".

### Reviews
4 plan-review iterations across 4 phases (10 fixes total): Phase 1 converged at iter 3 (4 fixes); Phase 2 converged at iter 2 (2 fixes); Phase 3 converged at iter 3 (11 fixes — D5+D6 are the most contract-heavy decisions in the spec); Phase 4 converged at iter 3 (9 fixes). Cross-plan consistency review surfaced 1 Critical + 4 High + 4 Medium findings, deduped to 5 fixes applied + 3 documented deviations. Phase 3 implementation-review used test-coverage-based verification (70/70 assertions across 3 dedicated test files cover the same surfaces a code-review pass would check).

## [4.3.0] - 2026-04-26 -- Agent Teams + Scoped Per-Wave Test Validation

### Added
- **Agent Teams integration** (experimental, Claude Code v2.1.32+) — bee can now spawn peer-to-peer teams instead of subagents for cross-layer review, scientific-debate debugging, cross-stack architectural planning, and audit domain split. New skills: `agent-teams/` (pre-flight, probe, CLAUDE.md bridge), `team-decisions/` (5-axis weighted scorer, hard constraints, threshold map), `team-templates/` (4 reusable spawn patterns).
- **Auto-Mode Marker primitive** in `skills/command-primitives/SKILL.md` — single source of truth for the auto-run lifecycle marker (`.bee/.autonomous-run-active`). Used by `/bee:ship`, `/bee:plan-all`, `/bee:autonomous`. File-existence is the sole detection signal — no PID, no nonce. Cleanup is unconditional on success and every error-exit branch.
- **Scoped per-wave test validation** in `/bee:execute-phase` Step 5d.0 — instead of running the full suite after every wave, runs only tests affected by the wave's changed files. New `Scoped Test Selection` primitive in `skills/command-primitives/SKILL.md` with per-runner table (vitest/jest native `--findRelatedTests`; pest/phpunit/pytest filename heuristic with composer.json psr-4 source-root detection; pytest src-layout uses `-k` form). New `phases.post_wave_validation: "auto" | "full" | "scoped" | "skip"` config (default `auto`).
- **Mandatory phase-end full validation** at `/bee:execute-phase` Step 5f — runs the FULL suite + linter + static analysis ONCE before marking phase EXECUTED. Always runs regardless of per-wave mode (the safety net for anything scoping missed). User prompted on failure with Pause / Retry / Mark anyway / Custom; result persisted to metrics + SUMMARY.md.
- **Linter file-extension mapping table** in `Stack/Linter/Test-Runner Resolution` primitive — covers pint, eslint, prettier, biome, phpcs, phpcbf, ruff, black, flake8. Enforces empty-list skip-with-log to prevent linters from scanning the entire project on waves that touched no matching files.
- **3 new stack-aware agents** for `laravel-inertia-react`: `bug-detector.md`, `implementer.md`, `pattern-reviewer.md`. Cloned from the laravel-inertia-vue stack and adapted for React 19 patterns + laravel-boost MCP for backend ops.
- **PID-aware auto-mode marker conventions** in `commands/ship.md`, `commands/plan-all.md`, `commands/autonomous.md` — three new markers (`.bee/.autonomous-run-active`, `.bee/.autonomous-team-spawned`, `.bee/.autonomous-team-claimed`) with documented sentinel-cleanup-on-failure contract in `skills/team-decisions/SKILL.md`.
- **TaskCompleted + TeammateIdle hooks** (`scripts/team-task-validator.sh`, `scripts/team-idle-validator.sh`) — enforce `## Task Notes` + deliverable-signature contracts on team teammates. Probe-team disambiguation by transcript-content match (the probe asks a unique TDD question), robust against orphaned probe directories.
- **`agent_teams` config block** added to `init.md` schema with 11 fields including `status`, `allow_in_auto_mode`, `auto_decision`, `high_cost_confirm`, `skill_injection`, `max_team_size`, `max_tokens_per_team_op` (adaptive per `implementation_mode`: 2.4M premium / 1.2M quality / 600K economy).
- **Re-init migrations** for both `phases.post_wave_validation` (default `"auto"`) and `agent_teams` (with semver version comparison + JSONC guard + post-write verification).

### Changed
- **`skills/core/SKILL.md` TDD applicability** clarified — TDD applies to business logic, not infrastructure boilerplate (migrations, factories, route registration). Worked PHP example added; anti-narration rule with aligned DON'T tokens added across 5 implementer agents.
- **`commands/audit.md` team path** now stamps `Validation: REAL BUG (in-team cross-evaluation)` + `Fix Status: pending` on every finding before handoff to `/bee:fix-implementation`. Without these stamps, fix-implementation's filter silently dropped team-produced audit findings.
- **`commands/fix-implementation.md` finding-ID regex** generalized to `### ([A-Z]+-)+[0-9]+` — covers multi-segment audit prefixes (`F-SEC-NNN`, `F-DB-NNN`, `F-API-NNN`, `F-FE-NNN`, `F-PERF-NNN`, `F-ARCH-NNN`, `F-ERR-NNN`, `F-INT-NNN`, `F-BUG-NNN`, `F-TEST-NNN`). The previous `[A-Z]+-NNN` pattern only matched 2-segment IDs.
- **`commands/health.md`** added Check 14 (orphan team detection); history schema, baseline, display, summary all updated 13 → 14.
- **`commands/do.md`** routing now recognizes `audit/review/swarm/trimite o echipă` and routes to the appropriate team-aware command instead of dispatching subagents manually.
- **`scripts/load-context.sh`** caps COMPACT-CONTEXT.md and SESSION-CONTEXT.md at 100 lines (-65% session bloat); `shopt -s nullglob` added for safer glob expansion.
- **Hook timeouts** for TaskCompleted + TeammateIdle raised from 10s to 30s to match peer transcript-validating hooks.
- Plugin version: 4.2.0 -> 4.3.0
- Marketplace version: 1.6.0 -> 1.7.0

### Fixed
- **Auto-mode PID-match self-identification was unreachable** (Bash tool spawns a fresh shell per invocation, so `$$` captured at marker-write never coincided with `$$` at marker-read). The cross-session warning fired on every legitimate auto-run. Replaced with file-existence detection.
- **Probe-team validator coexistence** — when both probe and real bee teams existed, the directory-presence check exited 0 globally and skipped validation for real-team teammates too. Switched to per-teammate transcript-content detection.
- **`init.md` semver compare** crashed under `set -e` when `claude --version` returned empty/non-standard output. Added empty-version guard with explicit "unavailable" status.
- **`init.md` adaptive ceiling** — JSON templates hardcoded `4000000`/`1200000` literals contradicting the documented adaptive rule. Replaced with `{adaptive_ceiling}` placeholder + explicit substitution step.
- **`team-idle-validator.sh` deliverable regex** missed `## Bugs Detected`, `## Stack Best Practice Violations`, `## Plan Compliance Findings`, audit summaries, debug `CHECKPOINT REACHED`/`INVESTIGATION INCONCLUSIVE`, and pattern/stack `Total: N deviations|violations` summary lines. Expanded to cover all documented agent contracts in hooks.json.
- **Sentinel cleanup-on-failure contract** specified in `skills/team-decisions/SKILL.md` — partial-failure path now releases `.autonomous-team-claimed` so subsequent team-eligible operations don't fall back to subagent for the rest of the run.
- **`pest --parallel` + positional files doesn't scope** (paratest discovers via phpunit.xml testsuites, ignoring positional args). `--parallel` removed from scoped pest/phpunit templates; reserved for phase-end full suite.
- **Step 3 fast-path bypassed Step 5f safety net** when re-running after a Step 5f Pause + manual fix. Step 3 now falls through to Step 5f when all tasks complete but status is not yet EXECUTED. Variables Step 5 normally seeds (`$FAILURE_TYPE_COUNTS`, `$ESCALATION_COUNT`, `per_wave`) are explicitly initialized on the fast-path so Step 6b doesn't write `undefined` into the metrics file.
- **Empty linter file-list scanned entire project** (pint, eslint, prettier all default to "scan everything" with no positional args). Empty-list skip-with-log added.
- **Shell injection on space-containing paths** — all interpolations in primitive command templates now shell-quoted.
- **Per-stack iteration unspecified** — concurrent stacks spawned 2N+ test workers competing on N cores. Both Step 5d.0 and Step 5f now explicitly say "executed sequentially".
- **Path normalization order** in Scoped Test Selection documented as load-bearing: existence filter → heuristic mapping → stack-relative rewrite LAST.
- **Re-init migration handles `phases: null`** distinctly from `phases: missing`.

### Reviews
4-round review loop (`.bee/reviews/2026-04-26-1.md`, `.bee/reviews/2026-04-26-2.md`, `.bee/reviews/2026-04-26-3.md`): Round 1 surfaced 25 findings (4 Critical, 6 High, 15 Medium); Round 2 surfaced 13 NEW issues introduced by Round 1 fixes; Round 3 caught a metrics-corruption regression from the Round 2 fast-path fix; Round 4 returned 0 findings, terminating the loop. 2 false positives persisted to `.bee/false-positives.md` (FP-001 STACKS_COUNT misread; FP-002 POSIX `[ ` is repo convention).

## [4.2.0] - 2026-04-23 -- Command Primitives Skill (Token-Optimization Pass)

### Added
- **`skills/command-primitives/SKILL.md`** — 7 reusable primitives (Validation Guards, Build & Test Gate, Context Cache, Stack/Linter/Test-Runner Resolution, Model Selection, Per-Stack Agent Resolution, Auto-Fix Loop, Re-Review Loop) with 3 split variants (Build & Test Gate Interactive/Autonomous, Auto-Fix Loop Quick/Full, Model Selection Reasoning/Scanning). 10 sections total.
- **171 paired-contract test assertions** (`scripts/tests/command-primitives.test.js`) verifying primitive ↔ caller invocation contract for every reference site.

### Changed
- **8 commands refactored** to reference command-primitives sections instead of inlining: `/bee:review`, `/bee:review-implementation`, `/bee:quick`, `/bee:audit`, `/bee:swarm-review`, `/bee:execute-phase`, `/bee:plan-all`, `/bee:plan-phase`.
- **Path-flatten sweep** across 9 files: 16 instances of `plugins/bee/` prefix removed from skill/agent/command refs (skill/agent/command paths are now relative to plugin root).
- **Skill namespace flatten** `skills/bee/` → `skills/`.
- **Pre-commit gate robustness** improved (config-driven case statement removed in favor of hard-coded whitelist).
- Plugin version: 4.1.0 -> 4.2.0
- Marketplace version: 1.5.0 -> 1.6.0

### Fixed
- 5 review findings surfaced during the refactor: review.md REVIEWING resume, multi-line MSI prose collapsed in 4 commands, test banner normalized, namespace flatten, plan-all cross-plan AFL collapsed.

### Tests
Final test counts: command-primitives 171/171 + vendor-citation 366/366 + agent-output-format 46/46 + quick-implementer-agent 35/35 = 618/618 passing.

## [4.1.0] - 2026-04-17 -- Vendor Citation Contract (Anti-Hallucination Guard)

### Added
- **Vendor citation contract across the review + audit pipeline** — every shipped finding from any of 24 reviewer/auditor agents must classify Evidence Strength as `[CITED]` (codebase trace, self-evidencing) or `[VERIFIED]` (vendor docs / OWASP / RFC / MDN / Context7-fetched), and provide a Citation pointer. Pure-`[ASSUMED]` findings are dropped, NOT shipped. Mirrors and extends the existing `agents/researcher.md:122-128` tag system precedent.
- **New schema fields** in `skills/core/templates/review-report.md`: `Evidence Strength: [CITED] | [VERIFIED]` and `Citation: <URL | Context7 lib ID + query | skill section path | codebase file:line>`. Slotted between existing `Evidence:` and `Impact:` fields. Total finding template now 13 fields (was 11).
- **`[CITED]` vs `[VERIFIED]` distinction** — empirical findings (codebase file:line trace) qualify as `[CITED]` even without external vendor docs; the trace IS the citation. Normative findings (best-practice claims) require `[VERIFIED]` external source. Avoids misclassifying legitimate empirical findings as STYLISTIC just because they lack vendor docs.
- **`DROPPED` verdict** in `finding-validator` and `audit-finding-validator` — distinct from `FALSE POSITIVE`. `DROPPED` means the reviewer made a process error (missing/`[ASSUMED]`/malformed citation); the underlying code claim was NOT evaluated. `quick.md` and `review.md` skip persistence of `DROPPED` to `.bee/false-positives.md` to avoid polluting the FP store and risking suppression of legitimate future findings via summary match.
- **`Evidence Requirement (Drop Policy)` sections** in `skills/review/SKILL.md` and `skills/audit/SKILL.md` documenting the contract, the empirical/normative split, the drop policy, and the distinction from researcher's permissive `[ASSUMED]` rules.
- **NEW test file** `plugins/bee/scripts/tests/vendor-citation-contract.test.js` — 166 structural assertions pinning the contract across all 24 agents + 3 schema files + 3 commands. Negative + positive checks ensure regression would fail CI.

### Changed
- 24 reviewer/auditor agent prompts updated with the contract (3 tiers: 5 with Context7 + full vendor lookup, 17 without Context7 + direct vendor URL citation, 2 validators with format-only fabrication checks + drop logic). Output formats extended with the 2 new fields per each agent's variant.
- 3 commands (`quick.md`, `review-implementation.md`, `review.md`) — inline finding-format lists extended from 10 to 13 fields.
- Plugin version: 4.0.7 -> 4.1.0
- Marketplace version: 1.4.3 -> 1.5.0

### Discussion
`.bee/discussions/2026-04-17-vendor-citation-reviews.md` captures the design rationale, the empirical/normative split decision, and the colleague's anti-hallucination motivation that drove the strict drop policy.

## [4.0.7] - 2026-04-17 -- Ceremony Bump Removal (Downstream Safety Hotfix)

### Fixed
- **`/bee:complete-spec` and `/bee:archive-spec` were silently corrupting the plugin install cache** for every downstream user. Both commands had a "Bump plugin version" step that tried `plugins/bee/.claude-plugin/plugin.json` first, then fell back to `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` — which resolves to `~/.claude/plugins/cache/bee-dev/bee/X.Y.Z/`. When a user ran the ceremony in their own project, the relative path missed, the fallback hit the cache, and the bump silently mutated the installed plugin. The drift warning then told the user to run `/plugin` reinstall — which would clobber the bump. Net result: silent install corruption + a misleading warning + a meaningless bump (downstream users don't author the bee plugin and their bumps would be erased on next marketplace install anyway).

### Removed
- **The "Bump plugin version" step is removed entirely from both ceremonies.** The plugin author's bump is a 1-user concern — burying a no-op step in user-facing flow is poor UX. Bee plugin versions are now managed manually by the plugin author (or via a future dedicated `/bee:release` command if it becomes annoying). `/bee:archive-spec` is now strictly about archiving; `/bee:complete-spec` is strictly about audit + changelog + tag + archive + history + state-reset.
- `archive-spec.md`: removed Step 6 entirely; Step 7 (Summary) renumbered to Step 6; dropped "Plugin version" line from summary; updated intro and design notes.
- `complete-spec.md`: removed "Bump plugin version" sub-block from Step 8 (including the cache drift warning); dropped "Plugin version" line from Step 9 summary; updated intro.

### Added
- **Negative-assertion regression contract.** Both `complete-spec-command.test.js` and `archive-spec-command.test.js` now contain assertions pinning that the ceremony command does NOT contain a "Bump plugin version" step, does NOT instruct writing to `plugin.json`, does NOT increment `PATCH`, and does NOT reference `${CLAUDE_PLUGIN_ROOT}` as a write fallback. A future regression that re-adds the bump (in any form) will fail CI.

### Changed
- Plugin version: 4.0.6 -> 4.0.7
- Marketplace version: 1.4.2 -> 1.4.3

## [4.0.6] - 2026-04-17 -- Hive Dashboard Empty Snapshot Fix

### Fixed
- **`/bee:hive` dashboard rendered empty for every user** — `scripts/hive-start.sh:99` was forwarding only `HIVE_OWNER_PID` to the spawned `node hive-server.js` child. `resolveBeeDir()` then walked up from `__dirname` (the plugin cache path, e.g. `~/.claude/plugins/cache/bee-dev/bee/4.0.5/scripts/`), found no `.bee/` ancestor, returned `null`, and the snapshot/config/file handlers were never wired. `/api/snapshot` stayed on the stub handler that returns only `{"timestamp":"..."}`. Fix adds `HIVE_BEE_DIR="$BEE_DIR"` to the `nohup env ...` prefix on the same line — `BEE_DIR` is unconditionally validated by the discovery block earlier in the script.

### Added
- **New integration test** (`plugins/bee/scripts/tests/hive-start-integration.test.js`) — spawns `hive-start.sh` as a real subprocess against a temp `.bee/` fixture and asserts the snapshot reflects a sentinel spec name written to a temp `STATE.md`. The sentinel is load-bearing: a simple `state !== undefined` assertion would pass even with the bug because `__dirname` walk-up finds the bee repo's own `.bee/` in the dev environment. Closes the test gap that let this bug ship — existing unit tests bypass the shell launcher by setting `process.env` directly.
- **Structural Test 15 in `hive-start.test.js`** — pins `HIVE_BEE_DIR="$BEE_DIR"` on the `nohup env ... node` line with a right-anchored negative lookahead `(?![A-Z_0-9])` to reject prefix-matched neighbors like `$BEE_DIR_OTHER`.

### Changed
- Plugin version: 4.0.5 -> 4.0.6
- Marketplace version: 1.4.1 -> 1.4.2

## [4.0.5] - 2026-04-12 -- TDD Applicability Guard

### Changed
- **TDD cycle now skips infrastructure code** — migrations, seeders, factory definitions, config files, route registration, middleware registration, and simple models with no business logic are no longer force-tested. TDD applies only to code with branching logic (controllers, services, policies, form requests, components, hooks, API endpoints). Mixed tasks test only the business logic parts.
- Updated `skills/standards/testing/SKILL.md` with "What NOT to Test" section listing infrastructure anti-patterns
- Updated `agents/implementer.md` with Step 2.6 TDD Applicability Check (evaluate before entering RED-GREEN-REFACTOR)
- Updated `agents/quick-implementer.md` with same Step 2.6 mirrored
- Updated `agents/stacks/laravel-inertia-vue/implementer.md` with Laravel-specific Step 2.6 (Eloquent `$fillable`/`$casts`, `match` expressions, observers, jobs, notifications)
- Plugin version: 4.0.4 -> 4.0.5

## [4.0.0] - 2026-04-09 -- Bee Sentinel: Debug & Recovery Intelligence + Skills Expansion + Command Quality Overhaul

### Added
- **Forensics command** (`/bee:forensics`) -- Read-only workflow diagnostics with 4-factor severity escalation (CRITICAL/HIGH/MEDIUM/LOW), 5-step cross-phase dependency tracing, rollback path generation (1-3 paths, safest-to-aggressive ordering), and forensics-to-debug handoff
- **Debug enhancement** (`/bee:debug`) -- Dynamic 3-7 hypothesis range with 20% auto-pruning, persistent session directories (state.json + report.md), `--resume` flag for interrupted sessions, pattern library with 40% keyword overlap matching for cross-session learning
- **Health intelligence** (`/bee:health`) -- 13 checks (up from 9): added workflow health, code quality trends, productivity metrics, forensic cross-reference. Historical baselining in health-history.json with per-check mode after 5 entries. 3+ consecutive degradation trend detection.
- **Error recovery** in `/bee:execute-phase` -- Failure classification (transient/persistent/architectural), cascading failure detection for Wave 2+ tasks, adaptive retry budgets (unlimited+backoff for transient, 3-attempt for persistent, 1+escalate for architectural), `$RECLASSIFIED_PERSISTENT` flag prevents classification loops
- **Cross-system bridges** -- Forensics-to-debug handoff with pre-populated symptoms, debug pattern library extraction on resolution, forensic cross-reference in health checks
- **Bee Mastery Guide** (`skills/guide/SKILL.md`) -- 205-line workflow intelligence skill with 6 sections: decision tree (spec + phase + multi-phase), command reference by intent (49 commands in 9 groups), smart feature suggestions (IF-THEN proactive rules), 13 anti-patterns, ecosystem model, self-referencing triggers. Dual delivery: compact excerpt at SessionStart + full guide on-demand.
- **Honeycomb statusline** -- New design with `bee` emoji, `hex` hexagons for phase progress, heavy-line context gauge, thin dotted separators
- **Scoped testing for parallel agents** -- Agents run ONLY their task-specific tests; conductor validates full suite + linter + static analysis once per wave (~70% time reduction)
- **Verification evidence** in SubagentStop hooks -- Implementer and quick-implementer agents must include actual test runner output, not just count claims
- **Context isolation docs** in core skill -- Defines what each agent type receives vs must NOT receive, with exceptions for retries and cascading failures
- **23 new commands**: autonomous, backlog, complete-spec, debug, forensics, health, insert-phase, next, note, pause, plan-all, profile, seed, ship, swarm-review, test-gen, thread, ui-review, ui-spec, workspace, audit-spec, do, help
- **7 new agents**: debug-investigator, dependency-auditor, assumptions-analyzer, integration-checker, swarm-consolidator, ui-auditor, testing-auditor
- **Post-wave full validation** (Step 5d.0 in execute-phase) -- Runs full test suite, linter, and static analysis ONCE per wave after all agents complete
- **Model escalation** in execute-phase -- Sonnet agents escalated to opus after 3 failures
- **18 new conditional library/standards skills** -- prisma, drizzle, tailwind-v4, tanstack-query, supabase, stripe, zustand, trpc, shadcn-vue, sentry, storybook, email, s3-storage, auth-patterns, realtime, ci-cd, docker, monorepo, i18n. All load conditionally based on package.json/config detection.
- **Firm rules R8 + R9** -- R8: no completion claims without evidence (paste actual test output). R9: HIGH confidence only for review findings (exact file:line, traceable impact, 5-15 per phase).
- **Async testing patterns** in standards/testing -- promises, timers, waitFor, error rejection, PHP queue fakes, flaky test prevention
- **Severity calibration table** in audit skill -- 7 borderline examples with "3 AM test" heuristic
- **Version-aware queries + result disambiguation** in context7 skill
- **Spec compliance procedure** in review skill -- list ACs by task ID, map to tests, trace code paths
- **Dark mode section** in frontend standards -- semantic tokens, Tailwind v3/v4 guidance

### Changed
- Plugin version: 3.3.0 -> 4.0.0
- Command count: 26 -> 49
- Agent count: 33 -> 39 (36 generic + 3 stack-specific)
- SubagentStop validators: 24 -> 27 (with negative lookbehind patterns for stack-specific agent support)
- Skills: 7 categories -> 22 SKILL.md files across 6 categories
- EOD command uses `bug-detector` and `plan-compliance-reviewer` agents (was `reviewer` and `project-reviewer` which didn't exist)
- EOD report template updated with dynamic Seed Health, Velocity, and Sentinel Status sections
- 5 agent skill references fixed: `testing` -> `standards/testing` (implementer, quick-implementer, test-auditor, test-planner, laravel-inertia-vue/implementer)
- `inject-memory.sh` refactored to `is_bee_agent()` function with suffix matching for stack-specific agents (`*-implementer`, `*-bug-detector`, `*-pattern-reviewer`, `*-stack-reviewer`)
- SubagentStop matchers use negative lookbehind to prevent double-match: `(?<!quick-)implementer$`, `(?<!audit-)bug-detector$`
- `pattern-reviewer$` and `stack-reviewer$` matchers unanchored to support stack-specific variants
- Guide ecosystem model: "7 scripts" -> "8 scripts" (was missing setup-statusline.js)
- Guide command reference: added 8 missing commands (init, update, profile, refresh-context, help, do, create-agent, create-skill)
- Romanian text removed from 6 command templates (review, plan-phase, new-spec, plan-review, review-implementation, audit)
- `autonomous.md` handles REVIEWING status, passes max_review_iterations from config, documents LEARNINGS.md as resume-only
- `ship.md` reads success criteria from ROADMAP.md (was phases.md)
- `seed.md` counts only active seeds toward 20 limit (was counting all including archived)
- `workspace.md` routes conflicted status directly to recovery
- `test.md`, `plan-review.md`, `test-gen.md` use Glob wildcard for phase directory lookup
- Skills count: 22 -> 41 (19 new, all conditional)
- Core skill compressed: rationalizations (12->6), Context7 (28->5), model delegation (10->3). Net -20 lines while adding R8+R9.
- **react-native-expo** major rewrite (300->527): expo-image, Reanimated 3, forms+keyboard, error recovery
- **kmp-compose** expanded: SQLDelight, Coil 3 image loading, Ktor interceptors+retry
- **claude-code-plugin** expanded: hook script patterns, SubagentStop validators, agent context packets
- **nestjs** expanded: Security Hardening (Helmet, CORS, Throttler, csrf-csrf)
- **angular** expanded: NgRx Signal Store example
- **react** expanded: concurrent rendering (startTransition, useDeferredValue)
- **playwright** expanded: accessibility testing (aria snapshots, axe-core), API testing
- **Default implementation mode: premium** -- All commands now default to `"premium"` (opus for everything)
- **Variable standardized:** `$IMPL_MODE` -> `$IMPLEMENTATION_MODE` across all commands
- **`$RESOLVED_MODEL` pattern** applied to plan-phase (8->1 reads), plan-all (5->1), discuss (2->1)
- **EXECUTING status** added to all 5 routing tables for mid-execution crash recovery
- **Swarm Review** added to completion menus of 6 commands
- **Protected agent names** expanded from 23 to 39 in create-agent.md
- **Heredoc commit pattern** in commit.md and quick.md for safe special character handling
- **Smart next-step routing** in commit.md checks if next phase is already planned/executed
- **Coverage map persisted** to TEST-GEN.md (was ephemeral)
- **DISCUSS-CONTEXT.md integration** in plan-all.md planner prompts
- **Predictive warnings** always run in plan-phase even when research_policy=skip

### Fixed
- EOD command referenced non-existent agents (`reviewer`, `project-reviewer`)
- Skill resolution for 5 agents pointed to non-existent `skills/testing/SKILL.md`
- Stack-specific agents not receiving user preferences from inject-memory.sh
- `quick-implementer` triggering `implementer$` SubagentStop hook (incompatible validation format)
- `audit-bug-detector` triggering `bug-detector$` SubagentStop hook (incompatible output format)
- `pre-commit-gate.sh` block paths used stderr + exit 2 (changed to stdout + exit 0)
- `session-end-summary.sh` git diff HEAD~0 when COMMITS=0
- **49 commands quality overhaul** -- all commands reviewed and optimized:
  - new-spec.md: duplicate heading, amend flow nav, spec-writer uses $IMPLEMENTATION_MODE
  - execute-phase.md: $FAILURE_TYPE_COUNTS preserved on crash+resume
  - review.md: $CLEAN_EXIT flag prevents STATE.md double-write on 0 findings
  - commit.md: targeted file staging (was overstaging entire spec tree)
  - complete-spec.md: plugin version bump fallback, ROADMAP.md in audit, memory archival
  - compact.md: CONTEXT.md no longer emitted verbatim pre-compaction
  - workspace.md: status subcommand exempt from nested worktree guard
  - audit-spec.md: dead pattern removed, results persisted to AUDIT-SPEC.md
  - audit.md: `find` replaced with Glob, irrelevant dependency scan removed
  - memory.md: full rewrite with proper frontmatter and AskUserQuestion
  - 15+ commands: R-M-W pattern added/made explicit for STATE.md writes
  - 10+ commands: free-text prompts replaced with AskUserQuestion
  - test-e2e.md, thread.md: STATE.md Last Action updates added
  - do.md: Skill() invocation for command routing

## [3.1.0] - 2026-03-17 -- Audit System & Quality Expansion

### Added
- **Comprehensive code audit system** — `/bee:audit` command orchestrates 9 specialized audit agents in parallel, validates findings to filter hallucinations, and generates a structured report
- **Audit-to-spec bridge** — `/bee:audit-to-spec` converts confirmed audit findings into actionable specs grouped by severity (CRITICAL → individual specs, HIGH → grouped, MEDIUM → cleanup, LOW → consolidated)
- **9 specialized audit agents**: security-auditor (SEC), error-handling-auditor (ERR), database-auditor (DB), architecture-auditor (ARCH), api-auditor (API), frontend-auditor (FE), performance-auditor (PERF), testing-auditor (TEST), audit-bug-detector (BUG)
- **Finding validator** — audit-finding-validator reads actual code to classify findings as CONFIRMED / FALSE POSITIVE / NEEDS CONTEXT, eliminating hallucinations
- **Report generator** — audit-report-generator merges validated findings into `AUDIT-REPORT.md` (human-readable) and `audit-findings.json` (machine-readable for audit-to-spec)
- **Audit skill** — `skills/audit/SKILL.md` defines severity levels, finding format with agent prefixes, validation rules, report template, and spec generation rules
- **11 SubagentStop validators** for all audit agents — enforce finding format, read-only compliance, and summary section presence
- **Context7 integration docs** in `core/SKILL.md` — centralized how-to, when-to-use, fallback behavior, multi-stack usage
- **Comprehensive error recovery** in `/bee:audit` — handles single agent crash, batch failures, validator crash, report generator crash, session loss, Context7 unavailability
- **Code Audit Workflow** documented in plugin README — step-by-step guide for vibecoded project takeover with selective auditing examples
- **3 implementation modes**: economy (sonnet everywhere), quality (sonnet scanning + opus critical), premium (opus everywhere) — replaces 2-mode system across all commands
- **Brainstorming-style discovery** in `/bee:discuss` and `/bee:new-spec` — adaptive questioning with no fixed round limit, one question per message, multiple choice preferred, decomposition check for multi-subsystem features, 2-3 approaches with trade-offs
- **Spec review loop** in `/bee:new-spec` (Step 9.5) — spawns `spec-reviewer` agent after spec-writer, auto-fixes issues, max 5 iterations
- **Auto-fix review loop** in `/bee:plan-phase` (Step 6.4) and `/bee:plan-review` — fixes findings automatically, re-runs 4 agents to verify, configurable max iterations
- **`spec-reviewer` agent** — validates spec completeness, consistency, clarity, YAGNI, scope, architecture
- **`/bee:test-e2e` command** — generate and run Playwright E2E tests with Page Object Model, fixtures, and auto-fix loop
- **Push notifications** — `/bee:init` offers cross-platform notification setup (macOS osascript, Linux notify-send, Windows PowerShell toast) for Stop, Notification, and PermissionRequest events
- **`notify.sh` script** — cross-platform native notification with safe argument passing (no shell injection)
- **Init stack skill validation** (Step 2.5) — warns when detected stack has no matching skill, suggests `/bee:create-skill`
- **Init multi-stack completion summary** — shows all stacks with path and skill status (✓ / ⚠)
- **4 new stack skills**: `vue` (4,146w), `kmp-compose` (2,227w), `angular` (2,416w), `nestjs-rabbitmq` library skill (2,569w)
- **`frontend-standards` skill** enriched with design quality section (typography, color, motion, anti-AI-aesthetics), 250-line component limit, no business logic in visual components, Core Web Vitals
- **`shadcn-ui` library skill** (1,868w) — component patterns, theming, cn() utility, composition, auto-detected when `components.json` exists
- **`playwright` testing skill** (1,624w) — POM, fixtures, selectors, assertions, auth, network mocking
- **TDD discipline enforcement** in core SKILL.md — Iron Law, Watch It Fail, rationalizations table (9 items), red flags list (7 items), anti-patterns (5 items), verification checklist (8 items)
- **Systematic debugging** in `fixer.md` — root cause investigation step (3.5), enhanced test failure protocol with defense-in-depth thinking, architectural escalation after 2 failed attempts
- **Architectural clarity** in `implementer.md` and `quick-implementer.md` — defense-in-depth layers (1-4), condition-based waiting for async, enhanced RED/GREEN/REFACTOR phases
- **CLAUDE.md wiring** in review context packets — all review agents now read project-level CLAUDE.md for overrides
- Auto-detection rules for `vue`, `angular`, `kmp-compose` stacks in init
- `frontend-standards` reference in all 7 frontend stack skills
- Library skill detection chain: stack skill → frontend-standards → shadcn-ui (if installed)

### Changed
- Plugin README updated: 26 commands (from 24), 33 agents (from 22), 24 SubagentStop validators (from 13)
- Core skill updated with Context7 integration section
- **Stack skills extended**: react (2.1k→3.3k), nextjs (2.6k→3.6k), nestjs (2.2k→4.3k), laravel-inertia-react (2.6k→5.2k) — React 19 hooks, Server Actions, state management detection, forms+validation
- **State management** in all stack skills follows "detect what's installed" pattern (Redux, Zustand, TanStack Query, Pinia, NgRx, etc.)
- **Per-stack linter/testRunner** — `linter` and `testRunner` moved from root config into each stack entry (backward compatible with fallback chain). `ci` stays global. Detection, init, scripts, commands, and agents all updated.
- **All hook matchers anchored** with `^name$` — prevents extension agent name collisions
- **Researcher hook** supports dual-mode (phase research + spec/quick research) without false rejection
- **Escalation** uses `finding-validator` with `## Classification` format (not specialist agents) — prevents SubagentStop hook conflicts
- **Review loop** uses separate `$LOOP_ITERATION` counter from cumulative `iteration_counter` — prevents premature exit
- **Finding-validator** respects implementation_mode (economy → sonnet, quality/premium → opus)
- **Execute-phase, review.md, commit.md** use Glob for phase directory lookup (not slug construction)
- **Plan-review** options changed from Approve/Re-review/Modify to Fix(recommended)/Accept-as-is/Fix-manually
- **SubagentStop hook** for plan-compliance-reviewer allows requirements.md checkbox updates
- **SubagentStop hooks** strengthened for implementer and quick-implementer: verify red-green cycle (tests fail before impl, pass after)
- **Discuss-partner hook** uses `Scan complete:` signal for mode detection (not heading presence)
- `inject-memory.sh` strips `bee:` prefix from agent types, removed dead agents (`reviewer`, `project-reviewer`)
- `auto-lint.sh` removed `set -euo pipefail` (prevents hook crash), biome uses `check --write` (format + lint)
- `stop-review-check.sh` awk column comment corrected
- `new-spec.md` amend flow routes through spec review loop
- Config template: removed stale `quick.agents` key (only `quick.fast` remains)
- Init migration summary no longer falsely claims adding `quick.agents`

### Removed
- AI artifact comments from ~46 test files (task IDs, acceptance criteria references)

## [2.1.0] - 2026-03-07

### Added
- `/bee:update` command for updating statusline and cleaning up legacy local copies

### Changed
- Statusline architecture: global-only via `~/.claude/hooks/` (no more local `.bee/statusline.js` copies)
- `setup-statusline.js` now injects plugin version into the global copy
- `bee-statusline.js` uses injectable `BEE_VERSION` constant with fallback to `plugin.json`
- `/bee:init` Step 5 verifies global statusline instead of creating local copies
- `/bee:quick` STATE.md tracking: only the latest quick task is shown (single row, old entries replaced)

### Removed
- Local `.bee/statusline.js` copy (legacy, replaced by global hook)
- Local `.claude/settings.json` statusLine config (global settings handle this)

## [2.0.0] - 2026-03-07 -- Workflow Overhaul

### Added
- 4 specialized review agents replacing single generalist: bug-detector, pattern-reviewer, plan-compliance-reviewer, stack-reviewer
- `/bee:add-phase` command for appending phases to current spec
- `--amend` flag for `/bee:quick` to modify existing quick task plans
- Plan persistence for quick tasks in `.bee/quick/{NNN}-{slug}.md`
- PreToolUse hook for pre-commit validation (linter + test gates)
- Plan review step in `/bee:plan-phase` with 4 parallel review agents
- "Plan Review" column in STATE.md phases table
- `quick.agents` config option (agents mode default for quick tasks)
- Laravel Inertia Vue SKILL.md major enhancement (authorization, dual-response, CRUD patterns)

### Changed
- `/bee:review` -- completely rewritten with 4 parallel specialized agents, finding deduplication, false-positive extraction, iteration tracking ("Yes (N)")
- `/bee:review-project` -- upgraded to 4 parallel specialists
- `/bee:quick-review` -- upgraded to 4 specialized agents
- `/bee:plan-review` -- upgraded to 4 parallel agents
- `/bee:quick` -- agents mode is now default (`--fast` for direct mode), removed `--agents` flag
- finding-validator agent -- added specialist escalation for uncertain findings
- fixer agent -- added Context7 tools
- STATE.md template -- added Quick Tasks section, Plan Review column, iteration tracking
- Statusline -- displays version number, format updated

### Removed
- `reviewer` agent (replaced by 4 specialists)
- `project-reviewer` agent (replaced by 4 specialists)

## [1.5.0] - 2026-03-04

- Version consolidation

## [1.4.0] - 2026-03-03

### Added
- Agent memory system with SubagentStart hook
- Memory archiving across sessions
- LICENSE and initial README files

## [1.3.0] - 2026-03-02

### Added
- `/bee:quick` command for fast tasks without spec pipeline
- `/bee:quick-review` lightweight review command
- Project memory system (`.bee/memory/`)
- `/bee:memory` command to view accumulated memories

## [1.2.0] - 2026-03-01

### Added
- Smart model delegation (sonnet for research/review, opus for implementation)
- Statusline with progress bar
- `/bee:quick-review` command
- `/bee:compact` smart compact command

## [1.1.0] - 2026-02-28

### Added
- Auto-configure statusline via SessionStart hook

## [1.0.0] - 2026-02-27

### Added
- Initial release
- Full spec-driven development pipeline: init, new-spec, plan-phase, execute-phase, review, commit
- 13 specialized agents (implementer, reviewer, researcher, etc.)
- 7 skill categories (core, context7, review, standards, stacks)
- 6 stack support files (Laravel Inertia Vue/React, React, Next.js, NestJS, React Native Expo)
- StatusLine integration with progress tracking
- Plan review command for validating phase plans
