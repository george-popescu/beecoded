---
name: nectar-rehearse
description: Rehearse a migration, import, backfill or risky upgrade in an isolated environment before rollout.
---

# Rehearse

Identify the operation, important data invariants and realistic failure modes.
Use the project's existing disposable environment or create a scoped temporary
one. Before execution, verify the resolved filesystem/database targets and outbound
integrations: staging credentials or a copied config do not establish isolation.
Use synthetic or approved sanitized data. Do not copy production secrets or data
merely to make the rehearsal realistic.

Exercise the real operation with representative normal and boundary data. Compare
the outcomes that matter: ownership, counts, totals, constraints, compatibility
and partial failures as applicable. Test interruption/resumption or repeat execution
when the operation promises it or rollout depends on it. Avoid a universal matrix
of checks unrelated to this operation.

Check recovery using the documented mechanism on the disposable target. Distinguish
rollback, restore and forward repair; some migrations are intentionally irreversible.
Report any unproven recovery step or difference from the rollout environment.
A successful local rehearsal does not authorize or prove production execution.

Prefer reusable existing fixtures and commands. Create permanent tests only when
they protect a recurring behavioral risk. Record the environment identity, operation,
observed invariants, failures and recovery evidence. Remove only owned temporary
resources when authorized and safe; leave shared environments unchanged.

Keep the work bounded to this rehearsal. Implementation or live rollout follows
the user's actual request; hand useful findings to the existing delivery workflow.
