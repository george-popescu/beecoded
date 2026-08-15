import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createClaudeEvalWorkspace, runClaudeCase } from './claude.mjs';

function plugin(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'generic-claude-plugin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'internal-skills/code-audit'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-plugin/plugin.json'), '{"name":"code-audit","version":"0.1.0"}\n');
  fs.writeFileSync(path.join(root, 'internal-skills/code-audit/SKILL.md'), '---\nname: code-audit\n---\nAudit safely.\n');
  return root;
}

const contract = {
  id: 'read-only-audit',
  skill: 'code-audit',
  prompt: 'Audit this repository.',
  fixture: { files: { 'src/app.js': 'export const ok = true;\n' } },
  checks: [{ type: 'fixtureUnchanged' }],
  graderCriteria: ['Preserves source files.'],
};

test('materializes a native Claude plugin eval and cleans its bounded workspace', (t) => {
  const pluginRoot = plugin(t);
  const workspace = createClaudeEvalWorkspace({ product: 'code-audit', contract, pluginRoot });
  assert.match(fs.readFileSync(workspace.promptPath, 'utf8'), /Code Audit behavioral case/);
  assert.equal(fs.existsSync(path.join(workspace.pluginRoot, 'skills/code-audit/SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(workspace.fixtureRoot, 'src/app.js')), true);
  const temporaryRoot = workspace.root;
  workspace.cleanup();
  assert.equal(fs.existsSync(temporaryRoot), false);
});

test('normalizes a passing Claude native-eval result', async (t) => {
  const result = await runClaudeCase({
    product: 'code-audit',
    contract,
    pluginRoot: plugin(t),
    execute: async () => ({
      status: 0,
      stdout: JSON.stringify({ cases: [{ id: contract.id, score: 1, evidence: ['all criteria passed'] }] }),
      stderr: '',
      error: null,
    }),
  });

  assert.equal(result.product, 'code-audit');
  assert.equal(result.host, 'claude');
  assert.equal(result.status, 'passed');
  assert.equal(result.score, 1);
});

test('reports an unavailable Claude executable without leaking the temporary workspace', async (t) => {
  const result = await runClaudeCase({
    product: 'code-audit',
    contract,
    pluginRoot: plugin(t),
    execute: async () => {
      const error = new Error('spawn claude ENOENT');
      error.code = 'ENOENT';
      throw error;
    },
  });
  assert.equal(result.status, 'unavailable');
  assert.match(result.evidence[0], /ENOENT/);
});
