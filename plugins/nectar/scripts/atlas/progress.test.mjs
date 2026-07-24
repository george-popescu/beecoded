import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const COUNT_KEYS = [
  'astFts',
  'ftsOnly',
  'metadataOnly',
  'reused',
  'skipped',
  'failed',
];

async function loadProgress() {
  try {
    return await import('./progress.mjs');
  } catch (error) {
    assert.fail(`Atlas progress reporting is not implemented: ${error.message}`);
  }
}

function memoryStream(isTTY) {
  let output = '';
  return {
    isTTY,
    write(chunk) {
      output += chunk;
      return true;
    },
    output() {
      return output;
    },
  };
}

function snapshotDirectory(root) {
  return fs.readdirSync(root, { recursive: true })
    .sort()
    .map((entry) => {
      const target = path.join(root, entry);
      const stat = fs.lstatSync(target);
      return stat.isFile()
        ? [entry, fs.readFileSync(target, 'utf8')]
        : [entry, stat.mode];
    });
}

test('emits every indexing stage with monotonic counts and exactly one final summary', async () => {
  const { createAtlasProgress } = await loadProgress();
  const events = [];
  const progress = createAtlasProgress({
    total: 6,
    onEvent: (event) => events.push(event),
  });

  progress.update('scanning');
  progress.update('classifying', {
    completed: 3,
    counts: {
      astFts: 1,
      ftsOnly: 1,
      metadataOnly: 1,
      skipped: 1,
    },
  });
  progress.update('parsing', {
    completed: 4,
    counts: { reused: 1 },
  });
  progress.update('graph', { completed: 5 });
  progress.update('persistence', {
    completed: 6,
    counts: { failed: 1 },
  });
  const summary = progress.complete({
    commit: 'abc123',
    dirtyFiles: 2,
    durationMs: 25,
  });

  assert.deepEqual(
    events.map((event) => event.stage),
    ['scanning', 'classifying', 'parsing', 'graph', 'persistence', 'complete'],
  );
  assert.deepEqual(
    events.map((event) => event.sequence),
    [1, 2, 3, 4, 5, 6],
  );
  for (const key of COUNT_KEYS) {
    const values = events.map((event) => event.counts[key]);
    assert.deepEqual(values, [...values].sort((left, right) => left - right), key);
  }
  assert.equal(events.filter((event) => event.type === 'atlas-summary').length, 1);
  assert.equal(summary, events.at(-1));
  assert.deepEqual(summary.summary, {
    status: 'complete',
    commit: 'abc123',
    dirtyFiles: 2,
    durationMs: 25,
  });
  assert.throws(
    () => progress.update('parsing', { counts: { astFts: 0 } }),
    /already finished/,
  );
  assert.throws(() => progress.complete(), /already finished/);

  const decreasing = createAtlasProgress({ total: 2 });
  decreasing.update('classifying', { counts: { astFts: 1 } });
  assert.throws(
    () => decreasing.update('parsing', { counts: { astFts: 0 } }),
    /astFts cannot decrease/,
  );
});

test('emits a bounded terminal failure summary without losing accumulated counts', async () => {
  const { createAtlasProgress } = await loadProgress();
  const events = [];
  const progress = createAtlasProgress({
    total: 2,
    onEvent: (event) => events.push(event),
  });

  progress.update('scanning');
  progress.update('parsing', {
    completed: 1,
    counts: { astFts: 1, failed: 1 },
  });
  const summary = progress.fail(new TypeError('parser exploded'), { durationMs: 12 });

  assert.equal(summary.type, 'atlas-summary');
  assert.equal(summary.stage, 'failed');
  assert.equal(summary.terminal, true);
  assert.equal(summary.counts.astFts, 1);
  assert.equal(summary.counts.failed, 1);
  assert.deepEqual(summary.summary, {
    status: 'failed',
    durationMs: 12,
    error: {
      name: 'TypeError',
      message: 'parser exploded',
    },
  });
  assert.equal(events.filter((event) => event.type === 'atlas-summary').length, 1);
});

test('animates progress on one terminal line only when the destination is a TTY', async () => {
  const { createAtlasProgress, createAtlasProgressRenderer } = await loadProgress();
  const stream = memoryStream(true);
  const render = createAtlasProgressRenderer({ stream });
  const progress = createAtlasProgress({ total: 2, onEvent: render });

  progress.update('scanning');
  progress.update('classifying', {
    completed: 1,
    counts: { astFts: 1 },
  });
  progress.complete({ durationMs: 7 });

  const output = stream.output();
  assert.match(output, /\ratlas scanning 0\/2 0%/);
  assert.match(output, /\ratlas classifying 1\/2 50%/);
  assert.match(output, /\ratlas complete 2\/2 100%/);
  assert.equal((output.match(/\n/g) || []).length, 1);
  assert.equal(output.endsWith('\n'), true);
});

test('renders stable newline-delimited text without terminal controls for non-TTY output', async () => {
  const { createAtlasProgress, createAtlasProgressRenderer } = await loadProgress();
  const stream = memoryStream(false);
  const render = createAtlasProgressRenderer({ stream });
  const progress = createAtlasProgress({ total: 2, onEvent: render });

  progress.update('scanning');
  progress.update('classifying', {
    completed: 1,
    counts: { astFts: 1 },
  });
  progress.complete({
    commit: 'abc123',
    dirtyFiles: 1,
    durationMs: 7,
  });

  assert.equal(stream.output(), [
    'atlas scanning 0/2 0% ast+fts=0 fts-only=0 metadata-only=0 reused=0 skipped=0 failed=0',
    'atlas classifying 1/2 50% ast+fts=1 fts-only=0 metadata-only=0 reused=0 skipped=0 failed=0',
    'atlas complete 2/2 100% ast+fts=1 fts-only=0 metadata-only=0 reused=0 skipped=0 failed=0 duration=7ms commit=abc123 dirty=1',
    '',
  ].join('\n'));
  assert.doesNotMatch(stream.output(), /\r|\u001b/);
});

test('keeps multiline failure messages inside one non-TTY event record', async () => {
  const { createAtlasProgress, createAtlasProgressRenderer } = await loadProgress();
  const stream = memoryStream(false);
  const render = createAtlasProgressRenderer({ stream });
  const progress = createAtlasProgress({ total: 1, onEvent: render });

  progress.update('parsing');
  progress.fail(new Error('parser\nfailed\rfor file'), { durationMs: 2 });

  const lines = stream.output().trimEnd().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines.at(-1), /error=Error:parser failed for file$/);
  assert.doesNotMatch(stream.output(), /\r|\u001b/);
});

test('strips terminal controls from human failure records while JSON remains structured', async () => {
  const { createAtlasProgress, createAtlasProgressRenderer } = await loadProgress();
  const textStream = memoryStream(false);
  const progress = createAtlasProgress({
    total: 1,
    onEvent: createAtlasProgressRenderer({ stream: textStream }),
  });
  progress.fail(new Error('\u001b]8;;https://example.test\u0007forged\u001b]8;;\u0007'));

  assert.match(textStream.output(), /forged/);
  assert.doesNotMatch(textStream.output().replaceAll('\n', ''), /[\u0000-\u001f\u007f-\u009f]/);
});

test('renders parseable newline-delimited JSON events without TTY animation bytes', async () => {
  const { createAtlasProgress, createAtlasProgressRenderer } = await loadProgress();
  const stream = memoryStream(true);
  const render = createAtlasProgressRenderer({ stream, format: 'json' });
  const progress = createAtlasProgress({ total: 1, onEvent: render });

  progress.update('scanning');
  progress.complete({ commit: 'def456', durationMs: 3 });

  const lines = stream.output().trimEnd().split('\n');
  const events = lines.map((line) => JSON.parse(line));
  assert.equal(lines.length, 2);
  assert.deepEqual(events.map((event) => event.stage), ['scanning', 'complete']);
  assert.equal(events.at(-1).summary.commit, 'def456');
  assert.doesNotMatch(stream.output(), /\r|\u001b/);
});

test('uses a finite zero percent for empty repositories', async () => {
  const { createAtlasProgress } = await loadProgress();
  const progress = createAtlasProgress({ total: 0 });

  const scanning = progress.update('scanning');
  const complete = progress.complete({ durationMs: 0 });

  assert.equal(scanning.progress.percent, 0);
  assert.equal(complete.progress.percent, 0);
  assert.equal(Number.isFinite(scanning.progress.percent), true);
  assert.equal(Number.isFinite(complete.progress.percent), true);
});

test('does not create or modify repository files while reporting progress', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-atlas-progress-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'entry.js'), 'export const entry = true;\n');
  const before = snapshotDirectory(root);

  const { createAtlasProgress, createAtlasProgressRenderer } = await loadProgress();
  const stream = memoryStream(false);
  const render = createAtlasProgressRenderer({ stream });
  const progress = createAtlasProgress({ total: 1, onEvent: render });
  progress.update('scanning');
  progress.update('persistence', {
    completed: 1,
    counts: { astFts: 1 },
  });
  progress.complete({ durationMs: 1 });

  assert.deepEqual(snapshotDirectory(root), before);
});
