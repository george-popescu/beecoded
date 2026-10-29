# Nectar

Nectar gives Claude Code and Codex a direction for planning, implementation and
verification. Its slim workflow leaves task size, scheduling and useful depth of
investigation to the model.

Nectar 3.4 adds focused security review and adapts verification and audit depth to
the work's impact. It retains compatibility with existing slim and older plans.

| Host | Example |
|---|---|
| Claude Code | `/nectar-shape` |
| Codex | `$nectar-shape` |

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

## Workflows

| Skill | Purpose |
|---|---|
| nectar-shape | Clarify an outcome and choose a fitted solution. |
| nectar-plan | Plan coherent tasks, dependencies and final verification. |
| nectar-build | Implement the authorized outcome and verify the integrated result. |
| nectar-honey | Carry planning, implementation, verification and review through to delivery. |
| nectar-review | Review a specific change and report evidenced findings. |
| nectar-burciu-inspection | Rigorously assess code, plans or documents for correctness, solution fit and quality. |
| nectar-test-review | Assess test value, isolation, reliability and runtime; optimize only when authorized. |
| nectar-security | Assess a specified change or component for reachable security flaws. |
| nectar-polish | Refine website/product wording and design for clarity, natural language and contextual fit. |
| nectar-rehearse | Exercise a migration, import or risky upgrade in an isolated environment. |
| nectar-release | Prepare or execute an authorized release and verify its actual destination. |
| nectar-debug | Diagnose a failure; continue to repair when requested. |
| nectar-audit | Produce a whole-codebase health report. |
| nectar-orient | Recover status or continue existing authorized work. |
| nectar-context | Inspect or refresh reusable project context. |
| nectar-capture | Save an idea without derailing the active task. |
| nectar-close | Archive accepted completed work with recoverable evidence. |

## Planning and autonomy

There are no fixed limits on waves, total tasks or tasks per wave. Decompose by
outcome and dependencies, and split topics only when independent delivery or
practical context/resource limits justify it. A wave can queue many tasks while
the host runs a smaller number of agents concurrently.

User requests and existing approval define the objective and constraints. Routine
file, task, scheduling and verification adjustments within that objective do not
require a new approval. A new product choice, materially different result or
consequential external action needs its own authority.

Small work uses an inline plan. Durable work uses `docs/work/YYYY-MM-DD-<slug>/`
with a concise design, plan and final review. The
[plan format](references/plan-format.md) documents the runtime fields.

## Implementation and final verification

A new plan starts with `Workflow: nectar-slim-v1`. Its task checkboxes mean
**implemented**. Partially completed waves are valid. The separate
`## Verification` section records pending, passed or failed, plus observed evidence.

The default is one coordinated verification phase after the integrated deliverable.
Run relevant tests and required project gates then. An early focused check is
useful when it resolves a bug or uncertain dependency. Do not rerun passing checks
solely because a wave ended, a subagent handed off or a different role took over.

After a repair, rerun affected checks and broaden only when changed dependencies
or unresolved risk justify it. When relevant inputs change, mark overall verification
pending, retain unaffected evidence and recheck the changed behavior and dependencies.
Review the final result proportionately; zero blockers
does not compensate for missing verification. Honey owns the final review when
orchestrating Build; standalone Build owns its own review. Neither repeats a
current review just because ownership changes.

[Test Value](references/test-value.md) keeps automation focused on observable
behavior. Reuse useful existing coverage; avoid exact-copy, label, boilerplate
and implementation-mirroring tests. A concise reason and evidence route replace
the former mandatory per-behavior dossier.

Prose changes can use editorial inspection; small visual changes may need a browser
check. Behavioral changes use relevant existing checks and valuable missing coverage.
Authorization, tenancy, money, data transformations and recovery warrant stronger
failure-path evidence. For small low-risk work, final review can be the implementer's
diff inspection. Stages do not require separate agents, skills or documents.

[Native host evidence](references/host-capabilities.md) can satisfy the selected
verification when scope and inputs match. Discover available tools rather than
assuming a particular model or host version. Nectar preserves model/effort settings
and introduces no verification hooks or duplicate pre-commit checks.

## Deep acceptance inspection

For a detailed acceptance review across code, plans or documents, use
`/nectar-burciu-inspection` in Claude Code or `$nectar-burciu-inspection` in Codex.
It challenges solution fit as well as correctness, traces supporting evidence and
reports a direct verdict. Material document contradictions can block acceptance;
passing tests alone do not establish quality. It stays read-only unless repairs
are separately authorized, accepts clean results and adds no mandatory Honey gate.

## Test review and optimization

For test-specific analysis, use `/nectar-test-review` in Claude Code or
`$nectar-test-review` in Codex. Name the recent changes or suite to inspect. It starts
read-only, reports useful coverage, isolation, reliability and runtime concerns,
and does not launch a full suite merely for review. Explicitly authorized test
optimizations preserve useful assertions and real transaction/concurrency semantics;
infrastructure and pipeline changes require their own explicit scope. Before/after
evidence uses comparable inputs and the project's canonical command. This skill
adds no automatic Honey gate.

Optimization handoffs briefly state what changed, which useful checks remain and
the measured before/after duration under comparable conditions. Missing baselines
or coverage measurements remain explicit. The behavioral suite includes a real
fixed-wait optimization with independently executed tests and mutation checks,
and a proposal-review trap that must reject speed gains bought by losing coverage.

## Focused security review

Invoke `/nectar-security` in Claude Code or `$nectar-security` in Codex with the
diff or component to assess. It checks relevant trust boundaries and reports
reachable flaws with evidence, bounded impact and a proportional remedy. Source
review stays read-only unless a broader request authorizes fixes through delivery.
It is not a mandatory gate and does not perform active pentesting. Pentesting
remains a separate request with explicit targets, environment and available tools.

Whole-codebase Audit now selects depth and delegation by risk, without agent-count
thresholds or fixed risk dossiers. Reports retain their parseable completion summary
and state material coverage gaps.

## Product polish and delivery

`nectar-polish` writes or refines website/product text for natural language and
clear meaning, including plausible unintended readings in the target locale. It
also refines design when requested, using the product's audience and brand rather
than treating familiar fonts or layouts as forbidden. It preserves factual claims,
localization placeholders and accessibility, and never certifies human authorship.
See [research notes](references/polish-research.md) for the sources and their limits.

`nectar-release` follows the project's release process and the user's preparation
or publication scope. It reuses validated artifacts and checks the actual registry,
deployment or store state before claiming a release is live.

`nectar-rehearse` checks risky data operations in disposable, verified environments,
including relevant interruption and recovery behavior. A staging label alone does
not establish isolation. These skills are available when useful and add no mandatory
stages to ordinary Honey delivery.

## Compatibility and cleanup

Unversioned plans retain their old completion interpretation. Authorized resumed
work can adopt the slim format without resetting tasks or repeating approval.
Completed legacy artifacts and pending Close transactions are not silently migrated.

The 3.2 approval-receipt helper remains available for retained legacy workflows.
New plans do not transport task lists through receipt tokens or stage duplicate
plans. Close and Debug promotion keep their independent path, identity, hash and
recovery checks for actual evidence moves.

For slim topics, Doctor and Close require implemented tasks, passed final
verification and a clean review. A pending or failed verification cannot authorize
archiving even when `review.md` contains a clean marker.

Close prepares a durable manifest before support edits, requires the necessary Git
history and archives exact ignored/untracked residue. It never silently finalizes
a stale pending manifest. See the [Close skill](internal-skills/nectar-close/SKILL.md)
for the operational protocol.

## Project context

Context and Atlas are optional navigation aids. Use current source when they are
stale, missing or unnecessary. Context refresh uses staged, validated promotion and
preserves the previous snapshot on failure. Indexing must be enabled explicitly.
Native project instructions remain authoritative.

After Close, structural or cited-source changes require refresh. Ordinary source
changes instead get a bounded assessment of the already-known diff: refresh when
recorded project facts changed, otherwise explain why no update is needed. This
does not relabel an old snapshot as fresh. Volatile-only changes skip refresh.
Orient uses Doctor directly for status; it does not run archive discovery.

## Commands and validation

```bash
nectar doctor
nectar doctor /path/to/project --json
nectar eval --all --dry-run
nectar eval --codex --case final-verification-cadence
nectar uninstall --all
```

Doctor is read-only. Behavioral evals assess decisions and final workspace state;
they are separate from deterministic runtime tests and may consume model usage.
A dry-run lists cases without invoking either host. Native Claude eval availability
depends on the installed CLI/account and is reported separately from failure.

From the contributor checkout:

```bash
npm run test:nectar
npm run validate
```

These are final validation gates, not a loop to run after every edit. Packaging and
publication remain distinct steps. The published package includes executable
helpers and internal skill sources; the installer owns host registration.

### Prepare a release once

After setting the intended release version and finishing source changes, run:

```bash
npm run release:prepare:nectar
```

This command runs the two gates above once, then packs with lifecycle scripts
disabled. It rejects changed package inputs and writes a tarball plus `release.json`
with its SHA-512 integrity and verification record to a unique temporary directory.
Gate output is summarized: result, elapsed time, test totals and relevant failure
details. Complete stdout/stderr logs remain beside the archive and are linked from
the verification record. On failure, logs are retained but no release artifact is
kept. The real command exit status remains authoritative.
Keep the workspace unchanged while it runs; do not separately run `pack:check` or
repeat the same gates as part of this release path.

Publication is a separate authorized action on that exact archive, not a fresh
pack of the workspace. Check its integrity against `release.json` before publishing:

```bash
npm publish "/absolute/path/from-the-result.tgz" --ignore-scripts --access public
```

Do not publish if the archive changed. A new source/version change needs a new
preparation. The ordinary `prepack` gate remains for direct pack/publish workflows;
the prepared-archive path avoids invoking it repeatedly. Preparing does not publish,
change versions or claim that a version is available on npm.

### Opt-in workflow benchmark

```bash
npm run benchmark:nectar
# Or use an already-installed compatible Codex executable:
npm run benchmark:nectar -- --codex /absolute/path/to/codex
```

This opt-in Codex benchmark consumes model usage. Both rounding and resumed Honey
tasks have a plain-agent comparator. Use `--scenarios rounding,debug,honey` for a
misleading-hypothesis debug case too, `--repetitions 3` for alternating-order trials,
and `--published-root /verified/extracted/package` for a third published-release
arm. Verify that archive's integrity before using it as a comparator.

Each run is capped at three minutes. An unavailable actor stops the batch without
scoring untouched code as a product failure. Temporary host directories exclude
personal instructions, skills, plugins and MCPs. Scalar model/effort settings and
file-backed authentication are retained; credentials are removed even if results
are kept. Custom providers and active profiles currently report unavailable rather
than silently changing model/provider. This is configuration isolation, not a
hostile-code sandbox.

The output records independent behavioral checks, changes to fixture tests, observed
skill-file reads, test-run counts, elapsed time and any exposed usage. Skill reads
only reflect observed command traces, not hidden native selection. Test counts
cover the fixture's instrumented command. A single trial is not a general speed or
quality claim. Model settings are recorded for comparison; other user configuration
is excluded. Native Claude cases needing final filesystem evidence are unavailable
before execution, because native grading does not expose that state authoritatively.
Legitimate test additions do not fail the benchmark: the immutable external
behavior checks decide correctness, while test changes remain review evidence.
External oracles run without ambient credentials, native imports or filesystem
write access and require a completion receipt; exit zero alone is insufficient.
Honey's Doctor status is additional workflow evidence, not product correctness.
Unknown model/usage metadata stays unknown. Artifacts and full traces remain in the
reported temporary directory. This benchmark is separate from normal tests and
release gates; it is not a native Claude evaluation.

## Atlas

Atlas keeps one local index per Git repository and exposes compact,
evidence-linked retrieval through the Nectar CLI and the bundled MCP server.
Queries never create or refresh an index implicitly.

Schema 8 requires refreshing older indexes before retrieval. Calls report the
observed callee expression with unresolved target status, including computed access
and injected PHP receivers; a relation is not proof of a concrete runtime dispatch.
`find-tests` prefers test relationships and labels test-only lexical fallback.

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
