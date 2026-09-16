---
name: nectar-debug
description: Diagnose a concrete failure and identify a repair supported by current evidence.
---

# Debug

Use the [workflow contract](../../references/workflow.md). Establish the cause
before committing to a repair. Read the actual error, affected entry points and
recent changes; use a reproduction, logs or another decisive observation.

Choose hypotheses from evidence and test the cheapest decisive one first. Do not
force a fixed number of hypotheses, agents or attempts. When repeated checks
produce no new evidence, revisit assumptions and report the concrete missing input.

A diagnosis-only request ends with the confirmed cause, evidence and recommended
repair. If the user also asked for a fix, continue with a fitted local repair and
appropriate verification under that authority. Read-only investigations can use
a disposable copy when a diagnostic needs temporary instrumentation.

Use [Solution Fit](../../references/solution-fit.md) for material uncertainty and
[Test Value](../../references/test-value.md) to choose a meaningful regression or
another evidence route. An existing reproduction can be reused. Investigation,
implementation and verification need not become separate approval ceremonies.

## Durable evidence when needed

For a hunt that needs resumption, keep a short `debug-<slug>.md` in its active
topic, or `docs/work/debug/<slug>.md` for topicless work. Record cause candidates,
decisive results and the next unresolved question; do not copy entire tool logs.

After a topic-local repair is verified, preserve the complete hunt under an unused
`investigation-<slug>.md` name in the same topic. Rename only this task's normal,
non-symlink file and never overwrite an existing destination. The `debug-` prefix
means an active hunt to Doctor, so a resolved record must leave that prefix before
the topic can be done. Retain any recovery file or unresolved evidence as-is.

If an existing topicless evidence file should be promoted into a feature design,
use [debug promotion](../../references/debug-promotion.md). That helper preserves
evidence transactionally. Ordinary small fixes do not require promotion.

The installed helper launcher is:

```text
DEBUG_PROMOTION_LAUNCHER = node "../../scripts/debug-promotion.mjs"
```

Use helper-issued tokens for promotion. Do not manually move/delete recovery
files or retry an already committed promotion because stage cleanup was retained.
Report the cause, repair when requested, observed verification and any limitation.
