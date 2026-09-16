# Nectar

Nectar gives Claude Code and Codex a direction for planning, implementation and
verification. Its slim workflow leaves task size, scheduling and useful depth of
investigation to the model.

Nectar 3.3 introduces this slim workflow while retaining compatibility with older plans.

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
or unresolved risk justify it. Mark previous verification and review stale when
implementation changes. Review the final result proportionately; zero blockers
does not compensate for missing verification. Honey owns the final review when
orchestrating Build; standalone Build owns its own review. Neither repeats a
current review just because ownership changes.

[Test Value](references/test-value.md) keeps automation focused on observable
behavior. Reuse useful existing coverage; avoid exact-copy, label, boilerplate
and implementation-mirroring tests. A concise reason and evidence route replace
the former mandatory per-behavior dossier.

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

This live Codex smoke benchmark consumes model usage. It uses disposable projects:
one rounding fix with and without project-local Nectar skills, plus an explicitly
requested Honey continuation. Each native run is capped at three minutes; an
unavailable actor stops the batch without scoring untouched code as a product
failure. Existing CLI model and effort settings are left unchanged.

The output records independent behavioral checks, changes to fixture tests, observed
skill-file reads, test-run counts, elapsed time and any exposed usage. Skill reads
only reflect observed command traces, not hidden native selection. Test counts
cover the fixture's instrumented command. A single trial is not a general speed or
quality claim, and user-level configuration remains part of the environment.
Legitimate test additions do not fail the benchmark: the immutable external
behavior checks decide correctness, while test changes remain review evidence.
Unknown model/usage metadata stays unknown. Artifacts and full traces remain in the
reported temporary directory. This benchmark is separate from normal tests and
release gates; it is not a native Claude evaluation.

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
