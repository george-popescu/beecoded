# Changelog

## 3.6.0 — 2026-10-29

- Added `nectar-burciu-inspection`: optional deep review across code, plans and documents,
  with evidence-backed criticism, solution-fit assessment and cross-artifact blockers.
  Public discovery and installation now include seventeen skills.

## 3.5.0 — 2026-10-27

- Added `nectar-test-review` for scoped read-only test analysis and separately
  authorized optimizations, preserving meaningful coverage and isolation. Registered
  the sixteenth public skill for both hosts; no mandatory delivery gate was added.
- Added an executed optimization scenario with external before/after test runs and
  mutation checks, plus a read-only trap scenario rejecting skipped coverage,
  weakened assertions and shared mutable state disguised as speed improvements.
- Test-review handoffs summarize changes, retained useful checks and comparable
  measured durations, explicitly stating any missing evidence.

## 3.4.1 — 2026-10-18

- Preserve computed JavaScript callees in Atlas and label call targets as unresolved
  syntax evidence. Test lookup filters lexical fallback to test sources before
  limiting and deduplicates files. Schema 8 invalidates old derived relationships.
- Isolate Codex evaluations from personal instructions, skills, plugins and MCP
  configuration; remove temporary authentication state on completion or interruption.
- Compare baseline and Nectar on both implementation and Honey tasks. Optional
  published-package and repeated trials use independent outcome checks with
  restricted execution and explicit completion evidence; Doctor is reported separately.
- Give semantic judges the initial task data, completed command evidence and saved
  artifacts. Add executable Capture/Context cases and fix Release evidence access.
  Native Claude cases requiring inaccessible final state stop before model execution.
- Reject never-existent Close delivery paths without deletion history. Preserve
  archive/recovery formats. New Context snapshots bind to their project and detect
  changed cited source; older snapshots retain legacy reads until refreshed.
- Keep short Git failure causes while redacting complete or truncated quoted
  credential values from diagnostics.
- Clarify bounded review continuation, narrow Polish edits and larger design intent.
  Capture enriches a matching backlog idea without duplicating it. Public skill
  names and repository-local storage remain unchanged.

## 3.4.0 — 2026-10-07

- Simplified Honey and Build around one shared workflow, with proportionate
  verification and no mandatory stage handoffs for small work.
- Added `nectar-security` for focused source review of reachable authorization,
  tenancy, input, secret-handling and data-exposure flaws. Active pentesting stays
  a separate explicitly scoped activity.
- Retain unaffected verification and review evidence after repairs; recheck changed
  behavior and dependencies while preserving required project gates.
- Reuse available native Codex/Claude and CI evidence without duplicate checks,
  automatic hooks, model switches or mandatory context generation.
- Simplified the shared Nectar/Code Audit methodology: risk-based delegation,
  compact evidenced findings and honest coverage limits, with stable summaries.
- Close can use agent-created Git commits under existing user authorization;
  exact history, delivery-byte, archive and recovery checks remain in place.
- Added `nectar-polish` for natural product language, contextual ambiguity checks
  and purposeful visual refinement. It preserves facts, brand voice and accessibility.
- Added `nectar-release` and `nectar-rehearse` for destination-verified delivery and
  isolated data-operation rehearsals, available when the task needs them.
- Reconcile affected documentation during delivery and reuse existing threat-model
  context for focused security assessments.
- Updated package descriptions and installation coverage for fifteen public skills.
- Updated the Claude evaluation adapter for current grader metadata, isolated-plugin
  trust and aggregate score output. Native scores still cannot substitute for
  unavailable final-workspace evidence.
- Audit evaluation now enforces report-only writes and judges the saved report's
  actual content rather than relying on the agent's description of it.

## 3.3.0 — 2026-09-16

- Added a slim workflow with no numerical wave/task limits, partial implementation
  progress and one separate final verification result. Doctor and Close refuse
  pending, failed or malformed verification even with a clean review marker.
- Replaced repeated fit/approval/Test Value ceremonies with concise shared
  guidance. Existing user authority covers routine in-scope implementation changes
  and resumption; meaningful product and external-action decisions remain explicit.
- Verification defaults to the integrated deliverable's end. Reuse current evidence
  across workers and handoffs; run early or repeated checks only for concrete risk,
  changed inputs or failures. Agent delegation and review depth follow the task.
- New plans no longer carry whole task lists through approval tokens or create
  staged duplicate plans. Legacy receipt helpers and historical completion remain
  supported; Close and Debug evidence moves retain their recovery checks.
- Shortened skill descriptions and moved conditional procedures into references.
  Updated behavioral evaluations to cover the new workflow decisions.
- Assigned final review to Honey during orchestration and to standalone Build
  otherwise. Orient now reads Doctor status without archive-discovery overhead.
- Ordinary source changes request a bounded context-impact assessment instead of
  automatic regeneration; structural and cited-source changes still require refresh.
- Added contributor release preparation that validates once, rejects package-input
  drift and produces one integrity-recorded archive without publishing it.
- Release gates now show compact results while retaining full diagnostic logs.
  Installed helper commands avoid repeated encoded JavaScript, retaining encoded
  path transport and real Node entrypoint/exit/stream behavior.
- Added an opt-in isolated Codex routing/Honey smoke benchmark. Independent reads
  can be batched, and delivery owners can keep doing useful work while workers run.

## 3.2.0 — 2026-08-30

### Added
- Added 23 host-neutral behavioral contracts with shared final-workspace checks,
  bounded semantic grading on Claude Code and Codex, and honest actor/judge/run
  metadata. Keywords alone can no longer produce a behavioral pass.
- Added release-owned batch Close for an exact ignored/untracked root set, with
  one immutable assets snapshot, one pending manifest, one user commit gate,
  monotonic multi-root archive recovery, and fail-closed SQLite coordination.
- Added a canonical technical Solution Fit contract and a fifth read-only
  investigator role for current-behavior mapping and fresh fit validation.
- Added a deterministic, no-follow approval receipt that binds the exact parent
  design, leaf design, and leaf plan to one current-run digest and carries
  monotonic task/review baselines.
- Added helper-discovered opaque selection, receipt, progress, and sealed-stage
  tokens. Legacy names with whitespace, Unicode, quotes, newlines, and shell
  metacharacters remain display data and require no migration.
- Added one canonical Test Value contract with behavior ownership, separate
  completion evidence, and the four decisions `ADD_PRODUCT_TEST`,
  `REUSE_EXISTING_TEST`, `NO_NEW_TEST`, and `ISOLATED_REHEARSAL`.
- Added transactional promotion of standalone feature-scale Debug evidence into
  a dated design, with raw-byte identity, fatal UTF-8 validation, exclusive
  destination creation, visible recovery claims, identity-owned rollback, and
  preserved `investigation-evidence.md` on success.
- Added the public `nectar-close` workflow with one exact completion parser,
  durable prepare/support manifests, commit-proven tracked cleanup, recoverable
  ignored/mixed archives, SQLite-serialized recovery, Doctor rechecks, and
  conservative post-delivery context refresh decisions.

### Changed
- Removed twelve prose-regex suites that treated Markdown wording as behavioral
  evidence. Deterministic checks now stay structural or executable; semantic
  relevance belongs to the cross-host behavioral contracts.
- Shape, Debug, Plan, Build, Honey, Orient, Review, and Audit now preserve an
  approval-before-write boundary: investigation, candidate solution, `FIT`, a
  written plan revision, and explicit approval precede implementation.
- Honey now presents the fitted zero-blocker plan with the user-visible outcome
  before its single confirmation. It writes to a helper-owned mode-0700 stage,
  seals and revalidates an exact no-follow descendant manifest, materializes
  byte-equivalent content only after approval, and refuses disposal on drift so
  the reported recovery path remains intact. It keeps one receipt per leaf;
  material drift requires a fresh fit and plan.
- Plan now separates writable `- files:` from optional read-only `- reads:`.
  Build and Honey serialize write/write and write/read conflicts while allowing
  read/read overlap, and progress changes are atomic receipt transitions.
- The canonical managed-installer template now renders one static
  `APPROVAL_LAUNCHER` for every managed installer. Installed helper paths travel
  only as base64url data; Node invokes the helper with structured arguments,
  `shell: false`, inherited stdout/stderr, and propagated errors/status/signals.
  Plan, Build, Honey, Orient, and native or fallback implementers pass only
  helper-emitted opaque tokens, so raw repository/staging paths are never
  interpolated into executable shell source.
- The shared renderer now applies the same static encoded launcher to every
  executable installed Node helper, including project context. Debug promotion
  discovers root-bound source tokens, seals a helper-owned fixed-name design
  stage, and promotes only paired opaque tokens; its legacy raw path CLI fails
  closed and committed cleanup warnings never trigger promotion retries.
- Fresh receipts reject partial ordinary waves and checked future ordinary waves.
  Struck tasks remain digest-bound without advancing the executable frontier.
- Debug promotion preserves concurrent/new evidence, reports an exact visible
  recovery path on ambiguity, and states the pure-Node same-user TOCTOU limit
  instead of claiming absolute race safety.
- Orient now separates legacy gate migration from approval refresh: missing fit
  evidence requires a new investigation/candidate/fit/revision, while fitted
  pre-digest or cross-session work re-presents the same content and digest for
  fresh approval. Completed topics are not retrofitted.
- Persisted Plan approval and Honey mode markers are audit/routing records, not
  write authority; interrupted work needs a newly approved current-run receipt.
- Tokens provide bounded transport and integrity, not authority. The helper
  rediscovers and revalidates live or sealed-stage state for each transition;
  older managed sessions fail closed pending plugin upgrade and fresh approval.
- Shape, Plan, Build, Debug, Implementer, Honey, and Orient now preserve the
  approved Test Value map. Only `ADD_PRODUCT_TEST` mandates red/green/refactor;
  zero-new-test work closes through its observed evidence route, and rehearsal
  must prove teardown with no residue.
- Review, Lens, Validator, and Nectar Audit retain the existing finding taxonomy
  while adding scoped `KEEP`, `REMOVE`, `CONSOLIDATE`, `MOVE`, or `REWRITE`
  suite recommendations. They remain read-only and never apply a disposition.
- Standard framework/schema migration mechanics no longer force surrogate tests;
  custom backfills remain protected by data-invariant automation or realistic
  isolated rehearsal according to risk and stable ownership.
- Deterministic contracts validate the packaged workflow invariants but cannot
  prove model compliance; cross-host behavioral execution remains a separate
  release gate.
- Review, Orient, Shape, and Honey now delegate completion and cleanup to
  `nectar-close`; historical clean prose remains explicit
  `legacy-needing-adjudication`, and unrelated old roots no longer create
  blocking dependency noise for completed historical chains.
- Non-blocking receipt durability/parser hardening remains deferred; behavioral
  prose compliance and version reconciliation stay with the release-owned eval
  work rather than expanding this repair.

## 3.1.0 — 2026-07-28

### Changed
- Plan keeps work in one `plan.md` when the complete decomposition fits at
  most five dependency waves and ten tasks. Work above either limit still
  requires a cohesive, explicitly approved child-topic split.
- Honey's separate review-loop policy is unchanged: three full passes remain
  the default maximum, with any explicit positive integer accepted instead.

## 3.0.2 — 2026-07-24

### Fixed
- Atlas skips anonymous PHP classes when emitting named symbols, exports, and
  inheritance edges while still traversing their bodies for imports and calls.
- Added parser and end-to-end indexer regressions for both `new class {}`
  and `new class extends Foo {}`.

## 3.0.1 — 2026-07-23

### Fixed
- Nectar install and update now ensure `.nectar/` is present in the effective
  global Git excludes file without modifying each project's tracked
  `.gitignore`.
- The global ignore update is idempotent, respects an existing
  `core.excludesFile`, and remains in place after uninstall so generated
  project context cannot accidentally become Git-visible later.

### Safety
- Atlas now rejects `.nectar/` as a mandatory internal exclusion even when a
  repository force-tracks generated Nectar context.

## 3.0.0 — 2026-07-23

### Breaking
- Nectar now requires Node `^22.18.0 || >=24.11.0` so Atlas can use built-in SQLite and the current pure-JavaScript parser toolchain without native installation steps.

### Added
- Added Atlas, an optional per-Git-project local code index backed by built-in
  SQLite, FTS5, and evidence-linked symbol and relationship data for
  JavaScript, TypeScript, JSX/TSX, and PHP.
- Added public `nectar atlas` lifecycle and retrieval commands plus one shared
  local MCP used by Claude Code and Codex for overview, symbol, related,
  flow, test, and task-context queries.
- Added per-worktree activation choices, real indexing progress, incremental
  refresh, safe cache cleanup, and an automatic recommendation that never
  indexes before the user explicitly enables Atlas.
- Integrated minimal Atlas profiles into Shape, Plan, Debug, Build, Review,
  and Audit with frozen Build/Review snapshots, direct-source verification,
  and deterministic fallback to the existing search/read workflow.
- Added a reproducible small/large evaluation suite with exact-symbol and
  broad high-noise profiles, reporting recall, same-boundary context,
  approximate token economy, time to relevant evidence, and cold/incremental
  latency.

### Performance
- Reduced the MCP query path to one reusable repository identity and a bounded
  set of Git worktree probes, eliminating repeated identity resolution and
  per-dirty-file Git subprocesses while preserving content-sensitive
  freshness.
- Warm refresh reuses unchanged parse records, avoids reopening unchanged
  content, and persists only changed, added, or deleted file content while
  retaining required cross-file relationship correctness.
- Retrieval no longer performs a full SQLite integrity scan on every query;
  full verification remains part of index lifecycle and explicit status.
- Bounded packets cap retrieval metadata. The shipped evaluation reports
  packet size separately from end-to-end context and includes direct-source
  verification on both sides rather than claiming universal token savings.

### Safety
- Atlas respects `.gitignore`, rejects dependency/build/cache directories,
  secret-like filenames, binaries, symlinks, and outside-root paths before
  indexing, and stores private cache data outside the repository.
- MCP access is confined to the active Claude roots or Codex sandbox workspace;
  stale, corrupt, incompatible, disabled, or truncated retrieval falls back
  without inventing evidence.

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
