---
name: nectar-build
description: Implement an authorized change or plan and verify the integrated result.
---

# Build

Use the [workflow contract](../../references/workflow.md). Implement the outcome
and acceptance criteria with current source and repository conventions. Resume
from actual progress; update the [persisted plan](../../references/plan-format.md)
when useful task grouping, files or verification commands change.

Group related work and respect dependencies and write ownership. For delegated
implementation, use the [implementer](../../agents/implementer.md) role with a
bounded outcome and relevant context. A task does not require its own agent.

Select verification from changed behavior and risk. [Test Value](../../references/test-value.md)
guides coverage; [host capabilities](../../references/host-capabilities.md) helps
reuse native runtime and review evidence. Neither a handoff nor a completed wave
requires another run. Mark tasks implemented when present and keep overall
verification pending until the integrated outcome has sufficient evidence.

Fix failures caused by this work and rerun affected checks. Preserve unaffected
evidence. Standalone Build owns a proportional final review; when Honey coordinates
delivery, return evidence to Honey and let it own that review once.

Report the outcome, observed evidence and remaining limitations. Continue repairs
inside the authorized scope; follow the user's commit and release instructions.
