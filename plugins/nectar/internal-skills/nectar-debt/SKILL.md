---
name: nectar-debt
description: Inspect deliberate limitations and deferred work already recorded in source comments; report concrete follow-up without changing code.
---

# Debt

Use `nectar debt [path] --json` to locate recorded candidates in the requested
project. This is a read-only inventory, not a whole-codebase audit or a request to
repair everything. Inspect each relevant location and its surrounding behavior;
a marker can be an example, a keyboard shortcut or an obsolete note.

Report the location, actual limitation and any recorded revisit condition. State
when the limit or condition is missing instead of inventing it. Prioritize against
current requirements and expected use; a deliberate compromise is not automatically
a defect, but a comment does not excuse a security issue or broken requirement.
Preserve the project's marker conventions; do not add comments merely to populate
the report. No matches means no recorded candidates found, not a debt-free project.

Capture saves a new deferred idea; Debt reads existing records. Do not create a
second ledger by default. Saving a report, reconciling notes or implementing repairs
requires that scope in the user's request. Finish with actionable findings and
material scan limitations, without an automatic test run or source cleanup.
