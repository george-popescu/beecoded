import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadContracts } from '../../../tools/evals/contracts.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(pluginRoot, relative), 'utf8');

test('package ships no bundled browser runtime or MCP server', () => {
  const pkg = JSON.parse(read('package.json'));
  const claudeManifest = JSON.parse(read('.claude-plugin/plugin.json'));
  const codexManifest = JSON.parse(read('.codex-plugin/plugin.json'));

  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.optionalDependencies, undefined);
  assert.equal(claudeManifest.mcpServers, undefined);
  assert.equal(codexManifest.mcpServers, undefined);
  assert.equal(fs.existsSync(path.join(pluginRoot, 'mcp')), false);
});

test('ships the complete browser-bound behavioral contract roster', () => {
  const contracts = loadContracts(path.join(pluginRoot, 'evals/contracts'), {
    allowedSkills: ['ui-ux-audit'],
  });
  assert.deepEqual(contracts.map(({ id }) => id), [
    'activation-boundary',
    'browser-unavailable',
    'evidence-state-separation',
    'report-boundary',
    'source-only-non-verdict',
  ]);
  for (const contract of contracts.filter(({ id }) => ['browser-unavailable', 'report-boundary', 'source-only-non-verdict'].includes(id))) {
    assert.ok(contract.checks.some(({ type }) => type === 'workspaceChangesOnly'));
    assert.ok(contract.checks.some(({ type, path: report }) => (
      type === 'pathExists' && report === 'ui-ux-audit-report.md'
    )));
  }
});
