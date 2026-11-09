# Solution Fit

Use this when a proposed change has material technical uncertainty. The purpose is
to check that the chosen solution actually fits the problem before investing in it.

Check the current behavior or root cause, direct consumers, existing abstractions,
important failure modes and compatibility. Inspect locked/local API behavior first;
use authoritative documentation where it leaves a meaningful uncertainty.

First consider whether existing behavior already satisfies the outcome. Otherwise
prefer a fitting project helper or component, then a native or standard-library
capability, then an installed dependency, before writing new code or adding a
dependency. Name the reusable implementation when it matters. This is a preference,
not a ban on justified abstractions or dependencies; compare behavior, compatibility
and maintenance cost, not line count alone.

Ground scale and performance choices in the expected data size, concurrency and
deployment model. Use repository evidence or explicit requirements; state material
assumptions rather than inventing future load. For a deliberate limitation, record
its practical boundary and revisit condition using existing project conventions.
A documented compromise does not excuse a broken requirement or safety boundary.

Choose a proportional solution and record the important tradeoff. A small obvious
change may need only a sentence; a feature may need a short design section.
Independent investigation or review is useful for unfamiliar or high-impact
boundaries. It is not a mandatory extra agent for every edit.

Useful conclusions are FIT, PARTIAL, UNFIT or BLOCKED. Explain the evidence and
remaining uncertainty in plain language. Do not claim FIT while a material
assumption remains unresolved. Resolve that assumption, choose another approach,
or report the concrete blocker.

The user's outcome and constraints bound the work. Routine implementation
adjustments inside them do not need a fresh approval ceremony. Ask only when the
answer changes the product, authority, material risk or external effect.

For a legacy Debug promotion, the helper still expects the canonical investigation
section described in [debug promotion](debug-promotion.md). That compatibility
format is not required for every new design.
