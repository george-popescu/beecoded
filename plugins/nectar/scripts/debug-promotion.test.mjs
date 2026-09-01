import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulePath = path.join(pluginRoot, 'scripts/debug-promotion.mjs');

async function loadPromotion() {
  assert.equal(fs.existsSync(modulePath), true, 'debug promotion runner must exist');
  return import(`${pathToFileURL(modulePath).href}?test=${Date.now()}-${Math.random()}`);
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-debug-promotion-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'docs/work/debug'), { recursive: true });
  const sourceRelative = 'docs/work/debug/payment-race.md';
  const source = path.join(root, sourceRelative);
  const evidence = '# Debug hunt\n\nRoot cause: concurrent overwrite.\n';
  fs.writeFileSync(source, evidence);
  const digest = crypto.createHash('sha256').update(evidence).digest('hex');
  const designContent = `# Payment race — Design

## Problem
Concurrent writes lose data.

## Investigation and fit
- **Investigation scope:** payment writer
- **Confirmed current behavior:** concurrent overwrite
- **Selected candidate:** compare-and-swap
- **Evidence:**

Investigation evidence SHA-256: ${digest}

${evidence}
- **Solution fit:** FIT
- **Remaining uncertainty:** none

## Approach
Use compare-and-swap.

## Acceptance criteria
- [ ] Concurrent writes do not lose data.

## Out of scope
- Provider retries.
`;
  return {
    root,
    source,
    sourceRelative,
    destinationRelative: 'docs/work/2026-08-29-payment-race',
    designContent,
    evidence,
  };
}

function trackStage(t, created) {
  const stageRoot = path.dirname(created.designDisplayPath);
  t.after(() => fs.rmSync(stageRoot, { recursive: true, force: true }));
  return stageRoot;
}

test('discovers root-bound debug sources and rejects tamper, replay, drift, and recovery claims', async (t) => {
  const {
    createDebugDesignStage,
    discoverDebugInvestigations,
  } = await loadPromotion();
  const item = fixture(t);
  fs.writeFileSync(
    path.join(item.root, 'docs/work/debug/recovery-payment-race-deadbeef.md'),
    item.evidence,
  );
  fs.writeFileSync(path.join(item.root, 'docs/work/debug/not eligible.md'), item.evidence);

  const discovered = discoverDebugInvestigations({ projectRoot: item.root });
  assert.deepEqual(discovered.entries.map((entry) => entry.displayPath), [item.sourceRelative]);
  assert.match(discovered.entries[0].token, /^[A-Za-z0-9_-]+$/);
  assert.equal(
    discovered.entries.some((entry) => entry.displayPath.includes('/recovery-')),
    false,
  );

  const sourceToken = discovered.entries[0].token;
  const tampered = `${sourceToken.slice(0, -1)}${sourceToken.endsWith('A') ? 'B' : 'A'}`;
  assert.throws(
    () => createDebugDesignStage({ projectRoot: item.root, sourceToken: tampered }),
    /token/i,
  );

  const replay = fixture(t);
  assert.throws(
    () => createDebugDesignStage({ projectRoot: replay.root, sourceToken }),
    /root.*(?:replay|mismatch)/i,
  );

  fs.appendFileSync(item.source, 'new evidence\n');
  assert.throws(
    () => createDebugDesignStage({ projectRoot: item.root, sourceToken }),
    /current discovery|membership/i,
  );
});

test('rejects secret-like source evidence before staging or promotion', async (t) => {
  const {
    discoverDebugInvestigations,
    promoteDebugInvestigation,
  } = await loadPromotion();
  const item = fixture(t);
  const secretEvidence = `${item.evidence}OPENAI_API_KEY=sk-${'a'.repeat(24)}\n`;
  const secretDigest = crypto.createHash('sha256').update(secretEvidence).digest('hex');
  const secretDesign = item.designContent
    .replace(crypto.createHash('sha256').update(item.evidence).digest('hex'), secretDigest)
    .replace(item.evidence, secretEvidence);
  fs.writeFileSync(item.source, secretEvidence);

  const discovered = discoverDebugInvestigations({ projectRoot: item.root });
  assert.deepEqual(discovered.entries, []);
  assert.equal(discovered.discrepancies.length, 1);
  assert.match(discovered.discrepancies[0].error, /secret-like.*redact/i);
  assert.doesNotMatch(discovered.discrepancies[0].error, /sk-[a-z0-9_-]+/i);

  assert.throws(
    () => promoteDebugInvestigation({ ...item, designContent: secretDesign }),
    /secret-like.*redact/i,
  );
  assert.equal(fs.readFileSync(item.source, 'utf8'), secretEvidence);
  assert.equal(fs.existsSync(path.join(item.root, item.destinationRelative)), false);
});

test('rejects secret-like staged design content before sealing', async (t) => {
  const {
    createDebugDesignStage,
    discoverDebugInvestigations,
    sealDebugDesignStage,
  } = await loadPromotion();
  const item = fixture(t);
  const sourceToken = discoverDebugInvestigations({ projectRoot: item.root }).entries[0].token;
  const created = createDebugDesignStage({ projectRoot: item.root, sourceToken });
  const stageRoot = trackStage(t, created);
  fs.writeFileSync(
    created.designDisplayPath,
    `${item.designContent}\nclient_secret=${'b'.repeat(24)}\n`,
  );

  assert.throws(
    () => sealDebugDesignStage({ stageToken: created.stageToken }),
    /secret-like.*redact/i,
  );
  assert.equal(fs.existsSync(stageRoot), true);
  assert.equal(fs.existsSync(item.source), true);
  assert.equal(fs.existsSync(path.join(item.root, item.destinationRelative)), false);
});

test('creates a private fixed-name design stage and seals only exact fitted bytes', async (t) => {
  const {
    createDebugDesignStage,
    discoverDebugInvestigations,
    sealDebugDesignStage,
  } = await loadPromotion();
  const item = fixture(t);
  const sourceToken = discoverDebugInvestigations({ projectRoot: item.root }).entries[0].token;
  const created = createDebugDesignStage({
    projectRoot: item.root,
    sourceToken,
    now: new Date(2026, 7, 30, 12, 0, 0),
  });
  const stageRoot = trackStage(t, created);

  assert.equal(path.basename(created.designDisplayPath), 'design.md');
  assert.equal(created.destinationDisplayPath, 'docs/work/2026-08-30-payment-race');
  assert.equal(fs.statSync(stageRoot).mode & 0o777, 0o700);
  const marker = fs.readdirSync(stageRoot).find((name) => name.startsWith('.nectar-'));
  assert.ok(marker);
  assert.equal(fs.statSync(path.join(stageRoot, marker)).mode & 0o777, 0o600);

  fs.writeFileSync(created.designDisplayPath, item.designContent);
  fs.writeFileSync(path.join(stageRoot, 'foreign.txt'), 'retain me');
  assert.throws(
    () => sealDebugDesignStage({ stageToken: created.stageToken }),
    /exact|extra|unexpected/i,
  );
  assert.equal(fs.readFileSync(path.join(stageRoot, 'foreign.txt'), 'utf8'), 'retain me');
  fs.unlinkSync(path.join(stageRoot, 'foreign.txt'));

  const sealed = sealDebugDesignStage({ stageToken: created.stageToken });
  assert.notEqual(sealed.stageToken, created.stageToken);
  assert.equal(sealed.designSha256, crypto.createHash('sha256').update(item.designContent).digest('hex'));
});

test('promotes only a paired current source and sealed stage, then disposes the exact stage', async (t) => {
  const {
    createDebugDesignStage,
    discoverDebugInvestigations,
    promoteDebugInvestigationFromTokens,
    sealDebugDesignStage,
  } = await loadPromotion();
  const item = fixture(t);
  const secondRelative = 'docs/work/debug/second-hunt.md';
  fs.writeFileSync(path.join(item.root, secondRelative), '# Other evidence\n');
  const entries = discoverDebugInvestigations({ projectRoot: item.root }).entries;
  const sourceToken = entries.find((entry) => entry.displayPath === item.sourceRelative).token;
  const otherToken = entries.find((entry) => entry.displayPath === secondRelative).token;
  const created = createDebugDesignStage({
    projectRoot: item.root,
    sourceToken,
    now: new Date(2026, 7, 30, 12, 0, 0),
  });
  const stageRoot = trackStage(t, created);
  fs.writeFileSync(created.designDisplayPath, item.designContent);
  const sealed = sealDebugDesignStage({ stageToken: created.stageToken });

  assert.throws(
    () => promoteDebugInvestigationFromTokens({
      projectRoot: item.root,
      sourceToken: otherToken,
      stageToken: sealed.stageToken,
    }),
    /source.*(?:pair|match)|stage.*source/i,
  );
  assert.equal(fs.existsSync(item.source), true);

  const result = promoteDebugInvestigationFromTokens({
    projectRoot: item.root,
    sourceToken,
    stageToken: sealed.stageToken,
  });
  assert.equal(result.committed, true);
  assert.deepEqual(result.stageCleanup, { disposed: true });
  assert.equal(fs.existsSync(stageRoot), false);
  assert.equal(fs.existsSync(item.source), false);
  assert.equal(
    fs.readFileSync(path.join(item.root, created.destinationDisplayPath, 'design.md'), 'utf8'),
    item.designContent,
  );
});

test('sealed-stage disposal refuses drift and never recursively deletes foreign entries', async (t) => {
  const {
    createDebugDesignStage,
    discoverDebugInvestigations,
    disposeDebugDesignStage,
    sealDebugDesignStage,
  } = await loadPromotion();
  const item = fixture(t);
  const sourceToken = discoverDebugInvestigations({ projectRoot: item.root }).entries[0].token;
  const created = createDebugDesignStage({ projectRoot: item.root, sourceToken });
  const stageRoot = trackStage(t, created);
  fs.writeFileSync(created.designDisplayPath, item.designContent);
  const sealed = sealDebugDesignStage({ stageToken: created.stageToken });
  const foreign = path.join(stageRoot, 'foreign');
  fs.mkdirSync(foreign);
  fs.writeFileSync(path.join(foreign, 'keep.txt'), 'foreign bytes');

  assert.throws(
    () => disposeDebugDesignStage({ stageToken: sealed.stageToken }),
    /retained|manifest|unexpected|extra/i,
  );
  assert.equal(fs.readFileSync(path.join(foreign, 'keep.txt'), 'utf8'), 'foreign bytes');
  assert.equal(fs.existsSync(created.designDisplayPath), true);
});

test('promotion failure retains the sealed design stage and committed cleanup refusal is a warning', async (t) => {
  const {
    createDebugDesignStage,
    discoverDebugInvestigations,
    promoteDebugInvestigationFromTokens,
    sealDebugDesignStage,
  } = await loadPromotion();

  const collision = fixture(t);
  const collisionToken = discoverDebugInvestigations({ projectRoot: collision.root }).entries[0].token;
  const collisionStage = createDebugDesignStage({
    projectRoot: collision.root,
    sourceToken: collisionToken,
    now: new Date(2026, 7, 30, 12, 0, 0),
  });
  const collisionStageRoot = trackStage(t, collisionStage);
  fs.writeFileSync(collisionStage.designDisplayPath, collision.designContent);
  const collisionSealed = sealDebugDesignStage({ stageToken: collisionStage.stageToken });
  fs.mkdirSync(path.join(collision.root, collisionStage.destinationDisplayPath));

  assert.throws(
    () => promoteDebugInvestigationFromTokens({
      projectRoot: collision.root,
      sourceToken: collisionToken,
      stageToken: collisionSealed.stageToken,
    }),
    /destination already exists.*Design stage retained/is,
  );
  assert.equal(fs.existsSync(collision.source), true);
  assert.equal(fs.existsSync(collisionStage.designDisplayPath), true);
  assert.equal(fs.existsSync(collisionStageRoot), true);

  const cleanupFailure = fixture(t);
  const cleanupToken = discoverDebugInvestigations({ projectRoot: cleanupFailure.root }).entries[0].token;
  const cleanupStage = createDebugDesignStage({
    projectRoot: cleanupFailure.root,
    sourceToken: cleanupToken,
    now: new Date(2026, 7, 30, 12, 0, 0),
  });
  const cleanupStageRoot = trackStage(t, cleanupStage);
  fs.writeFileSync(cleanupStage.designDisplayPath, cleanupFailure.designContent);
  const cleanupSealed = sealDebugDesignStage({ stageToken: cleanupStage.stageToken });
  const originalUnlink = fs.unlinkSync;
  fs.unlinkSync = (target) => {
    if (path.resolve(target) === path.resolve(cleanupStage.designDisplayPath)) {
      const error = new Error('injected design-stage cleanup refusal');
      error.code = 'EIO';
      throw error;
    }
    return originalUnlink(target);
  };
  let result;
  try {
    result = promoteDebugInvestigationFromTokens({
      projectRoot: cleanupFailure.root,
      sourceToken: cleanupToken,
      stageToken: cleanupSealed.stageToken,
    });
  } finally {
    fs.unlinkSync = originalUnlink;
  }

  assert.equal(result.committed, true);
  assert.equal(result.stageCleanup.disposed, false);
  assert.equal(result.stageCleanup.retainedPath, cleanupStageRoot);
  assert.match(result.stageCleanup.warning, /cleanup refusal/i);
  assert.equal(fs.existsSync(cleanupFailure.source), false);
  assert.equal(fs.existsSync(path.join(cleanupFailure.root, cleanupStage.destinationDisplayPath, 'design.md')), true);
  assert.equal(fs.existsSync(cleanupStage.designDisplayPath), true);
});

test('CLI derives root from cwd and rejects the legacy raw-path interface', async (t) => {
  const item = fixture(t);
  const discovered = spawnSync(process.execPath, [modulePath, 'discover'], {
    cwd: item.root,
    encoding: 'utf8',
  });
  assert.equal(discovered.status, 0, discovered.stderr);
  assert.equal(JSON.parse(discovered.stdout).entries[0].displayPath, item.sourceRelative);

  const designFile = path.join(item.root, 'staged-design.md');
  fs.writeFileSync(designFile, item.designContent);
  const raw = spawnSync(process.execPath, [
    modulePath,
    '--project-root', item.root,
    '--source', item.sourceRelative,
    '--destination', item.destinationRelative,
    '--design-file', designFile,
  ], { cwd: item.root, encoding: 'utf8' });
  assert.equal(raw.status, 1);
  assert.match(raw.stderr, /raw path.*disabled|use discover/i);
  assert.equal(fs.existsSync(item.source), true);
  assert.equal(fs.existsSync(path.join(item.root, item.destinationRelative)), false);
});

test('promotes complete evidence into a dated design before removing the owned hunt', async (t) => {
  const { promoteDebugInvestigation } = await loadPromotion();
  const item = fixture(t);

  const result = promoteDebugInvestigation(item);
  const designPath = path.join(fs.realpathSync(item.root), item.destinationRelative, 'design.md');
  const evidencePath = path.join(
    fs.realpathSync(item.root),
    item.destinationRelative,
    'investigation-evidence.md',
  );

  assert.equal(fs.existsSync(item.source), false);
  assert.equal(fs.readFileSync(designPath, 'utf8'), item.designContent);
  assert.deepEqual(fs.readFileSync(evidencePath), Buffer.from(item.evidence));
  assert.equal(result.designPath, designPath);
  assert.equal(result.evidencePath, evidencePath);
  assert.match(result.evidenceDigest, /^[a-f0-9]{64}$/);
});

function recoveryFrom(error) {
  const match = error.message.match(/docs\/work\/debug\/recovery-payment-race-[a-f0-9]+\.md/);
  assert.ok(match, `error must report exact visible recovery path: ${error.message}`);
  return match[0];
}

function failFsyncCall(callNumber) {
  const original = fs.fsyncSync;
  let calls = 0;
  fs.fsyncSync = (descriptor) => {
    calls += 1;
    if (calls === callNumber) {
      const error = new Error(`injected fsync failure at call ${callNumber}`);
      error.code = 'EIO';
      throw error;
    }
    return original(descriptor);
  };
  return () => {
    fs.fsyncSync = original;
  };
}

test('recovery-link fsync failure removes only its owned claim without orphaning it', async (t) => {
  const { promoteDebugInvestigation } = await loadPromotion();
  const item = fixture(t);
  const restoreFsync = failFsyncCall(1);

  let error;
  try {
    promoteDebugInvestigation(item);
  } catch (caught) {
    error = caught;
  } finally {
    restoreFsync();
  }

  assert.ok(error);
  assert.match(error.message, /injected fsync failure/);
  assert.equal(fs.readFileSync(item.source, 'utf8'), item.evidence);
  assert.deepEqual(
    fs.readdirSync(path.dirname(item.source)).filter((name) => name.startsWith('recovery-')),
    [],
  );
  assert.equal(fs.existsSync(path.join(item.root, item.destinationRelative)), false);
});

test('destination-file fsync failure removes its owned partial file and restores source', async (t) => {
  const { promoteDebugInvestigation } = await loadPromotion();
  const item = fixture(t);
  // Recovery directory fsync, source-removal directory fsync, then the first
  // destination file fsync.
  const restoreFsync = failFsyncCall(3);

  let error;
  try {
    promoteDebugInvestigation(item);
  } catch (caught) {
    error = caught;
  } finally {
    restoreFsync();
  }

  assert.ok(error);
  assert.match(error.message, /injected fsync failure/);
  assert.equal(fs.readFileSync(item.source, 'utf8'), item.evidence);
  assert.equal(fs.existsSync(path.join(item.root, item.destinationRelative)), false);
  assert.deepEqual(
    fs.readdirSync(path.dirname(item.source)).filter((name) => name.startsWith('recovery-')),
    [],
  );
});

test('rejects concurrent source mutation and preserves both versions without overwrite', async (t) => {
  const { promoteDebugInvestigation } = await loadPromotion();
  const item = fixture(t);
  const replacement = 'new concurrent investigation bytes\n';

  let error;
  try {
    promoteDebugInvestigation({
      ...item,
      hooks: {
        afterRecoveryClaim({ sourcePath }) {
          fs.writeFileSync(sourcePath, replacement);
        },
      },
    });
  } catch (caught) {
    error = caught;
  }

  assert.ok(error);
  const recoveryRelative = recoveryFrom(error);
  assert.equal(fs.readFileSync(item.source, 'utf8'), replacement);
  assert.deepEqual(
    fs.readFileSync(path.join(item.root, recoveryRelative)),
    Buffer.from(item.evidence),
  );
  assert.equal(fs.existsSync(path.join(item.root, item.destinationRelative)), false);
});

test('source reappearance after claim is untouched and reports the preserved original', async (t) => {
  const { promoteDebugInvestigation } = await loadPromotion();
  const item = fixture(t);
  const replacement = 'new hunt created after the original was claimed\n';

  let error;
  try {
    promoteDebugInvestigation({
      ...item,
      hooks: {
        afterSourceClaim({ sourcePath }) {
          fs.writeFileSync(sourcePath, replacement, { flag: 'wx' });
        },
      },
    });
  } catch (caught) {
    error = caught;
  }

  assert.ok(error);
  const recoveryRelative = recoveryFrom(error);
  assert.equal(fs.readFileSync(item.source, 'utf8'), replacement);
  assert.deepEqual(
    fs.readFileSync(path.join(item.root, recoveryRelative)),
    Buffer.from(item.evidence),
  );
  assert.match(error.message, new RegExp(recoveryRelative.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('same-byte source identity replacement is treated as drift and never deleted', async (t) => {
  const { promoteDebugInvestigation } = await loadPromotion();
  const item = fixture(t);
  const displaced = `${item.source}.displaced`;

  let error;
  try {
    promoteDebugInvestigation({
      ...item,
      hooks: {
        afterRecoveryClaim({ sourcePath }) {
          fs.renameSync(sourcePath, displaced);
          fs.writeFileSync(sourcePath, item.evidence, { flag: 'wx' });
        },
      },
    });
  } catch (caught) {
    error = caught;
  }

  assert.ok(error);
  const recoveryRelative = recoveryFrom(error);
  assert.equal(fs.readFileSync(item.source, 'utf8'), item.evidence);
  assert.equal(fs.readFileSync(displaced, 'utf8'), item.evidence);
  assert.deepEqual(fs.readFileSync(path.join(item.root, recoveryRelative)), Buffer.from(item.evidence));
});

test('rejects invalid UTF-8 source and staged design bytes without claiming evidence', async (t) => {
  const {
    createDebugDesignStage,
    discoverDebugInvestigations,
    promoteDebugInvestigation,
    sealDebugDesignStage,
  } = await loadPromotion();

  const invalidSource = fixture(t);
  fs.writeFileSync(invalidSource.source, Buffer.concat([
    Buffer.from(invalidSource.evidence),
    Buffer.from([0x80]),
  ]));
  assert.throws(
    () => promoteDebugInvestigation(invalidSource),
    /source evidence.*UTF-8/i,
  );
  assert.equal(fs.existsSync(invalidSource.source), true);
  assert.equal(fs.existsSync(path.join(invalidSource.root, invalidSource.destinationRelative)), false);

  const invalidDesign = fixture(t);
  const sourceToken = discoverDebugInvestigations({ projectRoot: invalidDesign.root }).entries[0].token;
  const created = createDebugDesignStage({ projectRoot: invalidDesign.root, sourceToken });
  trackStage(t, created);
  fs.writeFileSync(
    created.designDisplayPath,
    Buffer.concat([Buffer.from(invalidDesign.designContent), Buffer.from([0x80])]),
  );
  assert.throws(
    () => sealDebugDesignStage({ stageToken: created.stageToken }),
    /design file.*UTF-8/i,
  );
  assert.equal(fs.readFileSync(invalidDesign.source, 'utf8'), invalidDesign.evidence);
  assert.equal(fs.existsSync(path.join(invalidDesign.root, invalidDesign.destinationRelative)), false);
});

test('ancestor and destination swaps are detected without deleting foreign objects', async (t) => {
  const { promoteDebugInvestigation } = await loadPromotion();

  const ancestorSwap = fixture(t);
  const debugDirectory = path.join(ancestorSwap.root, 'docs/work/debug');
  const movedDebug = `${debugDirectory}.moved`;
  assert.throws(() => promoteDebugInvestigation({
    ...ancestorSwap,
    hooks: {
      afterSourceRead() {
        fs.renameSync(debugDirectory, movedDebug);
        fs.symlinkSync(os.tmpdir(), debugDirectory, 'dir');
      },
    },
  }), /ancestor|identity|symbolic/i);
  assert.equal(fs.readFileSync(path.join(movedDebug, 'payment-race.md'), 'utf8'), ancestorSwap.evidence);

  const destinationSwap = fixture(t);
  const destinationPath = path.join(destinationSwap.root, destinationSwap.destinationRelative);
  const movedDestination = `${destinationPath}.moved`;
  assert.throws(() => promoteDebugInvestigation({
    ...destinationSwap,
    hooks: {
      afterDestinationCreate() {
        fs.renameSync(destinationPath, movedDestination);
        fs.mkdirSync(destinationPath);
        fs.writeFileSync(path.join(destinationPath, 'foreign.txt'), 'do not delete');
      },
    },
  }), /destination.*identity|identity.*destination/i);
  assert.equal(fs.readFileSync(path.join(destinationPath, 'foreign.txt'), 'utf8'), 'do not delete');
  assert.equal(fs.readFileSync(destinationSwap.source, 'utf8'), destinationSwap.evidence);
});

test('refuses collisions and symlinked source or destination paths without changing evidence', async (t) => {
  const { promoteDebugInvestigation } = await loadPromotion();

  for (const mode of ['collision', 'source-symlink', 'destination-symlink']) {
    await t.test(mode, () => {
      const item = fixture(t);
      if (mode === 'collision') fs.mkdirSync(path.join(item.root, item.destinationRelative));
      if (mode === 'source-symlink') {
        const target = `${item.source}.target`;
        fs.renameSync(item.source, target);
        fs.symlinkSync(target, item.source);
      }
      if (mode === 'destination-symlink') {
        const dated = path.join(item.root, 'docs/work/2026-08-29-payment-race');
        fs.symlinkSync(os.tmpdir(), dated);
      }

      assert.throws(() => promoteDebugInvestigation(item));
      assert.equal(fs.lstatSync(item.source).isFile() || fs.lstatSync(item.source).isSymbolicLink(), true);
    });
  }
});

test('rejects incomplete embedded evidence before creating the destination', async (t) => {
  const { promoteDebugInvestigation } = await loadPromotion();
  const item = fixture(t);
  item.designContent = item.designContent.replace(item.evidence, 'Evidence omitted.\n');

  assert.throws(() => promoteDebugInvestigation(item), /complete debug evidence/i);
  assert.equal(fs.existsSync(item.source), true);
  assert.equal(fs.existsSync(path.join(item.root, item.destinationRelative)), false);
});

test('rolls back its destination and retains source evidence at every injected failure', async (t) => {
  const { promoteDebugInvestigation } = await loadPromotion();

  for (const failAt of ['after-directory', 'after-write', 'after-rename', 'before-source-remove']) {
    await t.test(failAt, () => {
      const item = fixture(t);
      assert.throws(() => promoteDebugInvestigation({ ...item, failAt }), /injected failure/i);
      assert.equal(fs.existsSync(item.source), true);
      assert.equal(fs.existsSync(path.join(item.root, item.destinationRelative)), false);
    });
  }
});
