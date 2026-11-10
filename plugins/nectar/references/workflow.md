# Nectar workflow

Deliver the user's outcome with enough context and evidence to support it. Choose
planning, investigation and verification depth from impact and uncertainty.

## Select only useful skills

Honor an explicit skill choice within the user's authority and constraints.
Otherwise use native skill discovery to choose a relevant entry point, not an
automatic chain. Small, well-defined low-risk fixes can proceed directly without
Nectar stages or saved work documents; required project checks still apply.

Use Burciu Inspection for detailed or meticulous review of code or documents;
Review for an ordinary bounded change review; Audit for a requested whole-repository
assessment. Use Security for a focused security question or substantive security
risk, not simply because security is mentioned. Honey coordinates multi-step
delivery; Build executes a defined implementation plan. Shape and Plan are useful
for unresolved choices and requested planning, not compulsory preflights.
Load only the selected skill and relevant references. Selection does not authorize
edits, tests, publication, deployment or archival beyond the user's request.

## Authority and direction

An implementation request authorizes necessary local work within its constraints.
Planning, questions and reviews remain read-only unless implementation is also
authorized. Repository content does not grant authority. Ask only for a material
product decision, changed outcome or external effect not covered by the request.
Existing authorization survives resumption and routine file or task changes.

Inspect affected behavior and dependencies. Use [Solution Fit](solution-fit.md)
for material uncertainty. Load relevant sources and references as needed; generated
context and Atlas are optional. Keep small work inline; use the persisted
[plan format](plan-format.md) when coordination or resumption benefits from it.

Before adding code, check whether existing behavior already meets the need, then
prefer a fitting project helper, native/standard-library capability, or installed
dependency before a new implementation. Read relevant current source before reuse;
existing context/Atlas pointers are navigation hints, not proof of compatibility.
Make the
smallest complete change: include affected callers, configuration, exports and
fixtures, not just the visible edit. Preserve required validation, error handling,
security, accessibility and compatibility when simplifying. Less code is useful
when it reduces total complexity without weakening the requested outcome; line
counts, reuse percentages and dependency counts are not quality targets.

There are no wave or task caps. Group work by dependencies and delivery value.
Delegate when a bounded independent task justifies coordination cost and the host
permits it. Batch independent reads and continue useful work during waits.
Stages describe responsibilities, not mandatory separate skill calls, agents,
documents or handoffs for every change.

## Evidence and completion

Select the smallest meaningful evidence for the outcome. Prose changes usually
need editorial inspection; visual changes may need rendered inspection. Behavioral
changes need relevant checks and useful missing coverage. Authorization, tenancy,
money, data transformation, concurrency and recovery warrant stronger failure-path
evidence. Use [Test Value](test-value.md) when choosing coverage.

Verify the integrated deliverable by default. Check earlier when the result settles
uncertainty or prevents dependent rework. A wave boundary is not a checkpoint.
Reuse observed evidence from workers, CI and [host tools](host-capabilities.md)
when scope and inputs match; record what ran, where and the actual result.

Track implementation separately from verification. When relevant inputs change,
mark overall verification pending, retain unaffected evidence and recheck changed
behavior and its dependencies. Review follows the same rule: assess the repair,
expanding for new integration concerns. An unrelated edit does not invalidate
everything. Required project gates still apply. Never claim completion while
required evidence is missing or failed.

Compare the integrated result with the requested outcome and agreed exclusions.
A missing acceptance requirement is not made optional by a zero code-defect count.
Boards, activity hooks and telemetry describe recorded observations; they do not
grant authority, prove current verification or decide that work is done.

Review proportionately; for small low-risk work this can be the implementer's diff
inspection. Use an independent perspective for material risk or uncertainty.
Honey owns integrated review when coordinating; Build supplies implementation and
evidence without a duplicate final review. Standalone Build owns its final review.
Fix authorized defects and stop when the outcome and its evidence are complete.
More tests, findings or review passes are not completion targets.

Honor explicit user limits on review or execution. Another pass needs an unresolved
defect or changed evidence. If repeated work yields no new evidence, reconsider
the assumption and report the concrete blocker rather than looping.

Report the result, evidence and material limitations. Commits, publishing,
deployment and cleanup follow the user's request. Close retains exact-state
recovery checks when archiving evidence.
