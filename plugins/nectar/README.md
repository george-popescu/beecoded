# Nectar

Ten skills, four agent roles. No workflow state machine. The methodology works in Claude Code and Codex when you describe work in plain language — and the discipline that matters is enforced by structure, not by asking the model to be careful.

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

The eight shipped cases cover split approval, contiguous numbering, dependency
readiness, duplicate detection, recovery from existing artifacts, plan and
review risk classification, and Atlas workflow discipline. Model
evals are intentionally separate from the normal zero-credit test suite.
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
| nectar-shape | Starting any new work — "let's build X", "add Y", "I want to change how Z works" | `docs/work/YYYY-MM-DD-<feature-slug>/design.md` at feature/project scale; smaller work writes nothing |
| nectar-plan | When a shaped feature needs an execution plan | A direct `plan.md`, or an approved split into ordered `NN-<topic-slug>/` children |
| nectar-build | Implementing — executing a plan or writing non-trivial code | No new artifact — updates `plan.md` checkboxes |
| nectar-review | After implementation or on "review this" | A single read-only pass with risk-classified findings, a parseable summary, and one recommended caller action |
| nectar-honey | "Drop the honey" — deliver end-to-end autonomously | The whole lifecycle, including bounded review repair and repetition, from one outcome confirmation to a final report |
| nectar-debug | Any bug, test failure, or unexpected behavior | Root cause, fix, regression test; `debug-<slug>.md` beside the active leaf only if the hunt spans sessions |
| nectar-audit | On "audit this", pre-release sweeps, unfamiliar codebases | Severity-grouped `docs/work/audit-YYYY-MM-DD.md` |
| nectar-capture | When an idea surfaces mid-work | One line in `docs/work/backlog.md` |
| nectar-context | When stable project knowledge should be reused or refreshed | Evidence-linked `.nectar/CONTEXT.md`, `.nectar/CONVENTIONS.md`, and freshness metadata |
| nectar-orient | On "where were we", "what's next", new sessions on existing work, after context compaction | No artifact — status report and one proposed next action |

## The lifecycle

Shape → plan → build → review is the main path. Honey runs that whole path autonomously after a single outcome confirmation — the user confirms *what they will get*, in their own terms, and the next thing they see is the final report. Debug, audit, capture, and orient are satellites that activate when their condition is met.

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

Four agents carry the heavy discipline in their own system prompts, so orchestrating skills pass only the task-specific payload — and so the rules that matter cannot be dropped:

| Agent | Role | Enforcement |
|-------|------|-------------|
| `nectar:implementer` | Executes one plan task with the full TDD loop | Sees only the plan line, the design, and the code — no conversation to drift from |
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

New work always uses a dated feature root. Existing legacy flat `docs/work/<topic>/` directories remain readable and resumable; Nectar does not force migration.

Before creating a root, Shape checks for likely duplicate dated and legacy topics. Plan performs the full decomposition first. If it would exceed 5 waves or 10 tasks, Plan presents the complete ordered split with scope, size estimate, boundary reason, and exact `depends on` paths. It creates nothing until the user chooses `Approve split`; `Revise split` rebuilds the proposal and `Decline split` leaves the parent untouched.

If an unplanned legacy flat topic is oversized, Plan asks before doing anything: migrate it to a dated parent (recommended), keep one oversized legacy plan as an explicit compatibility exception, or cancel. Migration is never automatic.

Child numbers are always contiguous `01..N`, without gaps or duplicates. Numeric order makes the tree readable; declared dependencies decide which child is ready. Orient derives child statuses and an aggregate parent status, then proposes only dependency-ready work.

Checkboxes in each leaf plan.md are the progress state. Resuming means reading the hierarchy and git history — an interrupted autonomous run resumes the same way, from the first actionable unchecked box.

## Principles

1. **Scale to the task.** Trivial work gets no ceremony. Artifacts are created only when the work spans sessions or needs review traceability.
2. **Evidence over assertion.** Every finding, hypothesis, and claim carries file:line evidence; every "green" is a quoted runner output, not a feeling. Unverified findings die in validation.
3. **Artifacts are the only truth.** No registry, no status machine. When reality diverges from a plan, the plan is repaired before the deviation is built.
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
