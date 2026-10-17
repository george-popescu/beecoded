---
name: nectar-release
description: Prepare or execute a requested software release and verify the published artifact or deployed version.
---

# Release

Resolve the deliverable, intended version, destination and existing authorization
from the request and repository's release procedure. Preparation alone does not
authorize publishing. Use the project's actual commands and required gates;
do not invent a universal deployment sequence or change delivery conventions.

Inspect relevant Git state, version metadata and release configuration. Prepare
the requested changelog and artifact, reusing checks valid for its exact inputs.
Preserve unrelated changes and staged files. If an artifact was already validated,
verify its identity and use it; source or build-input drift needs affected checks
and a new artifact, not an unverified repack at publication time.

Execute Git, registry, store or deployment actions only within the user's existing
authority. Resolve genuinely missing destination or access before external writes.
Use the host's secure sign-in flow for credentials. A timeout or ambiguous response
requires checking remote state before retrying an action that may have succeeded.

Verify the result at the actual destination: artifact/version identity in a registry,
deployed revision and relevant health behavior for a service, or the store's actual
upload/review/publication state. Local tests, an upload or a queued deployment are
not proof of a live release. Report observed and pending stages separately.

Keep recovery proportional to the change. Data-changing rollouts may need
[Rehearse](../nectar-rehearse/SKILL.md); never assume a database rollback is safe.
Report the version, destination, evidence and remaining action. Existing release
authority persists across routine steps; do not repeatedly request confirmation.
