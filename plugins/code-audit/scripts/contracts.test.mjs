import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadContracts } from '../../../tools/evals/contracts.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(pluginRoot, '../..');
const read = (root, relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('standalone audit is state-independent and report-only', () => {
  const skill = read(pluginRoot, 'internal-skills/code-audit/SKILL.md');
  assert.match(skill, /^name:\s*code-audit$/m);
  assert.match(skill, /code-audit-YYYY-MM-DD\.md/);
  assert.match(skill, /report is the only write/i);
  assert.doesNotMatch(skill, /run-context|nectar atlas|\.bee\/|docs\/work\//i);
  assert.match(skill, /CODE_DEFECT/);
  assert.match(skill, /Clean audit means zero blocking code defects/i);
  assert.match(skill, /report path or any existing ancestor is a symbolic link/i);
  assert.match(skill, /stop without writing/i);
  assert.doesNotMatch(skill, /resulting artifact must be disclosed/i);
});

test('Nectar compatibility surface retains context and Atlas around the canonical core', () => {
  const core = read(pluginRoot, 'methodology/audit-core.md').trim();
  const standalone = read(pluginRoot, 'internal-skills/code-audit/SKILL.md');
  const nectar = read(repoRoot, 'plugins/nectar/internal-skills/nectar-audit/SKILL.md');
  assert.match(nectar, /run-context\.mjs/);
  assert.match(nectar, /nectar atlas status/);
  assert.equal(standalone.includes(core), false, 'rendered standalone replaces core tokens');
  assert.match(standalone, /## Finding classes/);
  assert.match(nectar, /## Finding classes/);
  assert.doesNotMatch(standalone + nectar, /\{\{[A-Z_]+\}\}/);
});

test('product-local audit agents are read-only finding and validation roles', () => {
  for (const file of ['agents/lens.md', 'agents/validator.md']) {
    const agent = read(pluginRoot, file);
    assert.match(agent, /^tools:\s*Read, Grep, Glob$/m);
    assert.doesNotMatch(agent, /\b(?:Write|Edit|Bash)\b/);
  }
  assert.match(read(pluginRoot, 'agents/lens.md'), /never edits/i);
  assert.match(read(pluginRoot, 'agents/validator.md'), /actively try to refute/i);
});

test('ships the complete product behavioral contract roster', () => {
  const contracts = loadContracts(path.join(pluginRoot, 'evals/contracts'), {
    allowedSkills: ['code-audit'],
  });
  assert.deepEqual(contracts.map(({ id }) => id), [
    'activation-boundary',
    'non-code-clean-audit',
    'reachable-code-defect',
    'report-only-mutation',
  ]);
  for (const contract of contracts.filter(({ id }) => id !== 'activation-boundary')) {
    assert.ok(contract.checks.some(({ type }) => type === 'workspaceChangesOnly'));
    assert.ok(contract.checks.some(({ type, path: report }) => (
      type === 'pathExists' && report === 'code-audit-report.md'
    )));
  }
});
