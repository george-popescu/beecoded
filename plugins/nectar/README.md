# Nectar

Eleven skills, five agent roles. No workflow state machine. The methodology works
in Claude Code and Codex, with read-only investigation and an independent
technical fit check before any implementation approval.

| **Host** | Invocation example |
|---|---|
| Claude Code | `/nectar-shape` |
| `Codex` | `$nectar-shape` |

## Install

```bash
npx @beecoded/nectar@latest
```

Nectar detects Claude Code and Codex in `PATH` and installs into both when both are available. Use `--claude` or `--codex` to target just one host.

For a reusable global runner:

```bash
npm install --global @beecoded/nectar@latest
nectar
```

The npm installer creates standalone `nectar-*` user skills for each selected
host. No manual marketplace command is required. Reinstalling upgrades only
Beecoded-owned entries, and an unowned same-named skill is never overwritten.
To remove the user-scoped installation, run
`npx @beecoded/nectar@latest uninstall`.

Nectar 3 requires Node `^22.18.0 || >=24.11.0`. This lets Atlas use Node's
built-in SQLite support while keeping the package free of native build steps.

The installer prints the exact package version and source path before changing
either host. It refuses to replace a newer installed version with an older
package unless the downgrade is explicit:

```bash
nectar --allow-downgrade
```

## Reliability commands

Inspect a project's `docs/work/` hierarchy without modifying it:

```bash
nectar doctor
nectar doctor /path/to/project
nectar doctor --json
```

Doctor checks hierarchy, numbering, dependencies, cycles, duplicate topics, and
artifact-derived status. Clean projects exit `0`, blocking diagnostics exit `1`,
and invalid usage exits `2`.

Run the shared behavioral contracts against Claude Code, Codex, or both:

```bash
nectar eval --all
nectar eval --codex --case duplicate-detection
nectar eval --all --dry-run
```

The 23 shipped cases cover hierarchy and recovery, Solution Fit and approval,
Test Value decisions, Close routing, stale-context handling, plan and review
risk classification, and Atlas workflow discipline. Model
evals are intentionally separate from the normal zero-credit test suite.
Deterministic contracts and their tests do not prove model compliance; host
behavioral evals provide that evidence, and dry-run proves discovery only.
Claude's native `plugin eval` may report unavailable when the installed CLI or
account does not expose that early-access capability; this is distinct from a
failed Nectar behavior. Eval subprocesses receive a minimal environment rather
than every ambient credential. Use a CLI login for authentication; if a CI
environment requires specific variables, opt them in explicitly:

```bash
NECTAR_EVAL_PASSTHROUGH_ENV=ANTHROPIC_API_KEY,OPENAI_API_KEY nectar eval --all
```

## How it works

| Skill | When it activates | What it produces |
|-------|-------------------|-----------------|
| nectar-shape | Starting any new work — "let's build X", "add Y", "I want to change how Z works" | Read-only investigation, candidate solution, independent `FIT`, and a design or proportional inline plan |
| nectar-plan | When a fitted feature needs an execution plan | A reviewed plan revision with explicit approval, or an approved split into ordered `NN-<topic-slug>/` children |
| nectar-build | Implementing an approved plan revision | Approval preflight followed by bounded execution and verified checkbox progress |
| nectar-review | After implementation or on "review this" | A single read-only pass with risk-classified findings, a parseable summary, and one recommended caller action |
| nectar-honey | "Drop the honey" — deliver end-to-end autonomously | Investigation, `FIT`, and the exact plan before one outcome/plan confirmation, then bounded delivery |
| nectar-debug | Any bug, test failure, or unexpected behavior | Read-only root cause evidence, fitted candidate, and an approved-plan hand-off; persistent evidence only when needed |
| nectar-audit | On "audit this", pre-release sweeps, unfamiliar codebases | Severity-grouped `docs/work/audit-YYYY-MM-DD.md` |
| nectar-capture | When an idea surfaces mid-work | One line in `docs/work/backlog.md` |
| nectar-close | After a complete topic is accepted, or a completed duplicate is found | Manifest-backed prepare, user-commit proof, recoverable archive, Doctor, and context hand-off |
| nectar-context | When stable project knowledge should be reused or refreshed | Evidence-linked `.nectar/CONTEXT.md`, `.nectar/CONVENTIONS.md`, and freshness metadata |
| nectar-orient | On "where were we", "what's next", new sessions on existing work, after context compaction | No artifact — status report and one proposed next action |

## The lifecycle

Investigation → Solution Fit → plan → approval → implementation → review is the
main path. Shape and Debug keep project code read-only through Fit. Plan presents
the exact revision before approval, and Build refuses missing or stale approval.
Honey performs the same preflight before its single combined outcome/plan
confirmation, then runs without extra stops unless material drift invalidates
that approval.

### Test Value and completion evidence

Nectar maps each changed behavior before implementation: protected behavior,
credible failure, impact, unique existing coverage, owning layer,
implementation independence, runtime class/cost, one test decision, and a
separate observed completion-evidence route.

- `ADD_PRODUCT_TEST` adds valuable permanent coverage with red/green/refactor.
- `REUSE_EXISTING_TEST` runs the existing owner without duplicating the rule.
- `NO_NEW_TEST` adds zero test files and verifies through selected build, lint,
  typecheck, render, browser, diff, boot, runtime, or bounded manual evidence.
- `ISOLATED_REHEARSAL` proves a risky or one-off path in a disposable boundary,
  including teardown and no-residue evidence.

A standard framework/schema migration normally needs schema diff, migration
dry-run, rollback/build, and runtime smoke rather than a permanent surrogate
test. A custom backfill is different: data invariants, idempotency, batching,
rollback, and production-like outcomes require valuable automation or an
isolated rehearsal.

Review and Nectar Audit retain `TEST_OR_COVERAGE_GAP`/`TEST_DEFECT` and add a
separate, scoped suite recommendation: `KEEP`, `REMOVE`, `CONSOLIDATE`, `MOVE`,
or `REWRITE`. These never authorize a read-only reviewer to edit tests.

The contract is intentionally compact and outcome-first. Deterministic tests
prove its schema and wiring; they cannot prove model compliance. Cross-host
behavioral cases remain a separate release gate. Research basis:
[Anthropic agent evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
and [OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model).

### Content-bound approval

For feature and project work, approval is bound to canonical SHA-256 input: the
derived parent design when nested, the leaf design, and the leaf plan. The
persisted `Plan approval` line and Honey mode marker are audit records only; they
never grant write authority by themselves. Authority is an in-memory
`CURRENT_RUN` receipt containing the digest, Plan revision, derived paths, task
baseline, and frozen review progress. Build and each implementer recompute that
receipt before writing.

Installed callers share one installer-rendered `APPROVAL_LAUNCHER`. Its shell
source is static: the installed helper path is base64url transport data, decoded
inside Node, and the helper is invoked with structured arguments through
`spawnSync(..., { shell: false })`. Inherited numeric descriptors preserve
stdout/stderr bytes, while bootstrap errors, child errors, status, and signals
remain failures. The shared managed-installer template owns this launcher and
regenerates the Bee, Nectar, Code Audit, and UI/UX Audit installers.

The same renderer converts every executable installed Node-script reference,
including project-context and Debug promotion helpers, into that static encoded
launcher form. Absolute installed roots remain display/link data where useful,
but never executable shell source.

Agents never place a repository, topic, installed-package, or staging path in
shell source. From the live project cwd they ask the helper to `discover`
eligible leaves, show its `displayPath` only as data, and pass the corresponding
opaque selection token to `snapshot-token`. The versioned canonical base64url
selection, receipt, task-advance, and review-advance tokens are checksummed and
root-bound where applicable. This supports existing names containing spaces,
Unicode, quotes, newlines, or shell metacharacters without renaming them. Raw
agent-facing `--topic` and `--project-root` modes fail closed.

Tokens are transport and integrity handles, not write authority. The helper
rediscovers the current hierarchy, reopens the canonical files, and recomputes
the receipt on every sensitive transition; only the explicitly approved
current-run receipt grants authority. Old managed sessions lack this exact
launcher/token protocol and therefore fail closed until the plugin is upgraded
and the unchanged surfaces are presented for fresh approval.

Ordinary task checkboxes and the one canonical review-count field may advance
without changing the approved digest, but only through atomic helper-owned
transitions. Skips, rewinds, duplicate transitions, partial waves, and review
maximum changes are rejected without altering the artifact. Any other design,
Decision, hierarchy, task, criteria, `files`, or `reads` change invalidates the
receipt and returns through Investigation, Fit, Plan, and approval.

Every fresh snapshot also validates persisted ordinary progress. Ordinary tasks
inside one wave must be uniformly pending or complete, and completed ordinary
waves must form one prefix. Partial waves and checked future-wave tasks are
structural discrepancies that fresh approval cannot legitimize. Struck tasks
remain digest-bound audit history but do not advance the ordinary-work frontier.

Receipts are deliberately current-run only. After an interruption, context
compaction, or new session, Nectar re-presents the exact parent/design/plan
surfaces and digest for fresh approval. Already-completed topics need no receipt
retrofit. Honey applies the same rule through a helper-owned mode-0700 staging
root. It writes the final hierarchy outside the repository, seals an exact
no-follow manifest of every descendant, and uses only sealed-stage discovery and
snapshot tokens before confirmation. After confirmation it revalidates that
manifest, materializes byte-equivalent content, rediscovers the live leaves, and
requires matching derived paths and digests. Disposal removes only the sealed
manifest; any extra, changed, missing, replaced, or symlinked entry makes cleanup
fail closed and leaves the reported stage path intact for recovery.

### Close and context lifecycle

`nectar-close` is the only workflow that removes completed roots from live
`docs/work/`. Doctor, Review, Orient, Shape, Honey, and Close share one exact
completion parser: the final `Blocking:` count is zero and the canonical clean
marker is the semantic tail, followed only by whitespace or one real closing
code fence. Historical clean prose is `legacy-needing-adjudication`, not done.

Close discovers only whole direct/legacy roots or a parent whose exact children
are all done; it never removes one nested child. `prepare` records a no-follow
manifest of topic bytes, tracking, delivery/support state, HEAD, ownership, and
context impact before support edits. Selected changelog/backlog postimages are
sealed after that durable preimage. The user then creates the necessary commit
history; Close never commits automatically.

`finalize` distinguishes `tracked-only`, ignored/untracked-only, and mixed
topics. Tracked bytes require exact Git history and committed deletion. Ignored
or untracked residue moves atomically to
`.nectar/closures/archive/<id>/topic`; mixed roots archive only their exact
residue. Built-in SQLite `BEGIN IMMEDIATE` serializes normal Close processes,
while immutable pending/archive manifests remain recovery authority. Interrupted
PRE/POST states resume through `recover-token`; safe PRE cancellation preserves
its record instead of deleting it. Doctor reruns after cleanup. A conservative
context decision refreshes commands, modules, entry points, architecture,
conventions, or cited evidence and skips only explicit volatile uncited paths.

This is a local evidence-safety mechanism, not a hostile same-user security
boundary. Observed identity/hash drift fails closed and preserves the exact
recovery path. No close operation pushes, tags, publishes, deploys, recursively
deletes ignored evidence, or treats unrelated dirty roots as authority.

### Plan access scopes

Every task's `- files:` list is create/modify authority. Optional `- reads:`
entries are read-only scheduling and navigation metadata, not write authority
and not an exhaustive read sandbox. Write/write and either direction of
write/read overlap serialize in plan order; read/read overlap may run in
parallel. Implementers may still inspect necessary nearest neighbors, but may
write only declared `- files:` paths.

### Debug hand-off

A standalone feature-scale Debug hunt promotes its complete evidence into the
dated design before Plan through an opaque helper protocol. Discovery emits a
root-bound token for a current normal topicless hunt. The helper then creates a
private fixed-name design stage, seals its exact UTF-8 bytes and identity, and
promotes only a paired source token plus sealed-stage token. Project, source,
destination, temporary, and installed-package paths never enter shell source;
legacy raw CLI flags fail closed. A committed result reports cleanup separately,
so a retained-stage warning cannot turn success into an unsafe retry.

The runner opens and fingerprints raw source bytes,
rejects invalid UTF-8 in both evidence and staged design, and uses `O_NOFOLLOW`
where the platform exposes it plus portable identity checks. It claims the exact
hunt into an exclusive sibling recovery path before creating any destination.

Success writes the approved `design.md` and preserves the exact original bytes
beside it as `investigation-evidence.md`. If the source changes or reappears,
the newer bytes remain untouched and the claimed original stays at the exact
reported `docs/work/debug/recovery-<slug>-<token>.md` path. Rollback removes only
objects whose recorded identity proves the runner created them; collisions,
foreign replacements, and ambiguous cleanup preserve evidence instead of
guessing which copy to delete.

This is a local evidence-safety mechanism, not a security boundary against a
hostile same-user process that continuously swaps path ancestors. Pure
cross-platform Node does not expose one portable descriptor-relative operation
for every mutation. Nectar rejects pre-existing symlinks, revalidates identities
around mutations, stops on observed drift, and documents this narrow TOCTOU
limit instead of claiming absolute race immunity.

### Validation boundary

Receipt durability/parser edge cases recorded as non-blocking remain deferred;
this repair does not silently broaden into unrelated hardening. Prose-to-model
compliance, final-workspace graders, and release-version reconciliation remain
owned by the behavioral-evals/release topic. Deterministic tests prove helper,
installer, and artifact invariants, not that a host model followed prose.

## Project context

`nectar-context status` reports whether the compact project map is fresh, stale,
expired, or missing without modifying the repository. `nectar-context refresh`
builds a new evidence-linked snapshot in staging, validates it, then promotes it
transactionally. A failed refresh keeps the previous valid snapshot.

The generated `.nectar/CONTEXT.md` indexes stable commands, modules, entry
points, definitions, relationships, and useful links.
`.nectar/CONVENTIONS.md` records only repeated, evidence-backed patterns. Each
document is capped at 6 KiB so later workflows can load only the relevant
sections instead of rescanning the project.

Freshness defaults to stale after 14 days, 20 changed files, or structural
changes, and expired after 30 days, 100 changed files, or an unavailable base
commit. Existing `.bee/CONTEXT.md` and `.bee/CONVENTIONS.md` are reused
read-only when native Nectar documents are absent. Native `AGENTS.md` and
`CLAUDE.md` always remain authoritative.

## Risk-aware review convergence

Review separates whether evidence confirms a finding from what kind of finding it
is. Production defects, coverage gaps, stale tests, documentation gaps,
maintainability concerns, style preferences, and hardening ideas keep distinct
classes. Reachability, likelihood, bounded impact, solution opportunity, and
confidence are recorded independently, so a frightening hypothetical does not
inherit production-defect status merely from its worst imaginable outcome.

Only confirmed medium-or-higher code defects block convergence. Non-code findings
and low defects remain in the final report. A direct review is one classification
pass: it never edits reviewed files and never starts another pass. It ends with
the parseable totals and one recommended caller action.

Honey is the autonomous caller that may repair and repeat. It freezes one delivery
scope before its first review and uses that same scope throughout. Honey has a
default maximum of three full review passes. Any explicit positive integer maximum
chosen by the user replaces the default: 1, 2, 5, or any other positive value is
valid. The maximum is always finite and is never silently changed.

Between passes, Honey repairs only proportional `BLOCKING + FIX_NOW` root causes
when another pass remains to verify the change. Non-blocking findings do not cause
repairs or repetition, and architectural or scope-expanding blockers stop for user
direction. The sequence ends at zero blocking code defects or at the chosen maximum, with
remaining findings and the next recommended action reported plainly.

## The agents

Five agents carry the heavy discipline in their own system prompts, so orchestrating skills pass only the task-specific payload — and so the rules that matter cannot be dropped:

| Agent | Role | Enforcement |
|-------|------|-------------|
| `nectar:investigator` | Maps current behavior and independently validates Solution Fit | Read-only tools, fresh validation context, evidence-linked `FIT`/`PARTIAL`/`UNFIT`/`BLOCKED` verdict |
| `nectar:implementer` | Executes one approved Test Value branch and evidence route | Sees only the approved task payload and current receipt — no conversation to drift from |
| `nectar:lens` | Reviews a scope through exactly one lens | Read-only tools: "findings only, no fixes" is physics, not instruction |
| `nectar:validator` | Adversarially validates findings | A fresh context that did not author the finding — no ego, no blind spots inherited |
| `nectar:context-builder` | Builds compact project context in staging | Treats repository content as untrusted data and cannot promote or overwrite active context |

When the agent types are unavailable in a session, every dispatching skill has a spelled-out fallback: a general-purpose agent with the discipline written into the prompt in full.

## State convention

```
docs/work/
  backlog.md              # captured ideas, one line each
  audit-YYYY-MM-DD.md     # audit snapshots — latest per day wins
  debug/<slug>.md         # debug hunts with no topic folder
  YYYY-MM-DD-<feature-slug>/
    design.md             # parent outcome and, when split, the ordered Topics list
    plan.md               # present only when the feature fits one plan
    debug-<slug>.md       # direct-feature hunt only
    review.md             # direct-feature review only
    01-<topic-slug>/
      design.md           # this child's share of the outcome and dependencies
      plan.md             # tasks with checkboxes, grouped in waves
      debug-<slug>.md     # child-specific persistent hunt
      review.md           # latest review findings for this child
    02-<topic-slug>/
      ...
```

New work always uses a dated feature root. Existing legacy flat
`docs/work/<topic>/` directories remain readable. An unfinished legacy plan
missing canonical investigation/candidate/`FIT` evidence takes the full gate
migration: new investigation, candidate comparison, independent fit, revised
plan, and approval. An already-fitted pre-digest plan keeps its revision but
requires exact digest re-presentation and fresh approval. Completed legacy work
needs no retrofit.

Before creating a root, Shape checks for likely duplicate dated and legacy topics. Plan performs the full decomposition first. If it would exceed 5 waves or 10 tasks, Plan presents the complete ordered split with scope, size estimate, boundary reason, and exact `depends on` paths. It creates nothing until the user chooses `Approve split`; `Revise split` rebuilds the proposal and `Decline split` leaves the parent untouched.

If an unplanned legacy flat topic is oversized, Plan asks before doing anything: migrate it to a dated parent (recommended), keep one oversized legacy plan as an explicit compatibility exception, or cancel. Migration is never automatic.

Child numbers are always contiguous `01..N`, without gaps or duplicates. Numeric order makes the tree readable; declared dependencies decide which child is ready. Orient derives child statuses and an aggregate parent status, then proposes only dependency-ready work.

Checkboxes in each leaf `plan.md` are persisted progress evidence; the current
receipt is the trusted progress state. Resuming starts by reading hierarchy and
git history, recomputing the exact receipt, and obtaining fresh approval before
the first actionable unchecked wave.

## Principles

1. **Scale the record, not the gate.** Trivial work uses a one-step inline plan;
   larger work persists artifacts. Investigation, `FIT`, and approval remain.
2. **Evidence over assertion.** Every finding, hypothesis, and claim carries file:line evidence; every "green" is a quoted runner output, not a feeling. Unverified findings die in validation.
3. **Artifacts define content; the receipt carries authority.** Material drift
   invalidates the current-run receipt and returns through Investigation, Fit,
   Plan, and approval. Persisted approval text is audit history, not permission.
4. **Never auto-commit.** Skills suggest commits with a message; the user approves. Autonomy covers building, never shipping.
5. **Conversation owns the process.** Skills teach the coding agent how to think; they do not script orchestration.
6. **Structure over willpower.** The rules that matter most are enforced by role separation and restricted tools — a lens that cannot edit, a validator that did not author the finding, an implementer that never saw the conversation — not by asking the model to be careful.

## Consistency check

`scripts/check-consistency.js` guards the plugin itself: the finding format, severity scale, and verdict definitions must stay byte-identical everywhere they appear, every skill description must state both its triggers and its "Not for" boundary, and the README table must match the skills on disk. Run it before committing changes to nectar:

```
node plugins/nectar/scripts/check-consistency.js
```

## Distribution

The npm package is `@beecoded/nectar`. Its runner installs that same plugin
payload through managed local marketplace catalogs for Claude Code and Codex,
verifies every staged version before host installation, and prevents accidental
downgrades from stale local or cached packages.

## Atlas

Atlas keeps one local index per Git repository and exposes compact,
evidence-linked retrieval through the Nectar CLI and the bundled MCP server.
Queries never create or refresh an index implicitly.

```bash
nectar atlas status --path .
nectar atlas enable --path .
nectar atlas refresh --path .
nectar atlas disable --path .
nectar atlas clear --path .
nectar atlas explain --path .

nectar atlas overview --path .
nectar atlas find-symbol OrderService --path .
nectar atlas find-related OrderService --path .
nectar atlas trace-flow OrderService --path .
nectar atlas find-tests src/OrderService.ts --path .
nectar atlas context-for-task "change order validation" --path . --json
```

Atlas defaults to `auto` and needs one project-local choice before MCP
retrieval is used. `enable` stores the choice and builds the first index;
`disable` keeps the cache; `clear` removes only the active worktree snapshot.
Preferences and SQLite data stay outside the repository and survive uninstall.
Installing or updating Nectar never indexes a project.

Maintainers can run `npm run evals:atlas` from the Nectar package to generate a
reproducible small/large Atlas-on versus baseline JSON profile on isolated
synthetic TypeScript projects. It records task outcome, recall, time to relevant
evidence, files and context read, packet size, an explicitly approximate
`ceil(characters / 4)` token estimate, and cold/incremental indexing latency.
The suite covers exact-symbol lookup at small and large scale plus a broad,
generated-source-noise large-project lookup. The baseline uses case-insensitive
Git grep plus direct source reads; the Atlas side includes the retrieval packet
plus the same full selected source files, so context and token deltas use the
same boundary. Packet size remains separate. The report exposes small-project
startup overhead, exact searches where grep uses fewer tokens, and broad
searches where bounded Atlas retrieval avoids generated grep noise instead of
hiding any result. A truncated packet is an Atlas failure, matching production
workflow fallback. Timings apply only to the synthetic fixtures. Use
`npm run evals:atlas -- --files 1000` for a single custom size.

Before publishing from the repository root, `npm run test:atlas-release`
packs the real tarball, installs it into isolated homes, validates both host
registrations and MCP connections, and exercises prompt, enable, query, warm
refresh, disable, clear, and uninstall without invoking a model.
