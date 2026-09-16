# Test Value

Choose tests for observable product behavior and credible failures. A filename,
label change or framework involvement does not decide test value.

Protect business rules, security, tenancy, money, concurrency, recovery and public
contracts at the lowest layer that exercises the real behavior. Reuse existing
coverage. Do not add tests that merely mirror constants, copy, registration,
framework mechanics or implementation structure.

For non-contractual UI copy, observe the rendered result when appropriate; avoid
a permanent exact-copy test. For ordinary schema mechanics, use existing migration
and runtime checks. Custom data transformations need representative invariants,
restart/idempotency and failure evidence, often in an isolated rehearsal.

## Choose a route

- ADD_PRODUCT_TEST: valuable behavior has no adequate stable test.
- REUSE_EXISTING_TEST: a meaningful existing owner already covers it.
- NO_NEW_TEST: another proportional observation is sufficient.
- ISOLATED_REHEARSAL: representative disposable execution is more useful than
  permanent automation.

Use these labels when helpful to a caller or plan. One concise reason and the
selected evidence normally suffice; no mandatory nine-field map per task.

## Execution cadence

Write meaningful tests as part of implementation when needed. Final verification
after the integrated deliverable is the default. Red/green is useful for a concrete
regression or uncertain contract, not a compulsory sequence for every new test.

Run an early focused check when it will resolve a current uncertainty or unblock
dependent work. A wave ending is not a reason to rerun anything. Reuse results with
unchanged relevant inputs; after repairs rerun affected checks and broaden only
for a new integration concern or required project gate.

A passed command is evidence of what it exercised, not proof of every acceptance
criterion. Report missing evidence honestly. Implementation and verification are
separate progress states.

## Reviewing existing tests

Recommend KEEP, REMOVE, CONSOLIDATE, MOVE or REWRITE based on the protected behavior,
existing owner, stability and cost. Removing a bad test must preserve unique useful
coverage. A review recommendation alone does not authorize deletion.

Validate skill decisions with realistic requests and outcomes. Deterministic tests
belong to parsers, helpers and runtime contracts, not to checking the phrasing of
Markdown instructions.
