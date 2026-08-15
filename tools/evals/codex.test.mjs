import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createCodexEvalWorkspace, runCodexCase } from './codex.mjs';

function plugin(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'generic-codex-plugin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'internal-skills/code-audit'), { recursive: true });
  fs.writeFileSync(path.join(root, 'internal-skills/code-audit/SKILL.md'), '---\nname: code-audit\n---\nAudit safely.\n');
  return root;
}

const contract = {
  id: 'read-only-audit',
  skill: 'code-audit',
  prompt: 'Audit this repository.',
  fixture: { files: { 'src/app.js': 'export const ok = true;\n' } },
  checks: [
    { type: 'fixtureUnchanged' },
    { type: 'responseIncludes', value: 'Blocking: 0' },
  ],
  graderCriteria: ['Preserves source files.'],
};

test('materializes a Codex fixture with the selected public skill and cleans it', (t) => {
  const workspace = createCodexEvalWorkspace({ product: 'code-audit', contract, pluginRoot: plugin(t) });
  assert.match(workspace.prompt, /<plugin-skill product="code-audit" name="code-audit">/);
  assert.equal(fs.existsSync(path.join(workspace.root, 'src/app.js')), true);
  const temporaryRoot = workspace.temporaryRoot;
  workspace.cleanup();
  assert.equal(fs.existsSync(temporaryRoot), false);
});

test('grades Codex output and workspace checks into a normalized result', async (t) => {
  const result = await runCodexCase({
    product: 'code-audit',
    contract,
    pluginRoot: plugin(t),
    execute: async (_command, args) => {
      const outputPath = args[args.indexOf('--output-last-message') + 1];
      fs.writeFileSync(outputPath, 'Code defects: none\nBlocking: 0\n');
      return { status: 0, stdout: '', stderr: '', error: null };
    },
  });

  assert.equal(result.host, 'codex');
  assert.equal(result.status, 'passed');
  assert.equal(result.score, 1);
});

test('reports an unavailable Codex executable', async (t) => {
  const result = await runCodexCase({
    product: 'code-audit',
    contract,
    pluginRoot: plugin(t),
    execute: async () => {
      const error = new Error('spawn codex ENOENT');
      error.code = 'ENOENT';
      throw error;
    },
  });
  assert.equal(result.status, 'unavailable');
});
