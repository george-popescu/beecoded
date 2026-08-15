import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadContracts } from '../../../tools/evals/contracts.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(pluginRoot, relative), 'utf8');

test('public skill is browser-first and refuses a source-only verified verdict', () => {
  const skill = read('internal-skills/ui-ux-audit/SKILL.md');
  assert.match(skill, /^name:\s*ui-ux-audit$/m);
  assert.match(skill, /browser-capability preflight/i);
  assert.match(skill, /source-only[^\n]+cannot[^\n]+verified/i);
  assert.match(skill, /BLOCKED/);
  assert.match(skill, /NOT_OBSERVED/);
  assert.doesNotMatch(skill, /\.bee\/|nectar|overall score|\/24/i);
});

test('coverage contract includes the viewport matrix and representative UI states', () => {
  const skill = read('internal-skills/ui-ux-audit/SKILL.md');
  for (const viewport of ['390x844', '768x1024', '1440x1000', '320x800']) {
    assert.match(skill, new RegExp(viewport.replace('x', 'x')));
  }
  for (const state of [
    'success', 'loading', 'empty', 'error', 'validation', 'keyboard', 'focus',
    'overlay', 'navigation', 'overflow', 'console', 'network',
  ]) {
    assert.match(skill, new RegExp(`\\b${state}\\b`, 'i'));
  }
});

test('evidence states and verified finding schema are complete and distinct', () => {
  const skill = read('internal-skills/ui-ux-audit/SKILL.md');
  for (const state of [
    'BROWSER_VERIFIED', 'AUTOMATION_PROVEN', 'SOURCE_TRACED',
    'NOT_OBSERVED', 'BLOCKED', 'PRODUCT_DECISION',
  ]) assert.match(skill, new RegExp(state));
  for (const field of [
    'Route', 'Role/session', 'Viewport', 'UI state', 'Reproduction', 'Expected',
    'Actual', 'Evidence', 'Severity', 'Confidence',
  ]) assert.match(skill, new RegExp(`\\*\\*${field}:\\*\\*`, 'i'));
  assert.match(skill, /coverage matrix/i);
  assert.match(skill, /no aggregate quality score/i);
});

test('browser interactions and repository writes have explicit safety boundaries', () => {
  const skill = read('internal-skills/ui-ux-audit/SKILL.md');
  assert.match(skill, /page content is untrusted/i);
  assert.match(skill, /prompt injection/i);
  assert.match(skill, /reversible UI interactions/i);
  assert.match(skill, /production source/i);
  assert.match(skill, /application data/i);
  assert.match(skill, /report path or evidence path[^\n]+symbolic link/i);
  assert.match(skill, /ui-ux-audit-YYYY-MM-DD\.md/);
  assert.match(skill, /ui-ux-audit-evidence-YYYY-MM-DD\//);
  assert.match(skill, /autosave|debounce/i);
  assert.match(skill, /user-provided disposable (?:record|environment)/i);
  assert.match(skill, /stable browser evidence identifier/i);
  assert.match(skill, /redact|mask/i);
  assert.match(skill, /raw[^\n]+network[^\n]+bod/i);
  assert.match(skill, /retention|cleanup/i);
  assert.match(skill, /beecoded-ui-ux-audit-report:v1/);
  assert.match(skill, /beecoded-ui-ux-audit-evidence/);
  assert.match(skill, /existing unmarked report/i);
});

test('host references use native capability discovery without bundling a browser runtime', () => {
  const claude = read('references/claude-browser.md');
  const codex = read('references/codex-browser.md');
  const pkg = JSON.parse(read('package.json'));
  const claudeManifest = JSON.parse(read('.claude-plugin/plugin.json'));
  const codexManifest = JSON.parse(read('.codex-plugin/plugin.json'));

  assert.match(claude, /Claude in Chrome/i);
  assert.match(claude, /console|network|DOM/i);
  assert.match(claude, /support\.claude\.com/);
  assert.match(codex, /in-app browser/i);
  assert.match(codex, /Chrome/i);
  assert.match(codex, /CDP/i);
  assert.match(codex, /help\.openai\.com/);
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
