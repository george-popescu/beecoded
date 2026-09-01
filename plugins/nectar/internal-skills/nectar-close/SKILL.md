---
name: nectar-close
description: Use after completed work is accepted, or when Shape/Orient finds an already-done topic, to reconcile delivery evidence and safely remove live docs/work residue through manifest-backed prepare and post-commit finalize. Not for implementation, review, automatic commits, publication, or cleaning active/ambiguous work.
---

# Close

Close one complete work root without losing its evidence. The deterministic
runner owns discovery, identities, hashes, tracking, Git provenance, archive
state, and recovery. You own the user-visible changelog/backlog judgment and
context hand-off. Never reconstruct a topic path or token.

Ordinary Close always remains one-root. A release batch is available only when
an already-approved release/cleanup plan names the exact whole-root cleanup as
one task; it is not an interactive shortcut and never accepts legacy, tracked,
mixed, active, nested, overlapping, or partially reviewed roots.

## Safety boundary

This is a local evidence-safety mechanism, not a hostile same-user security
boundary. Pure Node cannot make every pathname check and SQLite path open
indivisible against a malicious process continuously swapping writable paths.
The runner narrows that window, stops on every observed drift, and preserves
recovery evidence. Do not claim stronger adversarial guarantees.

Close never commits, tags, pushes, publishes, deploys, recursively deletes, or
removes ignored/untracked evidence. It never closes one nested child: children
remain parent-owned until the entire parent is done. Unrelated roots and dirty
files do not block unless their active plan owns one of this topic's delivery
paths. Opaque helper-issued tokens are identity handles, not authority beyond
the current discovered state.

## 1. Discover

Run exactly:

```bash
node "../../scripts/run-close.mjs" discover
node "../../scripts/run-close.mjs" discover-support
node "../../scripts/run-close.mjs" inspect-pending
```

If a pending transaction exists, do not start another. Resume it with recovery,
or cancel only while its topic and support remain at the exact prepared
preimage. Surface discrepancies and `legacy-needing-adjudication`; neither is
completion. A closeable entry must be a direct dated root, legacy flat root, or
whole project parent whose exact children are all `done`.

Choose the exact topic entry by its user-visible `displayPath`, then retain only
its emitted topic token. Select support entries only when Close will reconcile
them: the project's tracked changelog and exact satisfied backlog file. Do not
include unrelated support merely because discovery listed it.

## 2. Prepare before support edits

Pass each emitted token as its own quoted argument:

```bash
node "../../scripts/run-close.mjs" prepare-token "<topic-token>" "<support-token>"
```

Prepare must finish before any selected changelog or backlog edit. It records
the complete preimage, tracking class, current HEAD, dirty delivery bytes,
ownership, context impact, and recovery state in `pending/current` without
removing the topic. Present its topic, tracking branch, delivery paths, selected
support, context decision, manifest hash, and pending recovery path.

After the durable preimage exists, make only the selected reconciliation:

- write a user-facing changelog entry that explains the delivered outcome;
- remove only backlog entries demonstrably satisfied by this delivery;
- leave ambiguous or unrelated entries unchanged.

Then seal the exact support postimages:

```bash
node "../../scripts/run-close.mjs" seal-support-token "<pending-token>"
```

If support was not selected, omit sealing. If reconciliation or sealing fails,
stop with the pending recovery path; never bypass the preimage.

## 3. User-created commit gate

Ask the user to create the required commit history. Do not create it yourself.
The gate differs by tracking branch:

- **tracked-only:** the exact prepared topic bytes must exist in the prepared
  HEAD or an intermediate user-created commit, and a later user-created cleanup
  commit must delete every tracked topic path.
- **ignored/untracked-only:** the delivery/support changes must be committed
  where trackable; the exact ignored topic remains in place for archive rename.
- **mixed:** exact tracked topic bytes need the same history and committed
  deletion, while the exact ignored/untracked residue remains in place for the
  archive.

Prepared dirty or untracked delivery files must appear byte-exact in the new
HEAD. Tracked support postimages must be committed and clean. Ignored support is
reported as local-only evidence and remains recoverable from the pending/archive
preimage and sealed postimage. Silence, a marker, or unchanged HEAD never passes.

## 4. Finalize or recover

After the user says the commit(s) exist, run:

```bash
node "../../scripts/run-close.mjs" finalize-token "<pending-token>"
```

Finalize validates the changed descendant HEAD, commit provenance, exact
delivery/support bytes, tracking branch, dirty overlap, and filesystem state
before mutation. SQLite serializes normal Close processes; immutable manifest
and filesystem states remain recovery authority. Ignored or mixed residue moves
to `.nectar/closures/archive/<id>/topic`; tracked-only evidence remains in Git
and the archive carries its manifest/result without a topic payload.

On an interrupted or explicitly recovery-required result, run only:

```bash
node "../../scripts/run-close.mjs" recover-token "<pending-token>"
```

Recovery accepts exact PRE or POST states, completes the same transaction, and
refuses any third state without overwriting it. Report the exact archive and
recovery path. To abandon a still-unmodified PRE transaction, use
`node "../../scripts/run-close.mjs" cancel-token "<pending-token>"`; cancellation
moves its evidence to the reported cancelled path instead of deleting it.

## 5. Doctor and context

Finalize reruns Doctor and returns error/warning counts. Zero Doctor errors is
required; legacy warnings may remain explicit. Never hide an active blocked
topic behind unrelated cleanup.

When `contextImpact.decision` is `refresh`, hand off to `nectar-context` refresh
after finalize and report its new base commit/freshness. When it is `skip`, quote
the helper's bounded volatile-only reason. Context status alone never proves a
post-delivery snapshot current.

End with: closed root, commit proof, tracking result, support result, Doctor
result, archive/recovery path, and context refresh/skip evidence. No publish and
no automatic commit are part of Close.

## Release-owned batch variant

For an approved release cleanup task only, run
`node "../../scripts/run-close.mjs" discover-release-batch`. Present the exact
`eligiblePaths`, rejected roots, discrepancies, immutable `assets` hash, and
batch token. The token binds the complete current eligible set; never remove,
add, reorder, or reconstruct a path. Any discrepancy blocks batch prepare.

After the user confirms that exact inventory, run
`node "../../scripts/run-close.mjs" prepare-release-batch-token
"<batch-token>" "<support-token>"`. The resulting single pending manifest owns
all roots, selected support, combined delivery paths, and the immutable assets
snapshot. Support sealing, the one user-created release commit, finalize,
recovery, Doctor, and context follow the ordinary steps using the one emitted
pending token. Finalize moves every member monotonically beneath one
`archive/<id>/topics/` directory and recovery completes a partially moved batch;
it never mutates `assets/`.
