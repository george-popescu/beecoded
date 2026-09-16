import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import * as closeLifecycle from './close-lifecycle.mjs';

import {
  cancelPendingClosure,
  discoverCloseSupport,
  discoverCloseTopics,
  finalizeClosureFromToken,
  inspectPendingClosure,
  prepareClosureFromToken,
  recoverPendingClosure,
  sealPendingSupportFromToken,
} from './close-lifecycle.mjs';

const canonicalReview = '# Review\n\nBlocking: 0\nClean pass: zero blocking code defects remain.\n';

function write(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function git(root, ...args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Nectar Test',
      GIT_AUTHOR_EMAIL: 'nectar@example.test',
      GIT_COMMITTER_NAME: 'Nectar Test',
      GIT_COMMITTER_EMAIL: 'nectar@example.test',
      GIT_OPTIONAL_LOCKS: '0',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function directFixture(t, { ignoredWork = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-close-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, '.gitignore', `${ignoredWork ? 'docs/\n' : ''}.nectar/\n`);
  write(root, 'src/app.mjs', 'export const value = 1;\n');
  write(root, 'CHANGELOG.md', '# Changelog\n');
  git(root, 'init', '-q');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'initial');

  const topic = 'docs/work/2026-08-30-search';
  write(root, `${topic}/design.md`, '# Search — Design\n');
  write(root, `${topic}/plan.md`, [
    '## Gate',
    '- Solution fit: FIT',
    '- Plan revision: 1',
    '- Plan approval: APPROVED 2026-08-30',
    '## Wave 1',
    '- [x] T1: Search — done when: green.',
    '  - files: `src/app.mjs`',
    '',
  ].join('\n'));
  write(root, `${topic}/review.md`, canonicalReview);
  write(root, 'src/app.mjs', 'export const value = 2;\n');
  return { root, topic };
}

function addIgnoredCompletedTopic(root, slug, deliveryPath) {
  const topic = `docs/work/${slug}`;
  write(root, deliveryPath, 'export const value = 1;\n');
  git(root, 'add', deliveryPath);
  git(root, 'commit', '-qm', `track ${slug} delivery`);
  write(root, `${topic}/design.md`, `# ${slug} — Design\n`);
  write(root, `${topic}/plan.md`, [
    '## Gate',
    '- Solution fit: FIT',
    '- Plan revision: 1',
    '- Plan approval: APPROVED 2026-08-30',
    '## Wave 1',
    `- [x] T1: ${slug} — done when: green.`,
    `  - files: \`${deliveryPath}\``,
    '',
  ].join('\n'));
  write(root, `${topic}/review.md`, canonicalReview);
  write(root, deliveryPath, 'export const value = 2;\n');
  return topic;
}

function treeDigest(root, relative) {
  const hash = crypto.createHash('sha256');
  const visit = (current, prefix = '') => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const nested = path.join(current, entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      hash.update(name).update('\0');
      if (entry.isDirectory()) visit(nested, name);
      else hash.update(fs.readFileSync(nested));
    }
  };
  visit(path.join(root, relative));
  return hash.digest('hex');
}

test('discovers only whole closeable roots and never independently authorizes a nested child', (t) => {
  const { root } = directFixture(t);
  write(root, 'docs/work/2026-08-30-platform/design.md', '# Platform\n\n## Topics\n1. `01-api/` — API; depends on: none\n');
  write(root, 'docs/work/2026-08-30-platform/01-api/design.md', '# API\n');
  write(root, 'docs/work/2026-08-30-platform/01-api/plan.md', '## Wave 1\n- [x] T1: API — done when: green.\n');
  write(root, 'docs/work/2026-08-30-platform/01-api/review.md', canonicalReview);

  const result = discoverCloseTopics({ projectRoot: root });
  const direct = result.entries.find((entry) => entry.displayPath.endsWith('/2026-08-30-search'));
  const parent = result.entries.find((entry) => entry.displayPath.endsWith('/2026-08-30-platform'));
  const nested = result.entries.find((entry) => entry.displayPath.endsWith('/01-api'));

  assert.equal(direct.closable, true);
  assert.match(direct.token, /^[A-Za-z0-9_-]+$/);
  assert.equal(parent.closable, true);
  assert.equal(nested.closable, false);
  assert.equal(nested.token, null);
  assert.match(nested.reason, /parent-owned/);
});

test('Close grants slim work authority only after final verification and a clean review', (t) => {
  const { root, topic } = directFixture(t);
  const makePlan = (status) => `Workflow: nectar-slim-v1\n\n## Wave 1\n- [x] T1: Search.\n  - files: \`src/app.mjs\`\n\n## Verification\nStatus: ${status}\nEvidence: node --test test/search.mjs: 4 passed, 0 failed.\n`;
  const entry = () => discoverCloseTopics({ projectRoot: root }).entries
    .find((candidate) => candidate.displayPath === topic);
  for (const status of ['pending', 'failed']) {
    write(root, `${topic}/plan.md`, makePlan(status));
    assert.equal(entry().closable, false, status);
    assert.equal(entry().token, null, status);
  }
  write(root, `${topic}/plan.md`, makePlan('passed'));
  assert.equal(entry().closable, true);
  const prepared = prepareClosureFromToken({ projectRoot: root, topicToken: entry().token });
  assert.equal(inspectPendingClosure({ projectRoot: root }).id, prepared.id);
  cancelPendingClosure({ projectRoot: root, pendingToken: prepared.pendingToken });
});

test('prepare durably publishes exact ignored work and support evidence without changing project bytes', (t) => {
  const { root, topic } = directFixture(t);
  write(root, 'docs/work/backlog.md', '# Backlog\n- Search cleanup\n');
  const before = treeDigest(root, topic);
  const discovery = discoverCloseTopics({ projectRoot: root });
  const topicToken = discovery.entries.find((entry) => entry.displayPath.endsWith('/2026-08-30-search')).token;
  const supports = discoverCloseSupport({ projectRoot: root });

  const prepared = prepareClosureFromToken({
    projectRoot: root,
    supportTokens: supports.entries.map((entry) => entry.token),
    topicToken,
  });

  assert.equal(treeDigest(root, topic), before);
  assert.equal(fs.existsSync(prepared.pendingPath), true);
  assert.equal(prepared.tracking, 'ignored-or-untracked-only');
  assert.equal(prepared.contextImpact.decision, 'review');
  const pending = inspectPendingClosure({ projectRoot: root });
  assert.equal(pending.id, prepared.id);
  assert.equal(pending.manifestHash, prepared.manifestHash);
  assert.throws(
    () => prepareClosureFromToken({ projectRoot: root, topicToken }),
    /pending closure already exists/,
  );

  const cancelled = cancelPendingClosure({
    pendingToken: prepared.pendingToken,
    projectRoot: root,
  });
  assert.equal(fs.existsSync(cancelled.cancelledPath), true);
  assert.equal(fs.existsSync(path.join(root, '.nectar/closures/pending/current')), false);
  assert.equal(treeDigest(root, topic), before);
});

test('prepare and cancel recover filesystem publication when SQLite rolls back', (t) => {
  const item = directFixture(t);
  const topicToken = discoverCloseTopics({ projectRoot: item.root }).entries
    .find((entry) => entry.displayPath.endsWith('/2026-08-30-search')).token;
  assert.throws(
    () => prepareClosureFromToken({
      projectRoot: item.root,
      simulateFailureAfter: 'pending-publish',
      topicToken,
    }),
    /simulated failure after pending publish/,
  );
  const orphan = inspectPendingClosure({ projectRoot: item.root });
  assert.ok(orphan?.pendingToken);
  assert.throws(
    () => cancelPendingClosure({
      pendingToken: orphan.pendingToken,
      projectRoot: item.root,
      simulateFailureAfter: 'cancel-move',
    }),
    /simulated failure after cancel move/,
  );
  const relocated = inspectPendingClosure({ projectRoot: item.root });
  assert.equal(relocated?.location, 'cancelled');
  const completed = cancelPendingClosure({
    pendingToken: relocated.pendingToken,
    projectRoot: item.root,
  });
  assert.equal(fs.existsSync(completed.cancelledPath), true);
  assert.equal(inspectPendingClosure({ projectRoot: item.root }), null);
});

test('prepare preserves clean committed source scope for a bounded context assessment', (t) => {
  const item = directFixture(t);
  commitDelivery(item.root, 'commit delivery before close');
  const prepared = prepareDirect(item);
  assert.equal(prepared.contextImpact.decision, 'review');
  assert.match(prepared.contextImpact.reasons.join(','), /source-or-module/);
  cancelPendingClosure({ projectRoot: item.root, pendingToken: prepared.pendingToken });
});

test('unsafe topic descendants are discrepancies and never receive prepare authority', (t) => {
  const { root, topic } = directFixture(t);
  const outside = path.join(root, 'outside.md');
  fs.writeFileSync(outside, 'outside\n');
  fs.symlinkSync(outside, path.join(root, topic, 'linked.md'));

  const result = discoverCloseTopics({ projectRoot: root });
  const entry = result.entries.find((candidate) => candidate.displayPath.endsWith('/2026-08-30-search'));
  assert.equal(entry.closable, false);
  assert.equal(entry.token, null);
  assert.match(entry.reason, /topic status is unknown/);
  assert.doesNotMatch(entry.reason, /outside\.md|outside\n/);
});

test('prepare rejects token tampering, wrong-root replay, invalid UTF-8, and active ownership overlap', (t) => {
  const first = directFixture(t);
  const second = directFixture(t);
  const discovery = discoverCloseTopics({ projectRoot: first.root });
  const topicToken = discovery.entries.find((entry) => entry.displayPath.endsWith('/2026-08-30-search')).token;
  const tampered = `${topicToken.slice(0, -1)}${topicToken.endsWith('A') ? 'B' : 'A'}`;

  assert.throws(
    () => prepareClosureFromToken({ projectRoot: first.root, topicToken: tampered }),
    /token|checksum|canonical/i,
  );
  assert.throws(
    () => prepareClosureFromToken({ projectRoot: second.root, topicToken }),
    /root replay|identity mismatch/i,
  );

  fs.writeFileSync(path.join(first.root, first.topic, 'invalid.md'), Buffer.from([0xc3, 0x28]));
  const unsafe = discoverCloseTopics({ projectRoot: first.root }).entries
    .find((entry) => entry.displayPath.endsWith('/2026-08-30-search'));
  assert.equal(unsafe.closable, false);
  assert.match(unsafe.reason, /UTF-8/);
  fs.unlinkSync(path.join(first.root, first.topic, 'invalid.md'));

  write(first.root, 'docs/work/2026-08-30-active/design.md', '# Active — Design\n');
  write(first.root, 'docs/work/2026-08-30-active/plan.md', [
    '## Wave 1',
    '- [ ] T1: Active — done when: green.',
    '  - files: `src/app.mjs`',
    '',
  ].join('\n'));
  const freshToken = discoverCloseTopics({ projectRoot: first.root }).entries
    .find((entry) => entry.displayPath.endsWith('/2026-08-30-search')).token;
  assert.throws(
    () => prepareClosureFromToken({ projectRoot: first.root, topicToken: freshToken }),
    /active plan ownership overlaps close scope/,
  );
});

test('prepare fails closed when another active plan cannot be read safely', (t) => {
  const item = directFixture(t);
  write(item.root, 'docs/work/2026-08-30-active/design.md', '# Active — Design\n');
  const outside = path.join(item.root, 'outside-plan.md');
  fs.writeFileSync(outside, '- [ ] T1: unsafe\n  - files: `src/app.mjs`\n');
  fs.symlinkSync(outside, path.join(item.root, 'docs/work/2026-08-30-active/plan.md'));
  const token = discoverCloseTopics({ projectRoot: item.root }).entries
    .find((entry) => entry.displayPath.endsWith('/2026-08-30-search')).token;

  assert.throws(
    () => prepareClosureFromToken({ projectRoot: item.root, topicToken: token }),
    /unsafe active plan|symbolic link/i,
  );
});

test('Git provenance ignores ambient repository and index routing variables', (t) => {
  const selected = directFixture(t);
  const foreign = directFixture(t);
  write(foreign.root, 'README.md', '# Foreign repository\n');
  git(foreign.root, 'add', 'README.md');
  git(foreign.root, 'commit', '-qm', 'make foreign HEAD distinct');
  const token = discoverCloseTopics({ projectRoot: selected.root }).entries
    .find((entry) => entry.displayPath.endsWith('/2026-08-30-search')).token;
  const selectedHead = git(selected.root, 'rev-parse', 'HEAD');
  const previous = {
    GIT_DIR: process.env.GIT_DIR,
    GIT_INDEX_FILE: process.env.GIT_INDEX_FILE,
    GIT_WORK_TREE: process.env.GIT_WORK_TREE,
  };
  process.env.GIT_DIR = path.join(foreign.root, '.git');
  process.env.GIT_WORK_TREE = foreign.root;
  process.env.GIT_INDEX_FILE = path.join(foreign.root, '.git/index');
  try {
    const prepared = prepareClosureFromToken({ projectRoot: selected.root, topicToken: token });
    const manifest = JSON.parse(fs.readFileSync(path.join(prepared.pendingPath, 'manifest.json'), 'utf8'));
    assert.equal(manifest.head, selectedHead);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('Close discovery never executes a repository-configured FSMonitor hook', (t) => {
  const item = directFixture(t);
  addIgnoredCompletedTopic(item.root, '2026-08-31-orders', 'src/orders.mjs');
  const hook = path.join(path.dirname(item.root), `${path.basename(item.root)}-fsmonitor.sh`);
  const marker = path.join(path.dirname(item.root), `${path.basename(item.root)}-fsmonitor-invoked`);
  t.after(() => {
    fs.rmSync(hook, { force: true });
    fs.rmSync(marker, { force: true });
  });
  fs.writeFileSync(hook, `#!/bin/sh\nprintf invoked > ${JSON.stringify(marker)}\n`);
  fs.chmodSync(hook, 0o700);
  git(item.root, 'config', 'core.fsmonitor', hook);

  const ordinary = discoverCloseTopics({ projectRoot: item.root });
  assert.ok(ordinary.entries.some((entry) => entry.closable));
  assert.equal(fs.existsSync(marker), false);

  const batch = closeLifecycle.discoverReleaseBatch({ projectRoot: item.root });
  assert.equal(batch.eligiblePaths.length, 2);
  assert.equal(fs.existsSync(marker), false);
});

test('CLI exposes token-only discovery and rejects raw path-shaped commands', (t) => {
  const { root } = directFixture(t);
  const runner = path.join(path.dirname(new URL(import.meta.url).pathname), 'run-close.mjs');
  const discovered = spawnSync(process.execPath, [runner, 'discover'], { cwd: root, encoding: 'utf8' });
  assert.equal(discovered.status, 0, discovered.stderr);
  assert.ok(JSON.parse(discovered.stdout).entries.some((entry) => entry.closable));

  const raw = spawnSync(process.execPath, [runner, 'prepare', 'docs/work/2026-08-30-search'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(raw.status, 1);
  assert.match(raw.stderr, /usage/);
});

function prepareDirect(item) {
  const entry = discoverCloseTopics({ projectRoot: item.root }).entries
    .find((candidate) => candidate.displayPath.endsWith('/2026-08-30-search'));
  return prepareClosureFromToken({ projectRoot: item.root, topicToken: entry.token });
}

function commitDelivery(root, message = 'deliver') {
  git(root, 'add', 'src/app.mjs');
  git(root, 'commit', '-qm', message);
}

test('finalize refuses unchanged HEAD and mismatched committed delivery before topic mutation', (t) => {
  const unchanged = directFixture(t);
  const unchangedPrepared = prepareDirect(unchanged);
  assert.throws(
    () => finalizeClosureFromToken({ projectRoot: unchanged.root, pendingToken: unchangedPrepared.pendingToken }),
    /HEAD.*change|changed user-created HEAD/i,
  );
  assert.equal(fs.existsSync(path.join(unchanged.root, unchanged.topic)), true);

  const drifted = directFixture(t);
  const driftedPrepared = prepareDirect(drifted);
  write(drifted.root, 'src/app.mjs', 'export const value = 3;\n');
  commitDelivery(drifted.root, 'wrong delivery bytes');
  assert.throws(
    () => finalizeClosureFromToken({ projectRoot: drifted.root, pendingToken: driftedPrepared.pendingToken }),
    /delivery.*bytes|prepared.*bytes/i,
  );
  assert.equal(fs.existsSync(path.join(drifted.root, drifted.topic)), true);

  const cleanThenChanged = directFixture(t);
  commitDelivery(cleanThenChanged.root, 'commit before prepare');
  const cleanPrepared = prepareDirect(cleanThenChanged);
  write(cleanThenChanged.root, 'src/app.mjs', 'export const value = 4;\n');
  commitDelivery(cleanThenChanged.root, 'post-prepare drift');
  assert.throws(
    () => finalizeClosureFromToken({ projectRoot: cleanThenChanged.root, pendingToken: cleanPrepared.pendingToken }),
    /delivery prepared bytes|plan-owned.*changed/i,
  );
  assert.equal(fs.existsSync(path.join(cleanThenChanged.root, cleanThenChanged.topic)), true);
});

test('finalize archives an exact ignored topic after the delivery commit and reruns Doctor', (t) => {
  const item = directFixture(t);
  const prepared = prepareDirect(item);
  commitDelivery(item.root);

  const result = finalizeClosureFromToken({ projectRoot: item.root, pendingToken: prepared.pendingToken });
  assert.equal(result.topicResult, 'archived-ignored-or-untracked');
  assert.equal(fs.existsSync(path.join(item.root, item.topic)), false);
  assert.equal(fs.existsSync(path.join(result.archivePath, 'topic', 'review.md')), true);
  for (const manifestPath of [
    path.join(result.archivePath, 'manifest.json'),
    path.join(result.archivePath, 'pending', 'manifest.json'),
  ]) {
    assert.equal(
      crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex'),
      prepared.manifestHash,
    );
  }
  assert.equal(result.doctor.errors, 0);
  assert.equal(inspectPendingClosure({ projectRoot: item.root }), null);
});

test('finalize proves tracked history and committed deletion without archiving a topic payload', (t) => {
  const item = directFixture(t, { ignoredWork: false });
  git(item.root, 'add', item.topic);
  git(item.root, 'commit', '-qm', 'record final topic evidence');
  const prepared = prepareDirect(item);
  commitDelivery(item.root);
  git(item.root, 'rm', '-qr', item.topic);
  git(item.root, 'commit', '-qm', 'remove tracked work topic');

  const result = finalizeClosureFromToken({ projectRoot: item.root, pendingToken: prepared.pendingToken });
  assert.equal(result.topicResult, 'tracked-deletion-proven');
  assert.equal(fs.existsSync(path.join(result.archivePath, 'topic')), false);
  assert.equal(fs.existsSync(path.join(result.archivePath, 'manifest.json')), true);
});

test('prepare records a tracked topic descendant already deleted from the worktree', (t) => {
  const item = directFixture(t, { ignoredWork: false });
  write(item.root, `${item.topic}/evidence.md`, 'tracked evidence\n');
  git(item.root, 'add', item.topic);
  git(item.root, 'commit', '-qm', 'track final topic plus evidence');
  fs.unlinkSync(path.join(item.root, item.topic, 'evidence.md'));
  const prepared = prepareDirect(item);
  const manifest = JSON.parse(fs.readFileSync(path.join(prepared.pendingPath, 'manifest.json'), 'utf8'));
  const absent = manifest.topic.records.find((record) => record.path.endsWith('/evidence.md'));
  assert.equal(absent?.tracking, 'tracked');
  assert.equal(absent?.state, 'absent');

  commitDelivery(item.root);
  assert.throws(
    () => finalizeClosureFromToken({ projectRoot: item.root, pendingToken: prepared.pendingToken }),
    /tracked topic deletion is not committed/i,
  );
  git(item.root, 'add', '-u', item.topic);
  git(item.root, 'commit', '-qm', 'commit evidence deletion');
  git(item.root, 'rm', '-qr', item.topic);
  git(item.root, 'commit', '-qm', 'remove tracked topic');
  const result = finalizeClosureFromToken({ projectRoot: item.root, pendingToken: prepared.pendingToken });
  assert.equal(result.topicResult, 'tracked-deletion-proven');
});

test('finalize archives only exact ignored or untracked residue from a mixed topic', (t) => {
  const item = directFixture(t, { ignoredWork: false });
  git(item.root, 'add', `${item.topic}/design.md`);
  git(item.root, 'commit', '-qm', 'track topic design evidence');
  const prepared = prepareDirect(item);
  commitDelivery(item.root);
  git(item.root, 'rm', '-q', `${item.topic}/design.md`);
  git(item.root, 'commit', '-qm', 'remove tracked topic evidence');

  const result = finalizeClosureFromToken({ projectRoot: item.root, pendingToken: prepared.pendingToken });
  assert.equal(result.topicResult, 'archived-mixed-residue');
  assert.equal(fs.existsSync(path.join(item.root, item.topic)), false);
  assert.equal(fs.existsSync(path.join(result.archivePath, 'topic', 'plan.md')), true);
  assert.equal(fs.existsSync(path.join(result.archivePath, 'topic', 'review.md')), true);
  assert.equal(fs.existsSync(path.join(result.archivePath, 'topic', 'design.md')), false);
});

test('finalize rejects a prepared ignored file that becomes tracked with identical bytes', (t) => {
  const item = directFixture(t);
  const prepared = prepareDirect(item);
  git(item.root, 'add', 'src/app.mjs');
  git(item.root, 'add', '-f', `${item.topic}/review.md`);
  git(item.root, 'commit', '-qm', 'delivery plus tracking drift');

  assert.throws(
    () => finalizeClosureFromToken({ projectRoot: item.root, pendingToken: prepared.pendingToken }),
    /tracking.*changed|tracking.*drift/i,
  );
  assert.equal(fs.existsSync(path.join(item.root, item.topic)), true);
});

test('finalize rejects pending manifest drift before archive publication', (t) => {
  const item = directFixture(t);
  const prepared = prepareDirect(item);
  commitDelivery(item.root);
  const manifestPath = path.join(prepared.pendingPath, 'manifest.json');
  const original = fs.readFileSync(manifestPath);
  const changed = JSON.parse(original.toString('utf8'));
  changed.phase = 'prepared-drift';

  assert.throws(
    () => finalizeClosureFromToken({
      beforeArchivePublish() {
        fs.writeFileSync(manifestPath, `${JSON.stringify(changed)}\n`);
      },
      pendingToken: prepared.pendingToken,
      projectRoot: item.root,
    }),
    /pending manifest changed after validation/i,
  );
  assert.equal(fs.existsSync(path.join(item.root, item.topic)), true);
  assert.deepEqual(fs.readdirSync(path.join(item.root, '.nectar/closures/archive')), []);

  fs.writeFileSync(manifestPath, original);
  cancelPendingClosure({ projectRoot: item.root, pendingToken: prepared.pendingToken });
});

test('recovery accepts an exact already-archived post-state and completes the pending record', (t) => {
  const item = directFixture(t);
  const prepared = prepareDirect(item);
  commitDelivery(item.root);
  const first = finalizeClosureFromToken({
    projectRoot: item.root,
    pendingToken: prepared.pendingToken,
    simulateFailureAfter: 'topic-rename',
  });
  assert.equal(first.recoveryRequired, true);
  assert.equal(fs.existsSync(path.join(first.archivePath, 'topic')), true);

  const recovered = recoverPendingClosure({ projectRoot: item.root, pendingToken: prepared.pendingToken });
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.topicResult, 'archived-ignored-or-untracked');
  assert.equal(inspectPendingClosure({ projectRoot: item.root }), null);
});

test('recovery resolves the archived pending manifest after terminal relocation before DB commit', (t) => {
  const item = directFixture(t);
  const prepared = prepareDirect(item);
  commitDelivery(item.root);
  const interrupted = finalizeClosureFromToken({
    projectRoot: item.root,
    pendingToken: prepared.pendingToken,
    simulateFailureAfter: 'pending-move',
  });
  assert.equal(interrupted.recoveryRequired, true);
  assert.equal(fs.existsSync(path.join(interrupted.archivePath, 'pending', 'manifest.json')), true);
  assert.equal(fs.existsSync(path.join(item.root, '.nectar/closures/pending/current')), false);

  const recovered = recoverPendingClosure({ projectRoot: item.root, pendingToken: prepared.pendingToken });
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.topicResult, 'archived-ignored-or-untracked');
  assert.equal(inspectPendingClosure({ projectRoot: item.root }), null);
  const nextTopic = 'docs/work/2026-08-30-second';
  write(item.root, `${nextTopic}/design.md`, '# Second — Design\n');
  write(item.root, `${nextTopic}/plan.md`, '## Wave 1\n- [x] T1: Second — done when: green.\n  - files: `src/app.mjs`\n');
  write(item.root, `${nextTopic}/review.md`, canonicalReview);
  const nextToken = discoverCloseTopics({ projectRoot: item.root }).entries
    .find((entry) => entry.displayPath.endsWith('/2026-08-30-second')).token;
  const next = prepareClosureFromToken({ projectRoot: item.root, topicToken: nextToken });
  assert.equal(inspectPendingClosure({ projectRoot: item.root })?.id, next.id);
  cancelPendingClosure({ projectRoot: item.root, pendingToken: next.pendingToken });
});

test('support reconciliation is sealed only after its preimage is durable and finalize proves the postimage', (t) => {
  const item = directFixture(t);
  write(item.root, 'docs/work/backlog.md', '# Backlog\n- Search cleanup\n- Keep me\n');
  const topicToken = discoverCloseTopics({ projectRoot: item.root }).entries
    .find((entry) => entry.displayPath.endsWith('/2026-08-30-search')).token;
  const backlog = discoverCloseSupport({ projectRoot: item.root }).entries
    .find((entry) => entry.displayPath === 'docs/work/backlog.md');
  const prepared = prepareClosureFromToken({
    projectRoot: item.root,
    supportTokens: [backlog.token],
    topicToken,
  });
  const pendingManifest = JSON.parse(fs.readFileSync(
    path.join(prepared.pendingPath, 'manifest.json'),
    'utf8',
  ));
  assert.equal(
    Buffer.from(pendingManifest.supports[0].bytes, 'base64').toString('utf8'),
    '# Backlog\n- Search cleanup\n- Keep me\n',
  );

  write(item.root, 'docs/work/backlog.md', '# Backlog\n- Keep me\n');
  const sealed = sealPendingSupportFromToken({
    pendingToken: prepared.pendingToken,
    projectRoot: item.root,
  });
  assert.match(sealed.supportSealHash, /^[a-f0-9]{64}$/);
  commitDelivery(item.root);

  const result = finalizeClosureFromToken({ projectRoot: item.root, pendingToken: prepared.pendingToken });
  assert.equal(result.support[0].state, 'postimage-proven');
  assert.equal(fs.readFileSync(path.join(item.root, 'docs/work/backlog.md'), 'utf8'), '# Backlog\n- Keep me\n');
  assert.equal(fs.existsSync(path.join(result.archivePath, 'pending', 'support-seal.json')), true);
});

test('tracked support must be sealed, committed byte-exact, and clean before finalize', (t) => {
  const item = directFixture(t);
  const topicToken = discoverCloseTopics({ projectRoot: item.root }).entries
    .find((entry) => entry.displayPath.endsWith('/2026-08-30-search')).token;
  const changelog = discoverCloseSupport({ projectRoot: item.root }).entries
    .find((entry) => entry.displayPath === 'CHANGELOG.md');
  const prepared = prepareClosureFromToken({
    projectRoot: item.root,
    supportTokens: [changelog.token],
    topicToken,
  });
  write(item.root, 'CHANGELOG.md', '# Changelog\n\nDelivered search.\n');
  sealPendingSupportFromToken({ projectRoot: item.root, pendingToken: prepared.pendingToken });
  commitDelivery(item.root);
  assert.throws(
    () => finalizeClosureFromToken({ projectRoot: item.root, pendingToken: prepared.pendingToken }),
    /tracked support remains dirty/,
  );
  assert.equal(fs.existsSync(path.join(item.root, item.topic)), true);

  git(item.root, 'add', 'CHANGELOG.md');
  git(item.root, 'commit', '-qm', 'commit close changelog');
  const result = finalizeClosureFromToken({ projectRoot: item.root, pendingToken: prepared.pendingToken });
  assert.equal(result.support[0].state, 'postimage-proven');
});

test('finalize rejects ignored support that becomes tracked after sealing', (t) => {
  const item = directFixture(t);
  write(item.root, 'docs/work/backlog.md', '# Backlog\n- Search cleanup\n');
  const topicToken = discoverCloseTopics({ projectRoot: item.root }).entries
    .find((entry) => entry.displayPath.endsWith('/2026-08-30-search')).token;
  const backlog = discoverCloseSupport({ projectRoot: item.root }).entries
    .find((entry) => entry.displayPath === 'docs/work/backlog.md');
  const prepared = prepareClosureFromToken({
    projectRoot: item.root,
    supportTokens: [backlog.token],
    topicToken,
  });
  sealPendingSupportFromToken({ projectRoot: item.root, pendingToken: prepared.pendingToken });
  git(item.root, 'add', 'src/app.mjs');
  git(item.root, 'add', '-f', 'docs/work/backlog.md');
  git(item.root, 'commit', '-qm', 'delivery plus support tracking drift');

  assert.throws(
    () => finalizeClosureFromToken({ projectRoot: item.root, pendingToken: prepared.pendingToken }),
    /support tracking changed|tracking drift.*backlog/i,
  );
  assert.equal(fs.existsSync(path.join(item.root, item.topic)), true);
});

test('an independent SQLite writer serializes finalize without touching the topic', async (t) => {
  const item = directFixture(t);
  const prepared = prepareDirect(item);
  commitDelivery(item.root);
  const databasePath = path.join(item.root, '.nectar/closures/state.sqlite');
  const holder = spawn(process.execPath, ['--input-type=module', '-e', [
    "import { DatabaseSync } from 'node:sqlite';",
    'const database = new DatabaseSync(process.argv[1], { timeout: 0 });',
    "database.exec('BEGIN IMMEDIATE');",
    "process.stdout.write('READY\\n');",
    "const timer=setInterval(()=>{},1000);",
    "process.on('SIGTERM',()=>{clearInterval(timer);database.exec('ROLLBACK');database.close();process.exit(0);});",
  ].join(''), databasePath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (!holder.killed) holder.kill('SIGTERM'); });
  await new Promise((resolve, reject) => {
    holder.stdout.once('data', (chunk) => (chunk.toString().includes('READY') ? resolve() : reject(new Error(chunk))));
    holder.once('error', reject);
  });

  assert.throws(
    () => finalizeClosureFromToken({ projectRoot: item.root, pendingToken: prepared.pendingToken }),
    /busy|locked/i,
  );
  assert.equal(fs.existsSync(path.join(item.root, item.topic)), true);
  holder.kill('SIGTERM');
  await new Promise((resolve) => holder.once('exit', resolve));

  const result = finalizeClosureFromToken({ projectRoot: item.root, pendingToken: prepared.pendingToken });
  assert.equal(result.topicResult, 'archived-ignored-or-untracked');
});

test('release batch discovery binds the exact eligible ignored roots and rejects index-only staged topic state', (t) => {
  assert.equal(typeof closeLifecycle.discoverReleaseBatch, 'function');
  const item = directFixture(t);
  const second = addIgnoredCompletedTopic(item.root, '2026-08-30-billing', 'src/billing.mjs');
  write(item.root, 'docs/work/legacy-done/design.md', '# Legacy — Design\n');
  write(item.root, 'docs/work/legacy-done/plan.md', '## Wave 1\n- [x] T1: Legacy — done when: green.\n');
  write(item.root, 'docs/work/legacy-done/review.md', canonicalReview);
  write(item.root, 'docs/work/2026-08-30-active/design.md', '# Active — Design\n');
  write(item.root, 'docs/work/2026-08-30-active/plan.md', '## Wave 1\n- [ ] T1: Active — done when: green.\n');
  write(item.root, 'docs/work/2026-08-30-tracked/design.md', '# Tracked — Design\n');
  write(item.root, 'docs/work/2026-08-30-tracked/plan.md', '## Wave 1\n- [x] T1: Tracked — done when: green.\n');
  write(item.root, 'docs/work/2026-08-30-tracked/review.md', canonicalReview);
  git(item.root, 'add', '-f', 'docs/work/2026-08-30-tracked');
  git(item.root, 'commit', '-qm', 'track completed topic');

  const discovered = closeLifecycle.discoverReleaseBatch({ projectRoot: item.root });
  assert.deepEqual(discovered.eligiblePaths, [item.topic, second].sort());
  assert.match(discovered.batchToken, /^[A-Za-z0-9_-]+$/);
  assert.ok(discovered.rejected.some((entry) => entry.displayPath === 'docs/work/legacy-done'));
  assert.ok(discovered.rejected.some((entry) => entry.displayPath === 'docs/work/2026-08-30-active'));
  assert.ok(discovered.rejected.some((entry) => (
    entry.displayPath === 'docs/work/2026-08-30-tracked' && /tracked-only/i.test(entry.reason)
  )));

  const staged = `${item.topic}/index-only.md`;
  write(item.root, staged, 'index-only evidence\n');
  git(item.root, 'add', '-f', staged);
  fs.unlinkSync(path.join(item.root, staged));
  const unsafe = closeLifecycle.discoverReleaseBatch({ projectRoot: item.root });
  assert.equal(unsafe.batchToken, null);
  assert.ok(unsafe.discrepancies.some((entry) => /index|staged/i.test(entry.reason)));
});

test('release batch token refuses discovery drift before prepare', (t) => {
  const item = directFixture(t);
  addIgnoredCompletedTopic(item.root, '2026-08-30-billing', 'src/billing.mjs');
  const discovered = closeLifecycle.discoverReleaseBatch({ projectRoot: item.root });
  addIgnoredCompletedTopic(item.root, '2026-08-30-reports', 'src/reports.mjs');

  assert.throws(
    () => closeLifecycle.prepareReleaseBatchFromToken({
      batchToken: discovered.batchToken,
      projectRoot: item.root,
    }),
    /current release batch|discovery.*changed|membership/i,
  );
});

test('release batch recovers a partial topic move into one archive and preserves assets', (t) => {
  const item = directFixture(t);
  const second = addIgnoredCompletedTopic(item.root, '2026-08-30-billing', 'src/billing.mjs');
  write(item.root, 'assets/logo.txt', 'immutable asset\n');
  const assetsBefore = treeDigest(item.root, 'assets');
  const discovered = closeLifecycle.discoverReleaseBatch({ projectRoot: item.root });
  const prepared = closeLifecycle.prepareReleaseBatchFromToken({
    batchToken: discovered.batchToken,
    projectRoot: item.root,
  });
  git(item.root, 'add', 'src/app.mjs', 'src/billing.mjs');
  git(item.root, 'commit', '-qm', 'deliver release batch');

  const interrupted = finalizeClosureFromToken({
    pendingToken: prepared.pendingToken,
    projectRoot: item.root,
    simulateFailureAfter: 'topic-rename:0',
  });
  assert.equal(interrupted.recoveryRequired, true);
  const recovered = recoverPendingClosure({
    pendingToken: prepared.pendingToken,
    projectRoot: item.root,
  });
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.topicResult, 'archived-release-batch');
  for (const topic of [item.topic, second]) {
    assert.equal(fs.existsSync(path.join(item.root, topic)), false);
    assert.equal(
      fs.existsSync(path.join(recovered.archivePath, 'topics', path.basename(topic), 'review.md')),
      true,
    );
  }
  assert.equal(treeDigest(item.root, 'assets'), assetsBefore);
  assert.equal(inspectPendingClosure({ projectRoot: item.root }), null);
});

test('release batch finalize refuses assets and post-prepare ownership drift', (t) => {
  const assets = directFixture(t);
  addIgnoredCompletedTopic(assets.root, '2026-08-30-billing', 'src/billing.mjs');
  write(assets.root, 'assets/logo.txt', 'immutable asset\n');
  const assetsPrepared = closeLifecycle.prepareReleaseBatchFromToken({
    batchToken: closeLifecycle.discoverReleaseBatch({ projectRoot: assets.root }).batchToken,
    projectRoot: assets.root,
  });
  write(assets.root, 'assets/logo.txt', 'drifted asset\n');
  git(assets.root, 'add', 'src/app.mjs', 'src/billing.mjs');
  git(assets.root, 'commit', '-qm', 'deliver with asset drift');
  assert.throws(
    () => finalizeClosureFromToken({ projectRoot: assets.root, pendingToken: assetsPrepared.pendingToken }),
    /assets.*changed|immutable.*drift/i,
  );

  const ownership = directFixture(t);
  addIgnoredCompletedTopic(ownership.root, '2026-08-30-billing', 'src/billing.mjs');
  const ownershipPrepared = closeLifecycle.prepareReleaseBatchFromToken({
    batchToken: closeLifecycle.discoverReleaseBatch({ projectRoot: ownership.root }).batchToken,
    projectRoot: ownership.root,
  });
  write(ownership.root, 'docs/work/2026-08-30-active/design.md', '# Active — Design\n');
  write(ownership.root, 'docs/work/2026-08-30-active/plan.md', [
    '## Wave 1',
    '- [ ] T1: Active — done when: green.',
    '  - files: `src/billing.mjs`',
    '',
  ].join('\n'));
  git(ownership.root, 'add', 'src/app.mjs', 'src/billing.mjs');
  git(ownership.root, 'commit', '-qm', 'deliver with ownership drift');
  assert.throws(
    () => finalizeClosureFromToken({ projectRoot: ownership.root, pendingToken: ownershipPrepared.pendingToken }),
    /active plan ownership overlaps close scope/i,
  );
});

test('release batch consolidates shared delivery ownership across completed roots', (t) => {
  const item = directFixture(t);
  const topic = 'docs/work/2026-08-30-overlap';
  write(item.root, `${topic}/design.md`, '# Overlap — Design\n');
  write(item.root, `${topic}/plan.md`, [
    '## Wave 1',
    '- [x] T1: Overlap — done when: green.',
    '  - files: `src/app.mjs`',
    '',
  ].join('\n'));
  write(item.root, `${topic}/review.md`, canonicalReview);

  const result = closeLifecycle.discoverReleaseBatch({ projectRoot: item.root });
  assert.match(result.batchToken, /^[A-Za-z0-9_-]+$/);
  const prepared = closeLifecycle.prepareReleaseBatchFromToken({
    batchToken: result.batchToken,
    projectRoot: item.root,
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(prepared.pendingPath, 'manifest.json'), 'utf8'));
  assert.equal(manifest.delivery.filter((entry) => entry.path === 'src/app.mjs').length, 1);
  cancelPendingClosure({ projectRoot: item.root, pendingToken: prepared.pendingToken });
});

test('finalize recovery converges after every published archive and database transition', (t) => {
  for (const failurePoint of [
    'archive-publish',
    'topic-rename',
    'result-write',
    'pending-move',
    'db-idle',
  ]) {
    const item = directFixture(t);
    const prepared = prepareDirect(item);
    commitDelivery(item.root, `delivery for ${failurePoint}`);
    const interrupted = finalizeClosureFromToken({
      pendingToken: prepared.pendingToken,
      projectRoot: item.root,
      simulateFailureAfter: failurePoint,
    });
    assert.equal(interrupted.recoveryRequired, true, failurePoint);
    const recovered = recoverPendingClosure({
      pendingToken: prepared.pendingToken,
      projectRoot: item.root,
    });
    assert.equal(recovered.recovered, true, failurePoint);
    assert.equal(recovered.topicResult, 'archived-ignored-or-untracked', failurePoint);
    assert.equal(inspectPendingClosure({ projectRoot: item.root }), null, failurePoint);
  }
});

test('support seal published before database commit is adopted without rewriting evidence', (t) => {
  const item = directFixture(t);
  write(item.root, 'docs/work/backlog.md', '# Backlog\n- Search cleanup\n');
  const topicToken = discoverCloseTopics({ projectRoot: item.root }).entries
    .find((entry) => entry.displayPath === item.topic).token;
  const supportToken = discoverCloseSupport({ projectRoot: item.root }).entries
    .find((entry) => entry.displayPath === 'docs/work/backlog.md').token;
  const prepared = prepareClosureFromToken({
    projectRoot: item.root,
    supportTokens: [supportToken],
    topicToken,
  });
  assert.throws(
    () => sealPendingSupportFromToken({
      pendingToken: prepared.pendingToken,
      projectRoot: item.root,
      simulateFailureAfter: 'support-seal-publish',
    }),
    /simulated failure after support seal publish/,
  );
  const sealPath = path.join(prepared.pendingPath, 'support-seal.json');
  const before = fs.readFileSync(sealPath);
  const adopted = sealPendingSupportFromToken({
    pendingToken: prepared.pendingToken,
    projectRoot: item.root,
  });
  assert.match(adopted.supportSealHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(fs.readFileSync(sealPath), before);
});

test('CLI discovers and prepares a release batch only through opaque tokens', (t) => {
  const item = directFixture(t);
  addIgnoredCompletedTopic(item.root, '2026-08-30-billing', 'src/billing.mjs');
  const runner = path.join(path.dirname(new URL(import.meta.url).pathname), 'run-close.mjs');
  const discovered = spawnSync(process.execPath, [runner, 'discover-release-batch'], {
    cwd: item.root,
    encoding: 'utf8',
  });
  assert.equal(discovered.status, 0, discovered.stderr);
  const batch = JSON.parse(discovered.stdout);
  assert.match(batch.batchToken, /^[A-Za-z0-9_-]+$/);
  const prepared = spawnSync(process.execPath, [
    runner,
    'prepare-release-batch-token',
    batch.batchToken,
  ], { cwd: item.root, encoding: 'utf8' });
  assert.equal(prepared.status, 0, prepared.stderr);
  const pending = JSON.parse(prepared.stdout);
  assert.deepEqual(pending.topics, [item.topic, 'docs/work/2026-08-30-billing'].sort());
  cancelPendingClosure({ projectRoot: item.root, pendingToken: pending.pendingToken });

  const raw = spawnSync(process.execPath, [
    runner,
    'prepare-release-batch-token',
    item.topic,
  ], { cwd: item.root, encoding: 'utf8' });
  assert.equal(raw.status, 1);
  assert.match(raw.stderr, /token|base64url/i);
});

test('busy prepare leaves no unpublished stage residue', async (t) => {
  const item = directFixture(t);
  const first = prepareDirect(item);
  cancelPendingClosure({ projectRoot: item.root, pendingToken: first.pendingToken });
  const databasePath = path.join(item.root, '.nectar/closures/state.sqlite');
  const holder = spawn(process.execPath, ['--input-type=module', '-e', [
    "import { DatabaseSync } from 'node:sqlite';",
    'const database = new DatabaseSync(process.argv[1], { timeout: 0 });',
    "database.exec('BEGIN IMMEDIATE');",
    "process.stdout.write('READY\\n');",
    'const timer=setInterval(()=>{},1000);',
    "process.on('SIGTERM',()=>{clearInterval(timer);database.exec('ROLLBACK');database.close();process.exit(0);});",
  ].join(''), databasePath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (!holder.killed) holder.kill('SIGTERM'); });
  await new Promise((resolve, reject) => {
    holder.stdout.once('data', (chunk) => (chunk.toString().includes('READY') ? resolve() : reject(new Error(chunk))));
    holder.once('error', reject);
  });
  const topicToken = discoverCloseTopics({ projectRoot: item.root }).entries
    .find((entry) => entry.displayPath === item.topic).token;
  assert.throws(
    () => prepareClosureFromToken({ projectRoot: item.root, topicToken }),
    /busy|locked/i,
  );
  const pendingEntries = fs.readdirSync(path.join(item.root, '.nectar/closures/pending'));
  assert.deepEqual(pendingEntries, []);
  holder.kill('SIGTERM');
  await new Promise((resolve) => holder.once('exit', resolve));
});

test('prepare cleans its unpublished stage when it loses before transaction ownership', (t) => {
  const item = directFixture(t);
  const topicToken = discoverCloseTopics({ projectRoot: item.root }).entries
    .find((entry) => entry.displayPath === item.topic).token;
  assert.throws(
    () => prepareClosureFromToken({
      projectRoot: item.root,
      simulateFailureAfter: 'stage-ready',
      topicToken,
    }),
    /simulated failure after stage ready/,
  );
  assert.deepEqual(fs.readdirSync(path.join(item.root, '.nectar/closures/pending')), []);
  assert.equal(inspectPendingClosure({ projectRoot: item.root }), null);
});

test('pending inspection rejects a symlinked SQLite state before opening it', (t) => {
  const item = directFixture(t);
  const closures = path.join(item.root, '.nectar/closures');
  fs.mkdirSync(path.join(closures, 'pending'), { recursive: true });
  fs.mkdirSync(path.join(closures, 'archive'), { recursive: true });
  fs.mkdirSync(path.join(closures, 'cancelled'), { recursive: true });
  const outside = path.join(item.root, 'outside.sqlite');
  fs.writeFileSync(outside, 'foreign state\n');
  fs.symlinkSync(outside, path.join(closures, 'state.sqlite'));

  assert.throws(
    () => inspectPendingClosure({ projectRoot: item.root }),
    /state\.sqlite.*normal file|symbolic link/i,
  );
});
