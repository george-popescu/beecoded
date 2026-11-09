import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { parseBoardArguments, runBoard } from './run-board.mjs';
import { renderBoard } from './board/render.mjs';

test('Board selection is explicit and JSON cannot silently write or open a browser', () => {
  const options = parseBoardArguments(['one', '--project', 'two'], '/repo');
  assert.deepEqual(options.projectRoots, ['/repo/one', '/repo/two']);
  assert.throws(() => parseBoardArguments(['--json', '--open']), /cannot/);
  assert.throws(() => parseBoardArguments(['--project']), /Missing/);
  assert.throws(() => parseBoardArguments(['--publish']), /Unknown/);
});

test('untrusted project text cannot escape the embedded data block', () => {
  const data = { projects: [{ label: '</script><script>alert(1)</script>\u2028', topics: [], sessions: [] }] };
  const html = renderBoard(data);
  const block = html.match(/<script type="application\/json" id="board-data">([\s\S]*?)<\/script>/)[1];
  assert.deepEqual(JSON.parse(block), data);
  assert.equal(block.includes('<'), false);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new vm.Script(scripts[0][1]));
});

test('embedded interval exports omit private topic paths and raw identities', () => {
  const segment = { key: 'segment-key', sessionKey: 'hashed-session', projectId: 'project', host: 'codex',
    sessionId: 'raw-session', parentSessionId: 'raw-parent', topic: 'docs/work/private-client', skill: 'nectar-review',
    git: { worktree: '/private/client', branch: 'private-branch' }, usage: { total: 12 }, cost: { usd: null } };
  const html = renderBoard({ projects: [{ projectId: 'project', topics: [], sessions: [], segments: [segment] }] });
  const data = JSON.parse(html.match(/<script type="application\/json" id="board-data">([\s\S]*?)<\/script>/)[1]);
  const exported = data.projects[0].segments[0].publicExport;
  assert.equal(exported.sessionId, undefined); assert.equal(exported.parentSessionId, undefined);
  assert.equal(exported.topic, undefined); assert.equal(exported.git, undefined);
  assert.match(exported.topicKey, /^[a-f0-9]{64}$/); assert.equal(exported.skill, 'nectar-review');
});

test('Board exports do not overwrite existing files and JSON reads do not create stores', async t => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-board-cli-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const state = path.join(dir, 'state'); const output = path.join(dir, 'board.html');
  const json = JSON.parse(await runBoard(['--json', '--state-dir', state], { cwd: dir }));
  assert.equal(json.projects.length, 1); assert.equal(fs.existsSync(state), false);
  await runBoard(['--output', output, '--state-dir', state], { cwd: dir });
  const before = fs.readFileSync(output);
  await assert.rejects(() => runBoard(['--output', output, '--state-dir', state], { cwd: dir }), /EEXIST/);
  assert.deepEqual(fs.readFileSync(output), before);
});
