# Solution Fit

Use this when a proposed change has material technical uncertainty. The purpose is
to check that the chosen solution actually fits the problem before investing in it.

Check the current behavior or root cause, direct consumers, existing abstractions,
important failure modes and compatibility. Inspect locked/local API behavior first;
use authoritative documentation where it leaves a meaningful uncertainty.

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
