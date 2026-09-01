# Test Value contract

Use this contract for every behavior affected by a planned change and for every
existing test considered during an explicit suite review. Test creation and
completion verification are separate decisions: a change may need no new
permanent test, but it always needs observed completion evidence.

This is a judgment contract, not a keyword classifier. Labels such as
"migration", "security", or "framework" are investigation leads; the evidence
about the actual behavior, owner, failure, and runtime boundary decides.

## 1. Behavior coverage map

Record one map per changed or reviewed behavior inside the approved plan. Use
concrete paths, commands, and outcomes rather than category-only claims.

```markdown
- **Protected behavior:** <observable product, data, or operational outcome>
- **Credible failure:** <specific regression and triggering conditions>
- **Impact:** <bounded user, business, security, or operational consequence>
- **Unique existing coverage:** <owning test/evidence path, or none>
- **Owning layer:** <domain/service/boundary/UI/journey/provider/runtime plus path>
- **Implementation independence:** <public outcome asserted without mirroring internals>
- **Runtime class and cost:** <unit/integration/E2E/rehearsal/manual and proportional cost>
- **Test decision:** <exactly one enum below plus evidence-backed reason>
- **Completion evidence:** <separate non-empty commands or observations>
```

The seven coverage fields precede exactly one test decision. The separate,
non-empty completion evidence route is mandatory for all four decisions.
`NO_NEW_TEST` never means no verification.

## 2. Test decision

- `ADD_PRODUCT_TEST` — add or extend stable permanent automation because a
  valuable behavior lacks an adequate owner. Use red/green/refactor at the
  lowest appropriate layer that exercises the real gate.
- `REUSE_EXISTING_TEST` — the named existing owner already protects the behavior
  at the correct layer. Run that owner and do not duplicate the rule in another
  layer merely to produce a new test file.
- `NO_NEW_TEST` — no valuable stable behavior needs new permanent automation, or
  the change is adequately protected by an existing contract plus a non-test
  evidence route. Implement without inventing a surrogate test.
- `ISOLATED_REHEARSAL` — realistic evidence is valuable but permanent automation
  would be unstable, destructive, provider-dependent, one-off, or
  disproportionate. Rehearse inside a declared disposable boundary and record
  setup, observed result, teardown, and no residue proof.

Evidence and engineering judgment choose the decision, not a filename, diff
size, framework keyword, requested implementation technique, or desire to make
a test count rise. When an explicit user requirement requires a test, retain it
as an acceptance constraint, while still selecting the lowest valuable owner
and avoiding duplicate assertions.

## 3. Ownership and value rules

Prefer the lowest appropriate layer that can fail for the real behavior:

- Domain and service tests own business rules and state transitions.
- Boundary/integration tests own persistence constraints, tenant isolation,
  public APIs, provider payloads, and framework integration that is itself a
  product contract.
- End-to-end tests own only critical journeys whose cross-layer wiring is the
  behavior; they do not duplicate every lower-layer rule.

Strong permanent ownership is normally valuable for domain invariants,
security and anti-enumeration, tenancy, financial correctness, concurrency and
idempotency, provider/public contract compatibility, destructive recovery, and
critical journeys. Existing unique valuable coverage is never removed as
framework noise merely because the framework participates in its runtime path.

The following normally resolve to `NO_NEW_TEST` when no stronger product
contract is present: a label, non-contractual copy, ordinary framework behavior,
registration boilerplate, static wiring, a generated/configured constant, and
duplicate coverage of a rule already owned at a lower layer. Select concrete
build, lint, typecheck, render, browser, diff, boot, or runtime evidence instead.
For user-visible labels or copy with a renderable surface, source occurrence,
syntax/import success, or a new exact-string assertion is not sufficient
completion evidence by itself. Observe the rendered or browser-visible output
through that surface, or use a bounded one-off render when a browser is not
available; do not preserve that observation as a permanent copy test.

## 4. Standard migrations and custom data work

A standard framework/schema migration whose only behavior is ordinary schema
mechanics normally selects `NO_NEW_TEST`; suitable completion evidence may
include schema diff, migration dry-run, rollback verification, build/boot, and
runtime smoke. Do not create a permanent test that merely proves the framework
runs its own migration primitive.

A custom backfill or data transformation is different. Inspect data invariants,
idempotency, batching and restart behavior, rollback/recovery, scale, and
production-like outcomes. Select `ADD_PRODUCT_TEST` when those stable rules have
a maintainable owner, or `ISOLATED_REHEARSAL` when representative data/runtime
proof is necessary but permanent automation would be a misleading surrogate.

## 5. Completion evidence

Choose evidence independently from the test decision and name its exact route in
the plan. Examples include the owning focused test, broader regression suite,
lint/typecheck/build, schema or generated diff, render/browser inspection,
isolated database/provider rehearsal, runtime smoke, or a bounded manual check.
Use only evidence that can observe the claimed outcome.

Wave close replays every task's approved evidence route and quotes the observed
result. Missing, changed, or failed evidence is a verification failure even when
the test decision remains valid. A changed behavior, owner, decision, or evidence
route is plan drift and requires the normal revision and approval boundary.

## 6. Existing suite dispositions

Apply these only to tests inside the frozen review scope or an explicit
suite-review/test-health scope. They are a recommendation and never authorize
Review, Audit, Lens, or Validator to edit or delete tests.

- `KEEP` — unique, valuable, stable, implementation-independent ownership at an
  appropriate layer.
- `REMOVE` — no protected behavior, or safely redundant framework/label/static
  noise whose valuable outcome remains owned elsewhere.
- `CONSOLIDATE` — multiple tests own the same rule; retain one clear owner and
  remove redundant paths through an approved implementation plan.
- `MOVE` — the behavior is valuable but its current layer is wrong, brittle, or
  unnecessarily expensive.
- `REWRITE` — the behavior remains valuable but the test is stale, flaky,
  implementation-coupled, or no longer exercises the live gate.

A coverage gap is confirmed only when the complete map supports
`ADD_PRODUCT_TEST`. A bad existing test is not automatically a gap; it may be
`REWRITE`, `MOVE`, or redundant coverage with no missing product behavior.

## 7. Validation boundary

Deterministic tests may prove this schema, vocabulary, receipt binding, and
cross-caller wiring. They do not prove model compliance or that a model chose the
right decision. Behavioral, final-workspace, and cross-host cases belong to
child 04 and must grade observed outcomes, traces, and residue rather than merely
matching these words.

This compact shared contract follows current agent-evaluation guidance to use
representative outcome/trace graders and to state each instruction once:

- https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- https://developers.openai.com/api/docs/guides/latest-model
