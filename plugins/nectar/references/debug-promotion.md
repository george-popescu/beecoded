# Promoting an existing debug hunt

Use only when a topicless `docs/work/debug/<slug>.md` should become a feature's
durable evidence. The Debug skill supplies the installed
`DEBUG_PROMOTION_LAUNCHER`; copy it exactly and pass only helper-issued tokens.

1. Run `DEBUG_PROMOTION_LAUNCHER discover` and select the exact displayed hunt.
2. Run `DEBUG_PROMOTION_LAUNCHER create-design-stage <SOURCE_TOKEN>`. Write the
   design through filesystem tools only to the returned `designPath`.
3. Include Problem, Approach, Acceptance criteria and Out of scope. This legacy
   promotion helper also requires the following concrete section:

   ```markdown
   ## Investigation and fit
   - **Investigation scope:** affected entry points and contracts
   - **Confirmed current behavior:** supported cause
   - **Selected candidate:** fitted repair
   - **Evidence:** relevant current sources
   - **Solution fit:** FIT
   - **Remaining uncertainty:** named non-material uncertainty or none
   ```

   Preserve the complete original hunt verbatim in the design and include its
   exact `Investigation evidence SHA-256: <digest>`. This binds the actual evidence
   move; ordinary planning does not need this field.
4. Run `DEBUG_PROMOTION_LAUNCHER seal-design-stage <STAGE_TOKEN>` and retain the
   returned sealed token.
5. Run `DEBUG_PROMOTION_LAUNCHER promote-token <SOURCE_TOKEN> <SEALED_STAGE_TOKEN>`.
   It verifies root/membership, bytes, identities and no-follow paths before
   preserving the hunt as `investigation-evidence.md` beside the design.

A committed result reports stage cleanup separately. If cleanup is retained,
report its path; do not repeat an already committed promotion. On failure preserve
the reported source/stage/recovery evidence. To abandon an unchanged sealed stage,
use `DEBUG_PROMOTION_LAUNCHER dispose-design-stage <SEALED_STAGE_TOKEN>`.

Never overwrite a reappeared source or manually remove ambiguous recovery files.
The helper owns rollback of its own objects. Its checks narrow filesystem races;
they are not a security boundary against another hostile process running as the
same user.
