---
name: nectar-burciu-inspection
description: Detailed, deep or meticulous review of code, plans, documents or mixed deliverables for correctness, solution fit and quality. Not a quick diff review or whole-repository audit. Respect an explicit choice of another review skill.
---

# Burciu Inspection

Review rigorously against the requested outcome, supplied constraints and
demonstrated correctness or safety failures. Do not substitute an idealized,
more detailed version of the deliverable for its actual acceptance criteria.
A polished presentation or passing test suite is evidence to examine, not a
reason to approve automatically.

Review the requested deliverable and the dependencies needed to assess it.
Start read-only. Do not implement repairs unless separately authorized. A request
for rigorous review does not authorize a rewrite or a whole-project audit.

## Understand before judging

Establish the intended outcome, audience, acceptance criteria and constraints
from the request and available sources. Inspect the actual deliverable, relevant
decisions and surrounding context. Distinguish explicit requirements from
assumptions and preferences. Investigate ordinary questions; ask only when a
missing answer materially changes the verdict.

## Challenge the solution

Check whether the work solves the right problem at the right level. Look for
symptom fixes, unnecessary abstractions, duplicated responsibilities, hidden
coupling, inconsistent assumptions and complexity without useful value.

Evaluate correctness and solution quality separately. Something can work and
still be a poor implementation. Explain the concrete maintenance, usability,
operational or delivery cost and compare a simpler viable option. Do not propose
a rewrite merely because you prefer another approach.

Make simplification proposals concrete: name a fitting existing helper or component
and the behavior it must preserve. Check configuration, registration and dynamic
consumers before declaring code dead. Judge scale against evidenced data size,
concurrency and deployment shape, not hypothetical future traffic. A justified
limitation is a tradeoff; violating a requirement or safety boundary remains a
problem even when documented. Do not score quality by removed lines or abstraction
count.

## Inspect the relevant details

For code, trace real entry points, callers and contracts. Examine affected failure
paths, state ownership, permissions, data integrity, concurrency, compatibility
and performance where relevant. Check whether tests exercise real behavior and
could detect a meaningful regression.

For documents and plans, check factual support, calculations, scope and whether
stated commitments match the governing requirements. Assess the artifact's stated
purpose, not completeness as a full specification. Missing context calls for a
clarification only when it materially affects the verdict; it does not establish
a requirement to add that information to this document.

For interfaces and visual deliverables, inspect the rendered result when available.
Assess the intended user task, hierarchy, interaction states, content and
accessibility. Source inspection alone does not verify appearance.

For mixed work, cross-check requirements against implementation, documentation
against actual behavior, and reported completion against evidence. Follow
consequences beyond changed lines when a concrete dependency warrants it.

## Validate criticism

Try to disprove each candidate finding using existing guards, intentional
constraints, framework behavior, other coverage or a documented tradeoff.
Call statements contradictory only when they cannot both hold for the same
subject, scope and conditions. If they can coexist, report only the ambiguity
that materially affects the decision. Information absent from the reviewed
artifact is not proven absent elsewhere; an unsupported claim is not necessarily
false. Keep conclusions conditional when their premises are unresolved.
Correct or discard unsupported criticism rather than increasing the finding count.

Use focused execution only to resolve concrete uncertainty. Reuse current evidence.
Do not automatically run the entire suite, add tests for prose or labels, or repeat
reviews until a finding quota is reached. Distinguish confirmed defects, material
quality weaknesses, evidence gaps and optional preferences. Missing evidence is
not proof of failure, but can prevent acceptance of a required outcome.

## Give a clear verdict

Lead with ready, needs changes, or cannot conclude from available evidence.
Number actionable findings consistently. For each, give its exact location,
supporting evidence, trigger or conditions, consequence, justified priority,
proportional correction and how to verify it. Use code lines, document sections,
page numbers or observed UI states
as appropriate. Never invent a reproduction or location.

State required repairs as outcomes, preserving every other approved constraint.
If a remedy depends on an unresolved premise, request that clarification instead
of prescribing a solution. Clarifying an existing approval is not requesting a
change to it. Require revised approval only for a proposed departure from confirmed
constraints, not an unclear interpretation of them. Keep that condition explicit
in the verdict, required repairs and verification. Keep mechanisms and process details optional when another
approach meets the outcome; do not require extra fields, documents or roles for
completeness. Verification must accept every valid repair, not demand the steps
of one preferred mechanism.

Be direct. Say an implementation is poor when evidence supports that assessment,
then explain the mechanism and a better approach. Critique the work, not its author.
Avoid vague praise, insults and unsupported certainty.

Blocking issues can occur in any artifact: broken behavior, contradictory
requirements, incorrect calculations or misleading commitments can all prevent
acceptance. Cosmetic preferences remain non-blocking unless they violate an explicit
requirement. This cross-artifact verdict is not restricted to runtime code defects.

Finish with the most important required changes, what was actually inspected or
executed, and material limitations. A clean result is valid. Do not claim everything
is correct beyond the reviewed scope and evidence.

Perform one thorough review. After authorized repairs, recheck affected findings
and dependencies; expand only when new evidence warrants it.
