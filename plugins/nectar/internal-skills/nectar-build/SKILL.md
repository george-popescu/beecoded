---
name: nectar-build
description: Execute an already approved multi-step or cross-component implementation plan and verify the result. Small, well-defined low-risk edits need no workflow skill unless explicitly requested.
---

# Build

Use the [workflow contract](../../references/workflow.md). Implement the outcome
and acceptance criteria with current source and repository conventions. Resume
from actual progress. Update an existing persisted plan when dependencies or
verification change; load the [plan format](../../references/plan-format.md) only
when creating or changing its structure.

When a contract changes, trace its affected consumers and complete the necessary
wiring. Fix a shared cause at its owner rather than patching one caller. If source
evidence contradicts a plan assumption, reassess the dependent work within the
authorized outcome instead of implementing that assumption mechanically.

Group related work and respect dependencies and write ownership. For delegated
implementation, use the [implementer](../../agents/implementer.md) role with a
bounded outcome and relevant context. A task does not require its own agent.

Select verification from changed behavior and risk. Read [Test Value](../../references/test-value.md)
when coverage choices are uncertain, or [host capabilities](../../references/host-capabilities.md)
when runtime evidence or delegation support is unclear. Neither a handoff nor a
completed wave requires another run. Mark tasks implemented when present and keep overall
verification pending until the integrated outcome has sufficient evidence.

Fix failures caused by this work and rerun affected checks. Preserve unaffected
evidence. Standalone Build owns a proportional final review; when Honey coordinates
delivery, return evidence to Honey and let it own that review once.

Report the outcome, observed evidence and remaining limitations. Continue repairs
inside the authorized scope; follow the user's commit and release instructions.
