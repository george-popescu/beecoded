# Changelog

## Unreleased

## 2.2.0 — 2026-07-23

### Added
- Added `nectar-context` for read-only freshness status and explicit, evidence-linked project-context refresh.
- Added `.nectar/CONTEXT.md`, `.nectar/CONVENTIONS.md`, and deterministic metadata with age, Git drift, structural-change, and base-commit classification.
- Added the staged `context-builder` agent and a transactional context runner shared by Claude Code and Codex.

### Safety
- Context generation treats repository content as untrusted data, rejects symlink or outside-root evidence, common secret-like values, obvious prompt directives, and documents over 6 KiB.
- Failed validation or promotion preserves the previous valid snapshot, while Bee context remains a read-only fallback and native `AGENTS.md`/`CLAUDE.md` instructions stay authoritative.

## 2.1.0 — 2026-07-21

### Changed
- Direct review is now a single-pass, read-only review that classifies and reports findings without editing files or starting another pass.
- Honey now owns autonomous review repair and repetition over one frozen delivery scope, with a default maximum of three full passes; the user may replace it with any positive integer maximum, including one or two.
- Interrupted Honey runs resume with their recorded delivery scope, completed pass count, and maximum instead of receiving a fresh review budget.
- Review and audit now separate finding status, class, risk, convergence, and disposition. Confirmed non-code concerns remain visible without being treated as production defects.
- Only confirmed `CODE_DEFECT` findings at medium severity or above block convergence. Low defects, coverage gaps, stale tests, documentation gaps, maintainability concerns, style preferences, and hardening ideas are reported as non-blocking.
- Validators can refute or reclassify candidates after tracing real entry points, guards, preconditions, reachability, likelihood, bounded impact, solution opportunity, and confidence.
- Automatic review fixes are limited to proportional, in-scope blockers with high or medium solution opportunity. Rewrite-scale fixes require user direction.
- Review convergence is capped at three full rounds. Findings discovered after round one can block only when they are regressions from review fixes or proven defects inside the original reviewed change.
- An explicit request for additional review starts a separate run with newly frozen scope and its own three-round budget; it never extends a completed run into round four.
- Plan self-review uses plan-specific correctness, coverage, dependency, verification, scope, quality, and style classes rather than runtime-code severity labels.

### Added
- Added the `review-risk-classification` behavioral contract, shared by Claude Code and Codex, covering a reachable race, a coverage gap, a stale test, unreachable hardening, and a naming preference.
- Added deterministic contract coverage for risk-aware blocker rules, validator reclassification, bounded review rounds, parseable summaries, and doctor clean-state semantics.

## 2.0.0 — 2026-07-17

### Changed
- Replaced the plugin-namespaced public skill surface with nine standalone, prefixed skills: `/nectar-shape` through `/nectar-orient` on Claude Code and `$nectar-*` equivalents on Codex.
- The npm installer materializes the selected host entries from the canonical `internal-skills/nectar-*` sources and points them at the durable managed package under `~/.beecoded/`.
- Claude Code and Codex plugin manifests no longer register the internal skill source directory.

### Safety
- Installation refuses unowned same-name collisions before staging or host mutation.
- Updates, explicit downgrades, dry-runs, targeted installs, and uninstall operate only on Beecoded-owned entries.

### Breaking
- Removed the previous colon-style public skill names. Re-run `npx @beecoded/nectar@latest` and use `nectar-*`.

## 1.3.0 — 2026-07-16

### Added
- Added five host-neutral behavioral contracts for split approval, contiguous numbering, dependency readiness, duplicate detection, and artifact recovery.
- Added a Claude Code adapter that materializes native `plugin eval` cases and a Codex adapter that executes the same contract in an isolated workspace with normalized results.
- Added `nectar doctor [path]` with deterministic human and JSON diagnostics for hierarchy, numbering, dependencies, cycles, duplicate topics, and artifact-derived status.
- Added `nectar eval` with host selection, case filtering, dry-run, persisted aggregate results, and distinct failed/unavailable reporting.

### Changed
- The shared npm installer now prints package provenance, verifies the complete staged payload before host installation, and refuses accidental downgrades unless `--allow-downgrade` is supplied.
- Runtime installer coverage now includes stale-package rejection, explicit downgrade, staged-version mismatch, and preservation of the previous managed installation on rejection.
- Plugin validation now guards the reliability payload and cross-manifest version agreement without adding any always-loaded skills.

## 1.2.0 — 2026-07-16

### Added
- Added dated feature roots (`docs/work/YYYY-MM-DD-<feature-slug>/`) and ordered nested child topics (`NN-<topic-slug>/`) so chronology, ownership, and split order are visible directly from paths.
- Plan now performs a complete decomposition before deciding whether one plan is enough. Oversized work is presented as a cohesive dependency-aware split with estimated tasks/waves and an explicit Approve/Revise/Decline gate; no split artifacts are written on silence.
- Added contiguous-number and dependency validation: child paths must be exactly `01..N`, and dependencies must reference exact earlier siblings with no gaps, duplicates, unknown paths, forward references, or cycles.
- Orient now displays nested projects as a status tree, derives aggregate parent status, and proposes only children whose dependencies are complete.
- Shape detects likely duplicate dated or legacy topics before creating a new feature and routes existing work through Orient.

### Changed
- Build, review, debug, and Honey now resolve and preserve the active leaf topic path. Honey records its autonomous split decision, executes dependency-ready children, and closes a parent only after every child has a clean pass.
- Existing flat `docs/work/<topic>/` directories remain supported for reading and resuming, but new work uses the dated hierarchy.

## 1.1.0 — 2026-07-14

### Added
- Added the `nectar` npm executable and the `npx @beecoded/nectar@latest` installation flow.
- The installer detects Claude Code and Codex in `PATH`, installs into both when available, and supports `--claude`, `--codex`, `--all`, `--dry-run`, and `uninstall`.
- Added a persistent managed marketplace under `~/.beecoded/marketplaces/nectar`, plus automated coverage for install, update, uninstall, host selection, and dry-run behavior.

### Changed
- Manual marketplace registration is now handled automatically by the npm runner.

## 1.0.1 — 2026-07-14

### Fixed
- Removed the unnecessary custom `agents` directory declaration from the Claude plugin manifest. Claude Code now discovers the root-level agents automatically and loads all nine skills normally.

## 1.0.0 — 2026-07-13

Nectar 1.0: autonomous delivery, structural enforcement, and a hardening pass designed to extract strong-model discipline from any model.

### Added
- **honey** skill — autonomous end-to-end delivery, triggered by "drop the honey" or "build X autonomously". One confirmation up front: the destination described in user-visible terms (what you'll see, click, or run), with the decisions taken on your behalf and what's explicitly not included. After the yes, the full shape → plan → build → review lifecycle runs without a single question, and the next thing you see is a final report: the confirmed outcome checked point by point, quoted test evidence, and every deferred choice presented for approval. Only four things interrupt a run: the outcome becoming undeliverable as confirmed, a debug investigation exhausting its evidence, a run that stops converging on a stable result, or anything destructive. Commits always remain yours to approve.
- **Three agents** — `implementer`, `lens`, and `validator` — carrying the TDD, review, and validation discipline in their own system prompts. Lenses and validators are read-only by construction, so "report findings, don't fix" is enforced by tooling rather than requested by prompt; validation always runs in a fresh context that did not author the findings. Every dispatching skill keeps a spelled-out fallback for sessions where the agent types are unavailable.
- **Red-flag tables** in shape, build, and debug naming the exact rationalizations that precede skipped steps — "I'll add tests after", "it's probably X, let me just fix it", "the subagent said it passed" — each paired with the rule it violates.
- **Consistency check** (`scripts/check-consistency.js`) guarding the plugin itself: shared discipline blocks must stay byte-identical across skills and agents, every skill description must state its triggers and boundary, the README table must match the skills on disk, and the manifests must agree on the version.

### Changed
- **build** gained a plan-drift protocol: when execution reveals the plan is wrong, the plan (and design, when scope changed) is repaired before the deviation is built — the artifacts never lie to the next session. Wave closes now quote the actual runner output; "green" without quoted output does not count. Test, lint, and typecheck commands are offered into the project's CLAUDE.md once discovered, so future sessions skip the rediscovery.
- **review** dispatches validation to fresh-context validator agents beyond the smallest tier, flags rounds that confirm every finding without a single refutation as probable rubber-stamping, and — at feature scale — requires behavioral verification in the clean pass: the changed flow exercised end-to-end with observed output quoted, because a green suite around a broken feature is still broken.
- **plan** requires every task to be executable by a stranger: an implementer seeing only the plan, the design, and the code — anything decided in conversation goes into the task line itself.
- **orient** re-orients from artifacts after a context compaction (a compaction summary is memory, not an artifact) and routes finished topics to honey's closing steps — changelog, final commits, folder cleanup — instead of ad-hoc deletion.
- **audit** and **review** lens dispatches slimmed to the task payload only; the finding format, severity scale, and evidence rules live in the agents.

## 0.2.0 — 2026-07-02

### Changed
- Renamed the `resume` skill to `orient` — the old name collided with Claude Code's built-in `/resume` command. Triggers and behavior are unchanged: "where were we", "what's next", or any new session touching existing work in docs/work/.
- build now reads before it writes: before the first test of a task, read the files the task touches, their tests, and the nearest neighbors — reuse existing helpers and match local idioms instead of reinventing. Wave subagents get the same rule in their prompts.
- build closes each wave — and quick-scale work without a plan — by running the project's lint and typecheck commands after the test suite, when the project has them; tasks tick only when all are green.
- review's conventions lens now also hunts over-engineering: duplicated helpers, dead code, and abstraction beyond what the change needs.
- review's clean pass now requires a green test suite (plus lint and typecheck when the project has them) after the last applied fix — a clean lens pass over code that fails its own suite no longer counts as clean.
- Plugin manifest now carries repository, license, and keywords for the marketplace listing.

## 0.1.0 — 2026-06-12

Initial release: eight lifecycle skills (shape, plan, build, review, debug, audit, capture, resume) covering the full path from idea to reviewed implementation, with plain-file state in docs/work/.
