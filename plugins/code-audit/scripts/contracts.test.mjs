import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadContracts } from '../../../tools/evals/contracts.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (root, relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('product-local audit agents expose only read-only tools', () => {
  for (const file of ['agents/lens.md', 'agents/validator.md']) {
    const agent = read(pluginRoot, file);
    const frontmatter = agent.match(/^---\n([\s\S]*?)\n---/)?.[1];
    assert.ok(frontmatter, file);
    assert.match(frontmatter, /^tools:\s*Read, Grep, Glob$/m, file);
    assert.doesNotMatch(frontmatter, /\b(?:Write|Edit|Bash)\b/, file);
  }
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
