---
name: nectar-test-review
description: Assess recent tests or a specified suite for meaningful behavioral coverage, isolation, reliability and runtime; optimize only within an authorized scope.
---

# Test Review

Start with read-only analysis of the named suite or recent test changes. Identify
the project's canonical command, relevant configuration, setup/teardown, existing
results and the application behavior exercised. Follow real callers and interfaces;
do not assume a mock, passing assertion or test name proves the production flow.
Use [Test Value](../../references/test-value.md) for coverage decisions.

A review request does not authorize edits or a full-suite run. Reuse recent evidence
whose inputs still match. Run a focused diagnostic only to settle concrete uncertainty
in a safe disposable environment; otherwise label the conclusion as source-based.
Do not trigger live integrations, migrations or shared-data mutations for review.

Look for the risks relevant to this suite:
- Missing behavior, duplicated coverage, implementation-mirroring assertions and
  tests that cannot fail when the relevant application behavior breaks.
- Repeated costly migrations, seeding or bootstrapping; fixed sleeps, unnecessary
  retries and synchronization that can instead wait for an observable condition.
- Leaked database, cache, clock, random, mock, process or DOM state; order dependence,
  parallel-worker collisions and teardown that does not run after failures.
- Tests that bypass the real application entry point, mock the wrong interface or
  replace the transaction/concurrency behavior the scenario is meant to protect.

Report concrete file/line evidence, protected behavior, credible impact and a
proportional proposal. Distinguish observed failures or measured costs from likely
risks and unmeasured speed estimates. Recommend keeping, consolidating, moving,
rewriting or removing a test only after identifying any unique coverage it owns.
Do not demand a fixed report template, more tests or a performance target by default.

When optimizations are explicitly authorized, implement only that scope. Preserve
useful cases, assertions, real transaction/concurrency semantics and isolation.
Do not gain speed by adding skips, weakening assertions, hiding failures or changing
application behavior. Infrastructure or pipeline changes need explicit authorization;
do not treat permission to optimize tests as permission for either.

A database snapshot or cached setup is optional, not a universal recipe. Use it
only when the project supports it: account for schema/seed/configuration changes,
required setup side effects, worker isolation and a correct cold fallback. Preserve
tests of migration/seed behavior themselves. If those properties are uncertain,
propose the option rather than silently introducing it.

Verify the integrated optimization proportionately with the canonical project
command and comparable before/after inputs: environment, data, cache state,
concurrency and selected cases. Account for useful assertions and executed, failed,
skipped or missing cases as well as duration. Explain any intended consolidation.
Do not claim unchanged line/branch coverage without measuring it, or compare a
warm subset with a cold full suite. If baseline evidence is missing, say so.
Rerun affected checks after repairs; do not repeat the suite after every edit.
Stop once the authorized outcome and its evidence are sufficient.

Finish with a brief account of what changed, which useful checks remain, and the
observed before/after duration under comparable conditions. State missing evidence
or intended case/assertion changes explicitly; no fixed template is required.
