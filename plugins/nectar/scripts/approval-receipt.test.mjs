import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulePath = path.join(pluginRoot, 'scripts/approval-receipt.mjs');

async function loadReceiptModule() {
  assert.equal(fs.existsSync(modulePath), true, 'approval receipt helper must exist');
  return import(`${pathToFileURL(modulePath).href}?test=${Date.now()}-${Math.random()}`);
}

function design({ reviewCount = 0, reviewMaximum = 3, extraDecision = '' } = {}) {
  return `# Checkout — Design

## Problem
Checkout is inconsistent.

## Investigation and fit
- **Investigation scope:** checkout entry and callers
- **Confirmed current behavior:** duplicate order writes
- **Selected candidate:** idempotency key
- **Evidence:** src/checkout.ts:12
- **Solution fit:** FIT
- **Remaining uncertainty:** none

## Approach
Add idempotency at the service boundary.

## Acceptance criteria
- [ ] Duplicate submissions create one order.

## Out of scope
- Provider retries.

## Decisions
Autonomous run confirmed 2026-08-29.
- completed review-pass count: ${reviewCount}
- review-pass maximum: ${reviewMaximum}
${extraDecision}`;
}

function plan({ approval = 'PENDING', completed = [], taskMutation = '' } = {}) {
  const checked = (id) => completed.includes(id) ? 'x' : ' ';
  return `## Gate
- Solution fit: FIT
- Plan revision: 2
- Plan approval: ${approval}

## Wave 1
- [${checked('T1')}] T1: Add idempotency guard${taskMutation} — done when: focused test passes.
  - files: \`src/checkout.ts\`, \`test/checkout.test.ts\`
  - reads: \`src/order.ts\`
- [${checked('T2')}] T2: Add conflict response — done when: API test passes.
  - files: \`src/api.ts\`, \`test/api.test.ts\`
  - reads: \`src/checkout.ts\`

## Wave 2 (depends on Wave 1)
- [${checked('T3')}] T3: Document behavior — done when: docs render.
  - files: \`README.md\`
`;
}

function testValueRecord({
  behavior = 'Duplicate submissions create one order.',
  owner = 'service — test/checkout.test.ts',
  decision = 'REUSE_EXISTING_TEST',
  evidence = 'node --test test/checkout.test.ts',
} = {}) {
  return `
  - test value:
    - Protected behavior: ${behavior}
    - Credible failure: duplicate orders charge twice
    - Impact: financial integrity
    - Unique existing coverage: checkout idempotency service test
    - Owning layer: ${owner}
    - Implementation independence: public service outcome
    - Runtime class and cost: focused service test, low cost
    - Test decision: ${decision}
    - Completion evidence: ${evidence}
`;
}

function directFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-receipt-direct-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const topic = 'docs/work/2026-08-29-checkout';
  fs.mkdirSync(path.join(root, topic), { recursive: true });
  fs.writeFileSync(path.join(root, topic, 'design.md'), design());
  fs.writeFileSync(path.join(root, topic, 'plan.md'), plan());
  return { root, topic };
}

function nestedFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-receipt-nested-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const parent = 'docs/work/2026-08-29-checkout';
  const first = `${parent}/01-domain`;
  const second = `${parent}/02-api`;
  fs.mkdirSync(path.join(root, first), { recursive: true });
  fs.mkdirSync(path.join(root, second), { recursive: true });
  fs.writeFileSync(path.join(root, parent, 'design.md'), `${design()}

## Topics
1. \`01-domain/\` — domain; depends on: none
2. \`02-api/\` — API; depends on: \`01-domain/\`
`);
  fs.writeFileSync(path.join(root, first, 'design.md'), design());
  fs.writeFileSync(path.join(root, first, 'plan.md'), plan({ completed: ['T1', 'T2', 'T3'] }));
  fs.writeFileSync(path.join(root, second, 'design.md'), design());
  fs.writeFileSync(path.join(root, second, 'plan.md'), plan());
  return { root, parent, first, second };
}

test('canonical receipt ignores only approval audit and ordinary checkbox progress', async (t) => {
  const { createApprovalReceipt } = await loadReceiptModule();
  const item = directFixture(t);
  const before = createApprovalReceipt({ projectRoot: item.root, topic: item.topic });

  fs.writeFileSync(path.join(item.root, item.topic, 'plan.md'), plan({
    approval: 'APPROVED 2026-08-29',
    completed: ['T1', 'T2'],
  }));
  const after = createApprovalReceipt({ projectRoot: item.root, topic: item.topic });

  assert.equal(after.digest, before.digest);
  assert.deepEqual(before.orderedTaskIds, ['T1', 'T2', 'T3']);
  assert.deepEqual(before.completedTaskIds, []);
  assert.deepEqual(after.completedTaskIds, ['T1', 'T2']);
  assert.equal(before.revision, 2);
});

test('interactive designs without Honey review counters remain approvable', async (t) => {
  const { createApprovalReceipt } = await loadReceiptModule();
  const item = directFixture(t);
  const designPath = path.join(item.root, item.topic, 'design.md');
  fs.writeFileSync(designPath, design().replace(/\n## Decisions[\s\S]*$/, '\n'));

  const receipt = createApprovalReceipt({ projectRoot: item.root, topic: item.topic });
  assert.equal(receipt.completedReviewPasses, 0);
  assert.equal(receipt.reviewPassMaximum, null);
});

test('material changes to any authoritative design or plan surface change the digest', async (t) => {
  const { createApprovalReceipt } = await loadReceiptModule();

  for (const mutation of ['decision', 'task', 'files', 'reads', 'struck']) {
    await t.test(mutation, () => {
      const item = directFixture(t);
      const before = createApprovalReceipt({ projectRoot: item.root, topic: item.topic });
      const designPath = path.join(item.root, item.topic, 'design.md');
      const planPath = path.join(item.root, item.topic, 'plan.md');
      if (mutation === 'decision') fs.writeFileSync(designPath, design({ extraDecision: '- Use another database.\n' }));
      if (mutation === 'task') fs.writeFileSync(planPath, plan({ taskMutation: ' with fallback' }));
      if (mutation === 'files') fs.writeFileSync(planPath, plan().replace('src/checkout.ts', 'src/other.ts'));
      if (mutation === 'reads') fs.writeFileSync(planPath, plan().replace('src/order.ts', 'src/other.ts'));
      if (mutation === 'struck') fs.writeFileSync(planPath, plan().replace(
        '- [ ] T2: Add conflict response',
        '- [x] ~~T2: Add conflict response~~ struck: obsolete',
      ));
      const after = createApprovalReceipt({ projectRoot: item.root, topic: item.topic });
      assert.notEqual(after.digest, before.digest);
    });
  }
});

test('behavior ownership, Test Value decision, and evidence route are approval-bound', async (t) => {
  const { createApprovalReceipt } = await loadReceiptModule();

  for (const mutation of ['behavior', 'owner', 'decision', 'evidence']) {
    await t.test(mutation, () => {
      const item = directFixture(t);
      const planPath = path.join(item.root, item.topic, 'plan.md');
      fs.writeFileSync(planPath, `${plan()}${testValueRecord()}`);
      const before = createApprovalReceipt({ projectRoot: item.root, topic: item.topic });
      const options = {
        behavior: mutation === 'behavior' ? 'Declined submissions create no order.' : undefined,
        owner: mutation === 'owner' ? 'API — test/api.test.ts' : undefined,
        decision: mutation === 'decision' ? 'ADD_PRODUCT_TEST' : undefined,
        evidence: mutation === 'evidence' ? 'npm run build' : undefined,
      };
      fs.writeFileSync(planPath, `${plan()}${testValueRecord(options)}`);
      const after = createApprovalReceipt({ projectRoot: item.root, topic: item.topic });

      assert.notEqual(after.digest, before.digest);
    });
  }
});

test('nested receipts require and bind a valid exact parent hierarchy', async (t) => {
  const { createApprovalReceipt } = await loadReceiptModule();
  const item = nestedFixture(t);
  const receipt = createApprovalReceipt({ projectRoot: item.root, topic: item.second });

  assert.deepEqual(receipt.derivedPaths, [
    `${item.parent}/design.md`,
    `${item.second}/design.md`,
    `${item.second}/plan.md`,
  ]);
  const parentPath = path.join(item.root, item.parent, 'design.md');
  fs.appendFileSync(parentPath, '\nApproved parent decision changed.\n');
  assert.notEqual(
    createApprovalReceipt({ projectRoot: item.root, topic: item.second }).digest,
    receipt.digest,
  );
});

test('topic shape accepts only a direct root or one numbered child of a dated parent', async (t) => {
  const { createApprovalReceipt } = await loadReceiptModule();

  const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-receipt-legacy-'));
  t.after(() => fs.rmSync(legacyRoot, { recursive: true, force: true }));
  const legacyTopic = 'docs/work/01-legacy';
  fs.mkdirSync(path.join(legacyRoot, legacyTopic), { recursive: true });
  fs.writeFileSync(path.join(legacyRoot, legacyTopic, 'design.md'), design());
  fs.writeFileSync(path.join(legacyRoot, legacyTopic, 'plan.md'), plan());
  assert.equal(createApprovalReceipt({ projectRoot: legacyRoot, topic: legacyTopic }).derivedPaths.length, 2);

  const item = nestedFixture(t);
  const unnumbered = `${item.parent}/api`;
  fs.mkdirSync(path.join(item.root, unnumbered));
  fs.writeFileSync(path.join(item.root, unnumbered, 'design.md'), design());
  fs.writeFileSync(path.join(item.root, unnumbered, 'plan.md'), plan());
  assert.throws(
    () => createApprovalReceipt({ projectRoot: item.root, topic: unnumbered }),
    /numbered child|topic shape/i,
  );

  const deep = `${item.second}/03-deep`;
  fs.mkdirSync(path.join(item.root, deep));
  fs.writeFileSync(path.join(item.root, deep, 'design.md'), design());
  fs.writeFileSync(path.join(item.root, deep, 'plan.md'), plan());
  assert.throws(
    () => createApprovalReceipt({ projectRoot: item.root, topic: deep }),
    /topic shape|one child/i,
  );
});

test('receipt rejects invalid UTF-8 instead of hashing lossy replacement text', async (t) => {
  const { createApprovalReceipt } = await loadReceiptModule();

  for (const invalidByte of [0x80, 0x81]) {
    const item = directFixture(t);
    const planPath = path.join(item.root, item.topic, 'plan.md');
    fs.writeFileSync(planPath, Buffer.concat([fs.readFileSync(planPath), Buffer.from([invalidByte])]));
    assert.throws(
      () => createApprovalReceipt({ projectRoot: item.root, topic: item.topic }),
      /UTF-8/i,
    );
  }
});

test('receipt rejects a partial ordinary wave baseline', async (t) => {
  const { createApprovalReceipt } = await loadReceiptModule();
  const item = directFixture(t);
  fs.writeFileSync(
    path.join(item.root, item.topic, 'plan.md'),
    plan({ completed: ['T1'] }),
  );

  assert.throws(
    () => createApprovalReceipt({ projectRoot: item.root, topic: item.topic }),
    /partial ordinary wave|uniformly complete/i,
  );
});

test('receipt rejects checked ordinary tasks in a future wave baseline', async (t) => {
  const { createApprovalReceipt } = await loadReceiptModule();
  const item = directFixture(t);
  fs.writeFileSync(
    path.join(item.root, item.topic, 'plan.md'),
    plan({ completed: ['T3'] }),
  );

  assert.throws(
    () => createApprovalReceipt({ projectRoot: item.root, topic: item.topic }),
    /future-wave ordinary progress|completed ordinary waves.*prefix/i,
  );
});

test('struck tasks are completed and digest-bound but do not move the ordinary frontier', async (t) => {
  const { advanceTaskReceipt, createApprovalReceipt } = await loadReceiptModule();
  const item = directFixture(t);
  const planPath = path.join(item.root, item.topic, 'plan.md');
  fs.writeFileSync(planPath, plan().replace(
    '- [ ] T1: Add idempotency guard — done when: focused test passes.',
    '- [x] ~~T1: Add idempotency guard — done when: focused test passes.~~ struck: superseded',
  ));

  const receipt = createApprovalReceipt({ projectRoot: item.root, topic: item.topic });
  assert.deepEqual(receipt.completedTaskIds, ['T1']);

  const advanced = advanceTaskReceipt({
    receipt,
    projectRoot: item.root,
    topic: item.topic,
    verifiedTaskIds: ['T2'],
  });
  assert.deepEqual(advanced.completedTaskIds, ['T1', 'T2']);
  assert.match(fs.readFileSync(planPath, 'utf8'), /^- \[x\] T2:/m);
});

test('token progress keeps canonical order when a pending task precedes a struck task', async (t) => {
  const {
    advanceTaskReceiptFromTokens,
    createApprovalReceiptFromToken,
    discoverApprovalTopics,
  } = await loadReceiptModule();
  const item = directFixture(t);
  const planPath = path.join(item.root, item.topic, 'plan.md');
  fs.writeFileSync(planPath, plan().replace(
    '- [ ] T2: Add conflict response — done when: API test passes.',
    '- [x] ~~T2: Add conflict response — done when: API test passes.~~ struck: obsolete',
  ));

  const topicToken = discoverApprovalTopics({ projectRoot: item.root }).entries[0].token;
  const receipt = createApprovalReceiptFromToken({ projectRoot: item.root, topicToken });
  assert.deepEqual(receipt.completedTaskIds, ['T2']);

  const advanced = advanceTaskReceiptFromTokens({
    projectRoot: item.root,
    topicToken,
    receiptToken: receipt.receiptToken,
    taskAdvanceToken: receipt.taskAdvanceToken,
  });
  assert.deepEqual(advanced.completedTaskIds, ['T1', 'T2']);
  assert.match(fs.readFileSync(planPath, 'utf8'), /^- \[x\] T1:/m);
});

test('rejects invalid hierarchy membership, numbering, dependencies, duplicates, and symlinks', async (t) => {
  const { createApprovalReceipt } = await loadReceiptModule();

  for (const mode of ['unlisted', 'gap', 'forward-dependency', 'extra-child', 'symlink-plan']) {
    await t.test(mode, () => {
      const item = nestedFixture(t);
      const parentDesign = path.join(item.root, item.parent, 'design.md');
      if (mode === 'unlisted') fs.writeFileSync(parentDesign, fs.readFileSync(parentDesign, 'utf8').replace('2. `02-api/`', '2. `02-other/`'));
      if (mode === 'gap') fs.writeFileSync(parentDesign, fs.readFileSync(parentDesign, 'utf8').replace('2. `02-api/`', '3. `03-api/`'));
      if (mode === 'forward-dependency') fs.writeFileSync(parentDesign, fs.readFileSync(parentDesign, 'utf8').replace('depends on: none', 'depends on: `02-api/`'));
      if (mode === 'extra-child') fs.mkdirSync(path.join(item.root, item.parent, '03-stale'));
      if (mode === 'symlink-plan') {
        const planPath = path.join(item.root, item.second, 'plan.md');
        const target = `${planPath}.target`;
        fs.renameSync(planPath, target);
        fs.symlinkSync(target, planPath);
      }
      assert.throws(() => createApprovalReceipt({ projectRoot: item.root, topic: item.second }));
    });
  }
});

test('task progress atomically writes only the complete verified current wave', async (t) => {
  const { advanceTaskReceipt, createApprovalReceipt } = await loadReceiptModule();
  const item = directFixture(t);
  const receipt = createApprovalReceipt({ projectRoot: item.root, topic: item.topic });
  const planPath = path.join(item.root, item.topic, 'plan.md');
  const original = fs.readFileSync(planPath);

  assert.throws(() => advanceTaskReceipt({
    receipt,
    projectRoot: item.root,
    topic: item.topic,
    verifiedTaskIds: ['T1'],
  }), /current wave/i);
  assert.deepEqual(fs.readFileSync(planPath), original);

  const advanced = advanceTaskReceipt({
    receipt,
    projectRoot: item.root,
    topic: item.topic,
    verifiedTaskIds: ['T1', 'T2'],
  });
  assert.deepEqual(advanced.completedTaskIds, ['T1', 'T2']);
  assert.equal(fs.readFileSync(planPath, 'utf8'), plan({ completed: ['T1', 'T2'] }));
  const afterAdvance = fs.readFileSync(planPath);
  assert.throws(() => advanceTaskReceipt({
    receipt,
    projectRoot: item.root,
    topic: item.topic,
    verifiedTaskIds: ['T1', 'T2'],
  }), /progress|mismatch|duplicate/i);
  assert.deepEqual(fs.readFileSync(planPath), afterAdvance);

  fs.writeFileSync(planPath, plan({ completed: [] }));
  const rewound = fs.readFileSync(planPath);
  assert.throws(() => advanceTaskReceipt({
    receipt: advanced,
    projectRoot: item.root,
    topic: item.topic,
    verifiedTaskIds: [],
  }), /rewind/i);
  assert.deepEqual(fs.readFileSync(planPath), rewound);
});

test('review progress atomically advances one step and keeps its maximum frozen', async (t) => {
  const { advanceReviewReceipt, createApprovalReceipt } = await loadReceiptModule();
  const item = directFixture(t);
  const receipt = createApprovalReceipt({ projectRoot: item.root, topic: item.topic });
  const designPath = path.join(item.root, item.topic, 'design.md');

  const advanced = advanceReviewReceipt({ receipt, projectRoot: item.root, topic: item.topic });
  assert.equal(advanced.completedReviewPasses, 1);
  assert.equal(fs.readFileSync(designPath, 'utf8'), design({ reviewCount: 1 }));
  const afterAdvance = fs.readFileSync(designPath);

  assert.throws(
    () => advanceReviewReceipt({ receipt, projectRoot: item.root, topic: item.topic }),
    /progress|mismatch|single-step/i,
  );
  assert.deepEqual(fs.readFileSync(designPath), afterAdvance);

  fs.writeFileSync(designPath, design({ reviewCount: 0 }));
  const rewound = fs.readFileSync(designPath);
  assert.throws(() => advanceReviewReceipt({ receipt: advanced, projectRoot: item.root, topic: item.topic }), /rewind/i);
  assert.deepEqual(fs.readFileSync(designPath), rewound);

  const capped = directFixture(t);
  const cappedDesign = path.join(capped.root, capped.topic, 'design.md');
  fs.writeFileSync(cappedDesign, design({ reviewMaximum: 1 }));
  const cappedReceipt = createApprovalReceipt({ projectRoot: capped.root, topic: capped.topic });
  const cappedAdvanced = advanceReviewReceipt({ receipt: cappedReceipt, projectRoot: capped.root, topic: capped.topic });
  const atMaximum = fs.readFileSync(cappedDesign);
  assert.throws(
    () => advanceReviewReceipt({ receipt: cappedAdvanced, projectRoot: capped.root, topic: capped.topic }),
    /maximum/i,
  );
  assert.deepEqual(fs.readFileSync(cappedDesign), atMaximum);
});

test('only canonical leaf Decisions review state is normalized and validated', async (t) => {
  const { createApprovalReceipt } = await loadReceiptModule();

  const item = directFixture(t);
  const designPath = path.join(item.root, item.topic, 'design.md');
  const outsideState = design().replace(/\n## Decisions[\s\S]*$/, `

## Notes
- completed review-pass count: 0
- review-pass maximum: 3
`);
  fs.writeFileSync(designPath, outsideState);
  const outsideBefore = createApprovalReceipt({ projectRoot: item.root, topic: item.topic });
  fs.writeFileSync(designPath, outsideState.replace('count: 0', 'count: 1'));
  const outsideAfter = createApprovalReceipt({ projectRoot: item.root, topic: item.topic });
  assert.notEqual(outsideAfter.digest, outsideBefore.digest);
  assert.equal(outsideBefore.reviewPassMaximum, null);

  const nested = nestedFixture(t);
  const nestedReceipt = createApprovalReceipt({ projectRoot: nested.root, topic: nested.second });
  const parentPath = path.join(nested.root, nested.parent, 'design.md');
  fs.writeFileSync(parentPath, fs.readFileSync(parentPath, 'utf8').replace('count: 0', 'count: 1'));
  assert.notEqual(
    createApprovalReceipt({ projectRoot: nested.root, topic: nested.second }).digest,
    nestedReceipt.digest,
  );

  for (const invalid of [
    design({ reviewCount: 4, reviewMaximum: 3 }),
    design({ reviewMaximum: 0 }),
    design().replace('count: 0', 'count: 9007199254740992'),
  ]) {
    const invalidItem = directFixture(t);
    fs.writeFileSync(path.join(invalidItem.root, invalidItem.topic, 'design.md'), invalid);
    assert.throws(
      () => createApprovalReceipt({ projectRoot: invalidItem.root, topic: invalidItem.topic }),
      /review.*(?:maximum|safe|range)|maximum.*positive/i,
    );
  }
});

function customDirectFixture(t, topic) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-receipt-custom-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, topic), { recursive: true });
  fs.writeFileSync(path.join(root, topic, 'design.md'), design());
  fs.writeFileSync(path.join(root, topic, 'plan.md'), plan());
  return { root, topic };
}

test('discovery transports malicious legacy names only as canonical base64url tokens', async (t) => {
  const {
    createApprovalReceiptFromToken,
    discoverApprovalTopics,
  } = await loadReceiptModule();
  assert.equal(typeof discoverApprovalTopics, 'function');
  assert.equal(typeof createApprovalReceiptFromToken, 'function');

  const topic = 'docs/work/2026-08-29-$(touch${IFS}sentinel) `quoted` ünicode';
  const item = customDirectFixture(t, topic);
  const sentinel = path.join(item.root, 'sentinel');
  const discovered = discoverApprovalTopics({ projectRoot: item.root });

  assert.deepEqual(discovered.discrepancies, []);
  assert.equal(discovered.entries.length, 1);
  assert.equal(discovered.entries[0].displayPath, topic);
  assert.match(discovered.entries[0].token, /^[A-Za-z0-9_-]+$/);
  assert.equal(fs.existsSync(sentinel), false);

  const receipt = createApprovalReceiptFromToken({
    projectRoot: item.root,
    topicToken: discovered.entries[0].token,
  });
  assert.equal(receipt.kind, 'CURRENT_RUN');
  assert.equal(receipt.topicToken, discovered.entries[0].token);
  assert.match(receipt.receiptToken, /^[A-Za-z0-9_-]+$/);
  assert.match(receipt.taskAdvanceToken, /^[A-Za-z0-9_-]+$/);
  assert.equal(fs.existsSync(sentinel), false);
});

test('selection tokens reject tampering, wrong-root replay, and discovery drift', async (t) => {
  const {
    createApprovalReceiptFromToken,
    discoverApprovalTopics,
  } = await loadReceiptModule();
  const item = directFixture(t);
  const token = discoverApprovalTopics({ projectRoot: item.root }).entries[0].token;
  const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;

  assert.throws(
    () => createApprovalReceiptFromToken({ projectRoot: item.root, topicToken: tampered }),
    /token|checksum|canonical/i,
  );

  const other = directFixture(t);
  assert.throws(
    () => createApprovalReceiptFromToken({ projectRoot: other.root, topicToken: token }),
    /root|replay|membership/i,
  );

  fs.renameSync(
    path.join(item.root, item.topic, 'plan.md'),
    path.join(item.root, item.topic, 'plan.md.removed'),
  );
  assert.throws(
    () => createApprovalReceiptFromToken({ projectRoot: item.root, topicToken: token }),
    /membership|discover|plan|leaf/i,
  );
});

test('token progress modes preserve task and review transition invariants', async (t) => {
  const {
    advanceReviewReceiptFromTokens,
    advanceTaskReceiptFromTokens,
    createApprovalReceiptFromToken,
    discoverApprovalTopics,
  } = await loadReceiptModule();
  const item = directFixture(t);
  const topicToken = discoverApprovalTopics({ projectRoot: item.root }).entries[0].token;
  const receipt = createApprovalReceiptFromToken({ projectRoot: item.root, topicToken });

  const advancedTasks = advanceTaskReceiptFromTokens({
    projectRoot: item.root,
    topicToken,
    receiptToken: receipt.receiptToken,
    taskAdvanceToken: receipt.taskAdvanceToken,
  });
  assert.deepEqual(advancedTasks.completedTaskIds, ['T1', 'T2']);
  assert.notEqual(advancedTasks.receiptToken, receipt.receiptToken);

  const advancedReview = advanceReviewReceiptFromTokens({
    projectRoot: item.root,
    topicToken,
    receiptToken: advancedTasks.receiptToken,
  });
  assert.equal(advancedReview.completedReviewPasses, 1);
  assert.throws(() => advanceTaskReceiptFromTokens({
    projectRoot: item.root,
    topicToken,
    receiptToken: receipt.receiptToken,
    taskAdvanceToken: receipt.taskAdvanceToken,
  }));
});

function writeStageFixture(stageRoot, topic = 'docs/work/2026-08-29-checkout') {
  fs.mkdirSync(path.join(stageRoot, topic), { recursive: true });
  fs.writeFileSync(path.join(stageRoot, topic, 'design.md'), design());
  fs.writeFileSync(path.join(stageRoot, topic, 'plan.md'), plan());
  return topic;
}

test('sealed staging tokens snapshot equivalent content and dispose exact manifests only', async (t) => {
  const {
    createApprovalStage,
    createApprovalReceiptFromToken,
    createStageApprovalReceiptFromToken,
    discoverApprovalStage,
    discoverApprovalTopics,
    disposeApprovalStage,
    sealApprovalStage,
  } = await loadReceiptModule();
  const stage = createApprovalStage();
  t.after(() => fs.rmSync(stage.displayPath, { recursive: true, force: true }));
  const topic = writeStageFixture(stage.displayPath);
  const sealed = sealApprovalStage({ stageToken: stage.stageToken });
  assert.notEqual(sealed.stageToken, stage.stageToken);
  const stageDiscovery = discoverApprovalStage({ stageToken: sealed.stageToken });
  assert.equal(stageDiscovery.entries[0].displayPath, topic);
  const stagedReceipt = createStageApprovalReceiptFromToken({
    stageToken: sealed.stageToken,
    topicToken: stageDiscovery.entries[0].token,
  });

  const live = customDirectFixture(t, topic);
  const liveToken = discoverApprovalTopics({ projectRoot: live.root }).entries[0].token;
  const liveReceipt = createApprovalReceiptFromToken({ projectRoot: live.root, topicToken: liveToken });
  assert.notEqual(stageDiscovery.entries[0].token, liveToken);
  assert.equal(stagedReceipt.digest, liveReceipt.digest);
  assert.deepEqual(stagedReceipt.derivedPaths, liveReceipt.derivedPaths);

  const disposed = disposeApprovalStage({ stageToken: sealed.stageToken });
  assert.equal(disposed.disposed, true);
  assert.equal(fs.existsSync(stage.displayPath), false);
});

test('stage disposal refuses unsealed, changed, extra, missing, and symlinked descendants', async (t) => {
  const {
    createApprovalStage,
    disposeApprovalStage,
    sealApprovalStage,
  } = await loadReceiptModule();

  const unsealed = createApprovalStage();
  t.after(() => fs.rmSync(unsealed.displayPath, { recursive: true, force: true }));
  assert.throws(() => disposeApprovalStage({ stageToken: unsealed.stageToken }), /sealed/i);
  assert.equal(fs.existsSync(unsealed.displayPath), true);

  for (const mode of ['changed', 'extra', 'missing', 'symlink']) {
    await t.test(mode, () => {
      const stage = createApprovalStage();
      t.after(() => fs.rmSync(stage.displayPath, { recursive: true, force: true }));
      const topic = writeStageFixture(stage.displayPath);
      const sealed = sealApprovalStage({ stageToken: stage.stageToken });
      const topicRoot = path.join(stage.displayPath, topic);
      if (mode === 'changed') fs.appendFileSync(path.join(topicRoot, 'plan.md'), '\nchanged\n');
      if (mode === 'extra') fs.writeFileSync(path.join(topicRoot, 'foreign.txt'), 'foreign');
      if (mode === 'missing') fs.unlinkSync(path.join(topicRoot, 'design.md'));
      if (mode === 'symlink') fs.symlinkSync(os.tmpdir(), path.join(topicRoot, 'foreign-link'));

      assert.throws(
        () => disposeApprovalStage({ stageToken: sealed.stageToken }),
        /manifest|changed|extra|missing|symbolic|retained/i,
      );
      assert.equal(fs.existsSync(stage.displayPath), true);
    });
  }
});

test('stage handles reject tampering and replaced marker or root identities', async (t) => {
  const {
    createApprovalStage,
    discoverApprovalStage,
    sealApprovalStage,
  } = await loadReceiptModule();

  const stage = createApprovalStage();
  t.after(() => fs.rmSync(stage.displayPath, { recursive: true, force: true }));
  assert.equal(fs.statSync(stage.displayPath).mode & 0o777, 0o700);
  writeStageFixture(stage.displayPath);
  const sealed = sealApprovalStage({ stageToken: stage.stageToken });
  const tampered = `${sealed.stageToken.slice(0, -1)}${sealed.stageToken.endsWith('A') ? 'B' : 'A'}`;
  assert.throws(() => discoverApprovalStage({ stageToken: tampered }), /token|checksum|canonical/i);

  const marker = path.join(stage.displayPath, '.nectar-approval-stage.json');
  const markerBytes = fs.readFileSync(marker);
  fs.renameSync(marker, `${marker}.replaced`);
  fs.writeFileSync(marker, markerBytes);
  assert.throws(() => discoverApprovalStage({ stageToken: sealed.stageToken }), /marker.*identity|identity.*marker/i);

  const second = createApprovalStage();
  const moved = `${second.displayPath}.moved`;
  t.after(() => fs.rmSync(second.displayPath, { recursive: true, force: true }));
  t.after(() => fs.rmSync(moved, { recursive: true, force: true }));
  fs.renameSync(second.displayPath, moved);
  fs.mkdirSync(second.displayPath, { mode: 0o700 });
  fs.copyFileSync(path.join(moved, '.nectar-approval-stage.json'), path.join(second.displayPath, '.nectar-approval-stage.json'));
  assert.throws(
    () => sealApprovalStage({ stageToken: second.stageToken }),
    /root.*identity|identity.*mismatch|replay/i,
  );
});

test('agent-facing CLI rejects raw path modes and round-trips safe tokens', async (t) => {
  const item = directFixture(t);
  const raw = spawnSync(process.execPath, [
    modulePath,
    'snapshot',
    '--project-root', item.root,
    '--topic', item.topic,
  ], { cwd: item.root, encoding: 'utf8' });
  assert.equal(raw.status, 1);
  assert.match(raw.stderr, /disabled|discover|token/i);

  const discovered = spawnSync(process.execPath, [modulePath, 'discover'], {
    cwd: item.root,
    encoding: 'utf8',
  });
  assert.equal(discovered.status, 0, discovered.stderr);
  const token = JSON.parse(discovered.stdout).entries[0].token;
  assert.match(token, /^[A-Za-z0-9_-]+$/);

  const snapshot = spawnSync(process.execPath, [modulePath, 'snapshot-token', token], {
    cwd: item.root,
    encoding: 'utf8',
  });
  assert.equal(snapshot.status, 0, snapshot.stderr);
  const receipt = JSON.parse(snapshot.stdout);
  assert.equal(receipt.kind, 'CURRENT_RUN');

  const advancedTasks = spawnSync(process.execPath, [
    modulePath,
    'advance-task-token',
    token,
    receipt.receiptToken,
    receipt.taskAdvanceToken,
  ], { cwd: item.root, encoding: 'utf8' });
  assert.equal(advancedTasks.status, 0, advancedTasks.stderr);
  const taskReceipt = JSON.parse(advancedTasks.stdout);
  assert.deepEqual(taskReceipt.completedTaskIds, ['T1', 'T2']);

  const advancedReview = spawnSync(process.execPath, [
    modulePath,
    'advance-review-token',
    token,
    taskReceipt.receiptToken,
  ], { cwd: item.root, encoding: 'utf8' });
  assert.equal(advancedReview.status, 0, advancedReview.stderr);
  assert.equal(JSON.parse(advancedReview.stdout).completedReviewPasses, 1);
});
