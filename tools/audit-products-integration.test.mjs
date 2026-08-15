import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { renderAuditSurface } from './generate-code-audit-surfaces.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

test('Code Audit and Nectar Audit are exact surfaces of one canonical risk methodology', () => {
  const core = read('plugins/code-audit/methodology/audit-core.md');
  const standalonePreamble = read('tools/templates/code-audit-standalone-preamble.md');
  const nectarPreamble = read('tools/templates/nectar-audit-preamble.md');
  const nectarSuffix = read('tools/templates/nectar-audit-atlas.md');
  const standalone = read('plugins/code-audit/internal-skills/code-audit/SKILL.md');
  const nectar = read('plugins/nectar/internal-skills/nectar-audit/SKILL.md');

  assert.equal(standalone, renderAuditSurface({
    preamble: standalonePreamble,
    core,
    replacements: {
      ROLE_PREFIX: 'code-audit',
      DEFAULT_REPORT: 'code-audit-YYYY-MM-DD.md',
      LENS_ROLE_PATH: '../../agents/lens.md',
      VALIDATOR_ROLE_PATH: '../../agents/validator.md',
    },
  }));
  assert.equal(nectar, renderAuditSurface({
    preamble: nectarPreamble,
    core,
    suffix: nectarSuffix,
    replacements: {
      ROLE_PREFIX: 'nectar',
      DEFAULT_REPORT: 'docs/work/audit-YYYY-MM-DD.md',
      LENS_ROLE_PATH: '../../agents/lens.md',
      VALIDATOR_ROLE_PATH: '../../agents/validator.md',
    },
  }));

  for (const invariant of [
    '## Finding classes',
    '## Severity scale',
    '## Deduplication and adversarial validation',
    'CODE_DEFECT',
    'TEST_OR_COVERAGE_GAP',
    'CONFIRMED',
    'REFUTED',
    'BLOCKING',
    'NON_BLOCKING',
  ]) {
    assert.ok(core.includes(invariant), `canonical methodology must define ${invariant}`);
    assert.ok(standalone.includes(invariant), `Code Audit must retain ${invariant}`);
    assert.ok(nectar.includes(invariant), `Nectar Audit must retain ${invariant}`);
  }

  assert.match(standalonePreamble, /without requiring Bee, Nectar, or project initialization/i);
  assert.doesNotMatch(standalonePreamble, /run-context\.mjs/);
  assert.match(nectarPreamble, /run-context\.mjs/);
});

test('release documentation covers both audit products and their safety boundaries', () => {
  const root = read('README.md');
  const code = read('plugins/code-audit/README.md');
  const ui = read('plugins/ui-ux-audit/README.md');

  for (const product of ['code-audit', 'ui-ux-audit']) {
    assert.match(root, new RegExp(`npx @beecoded/${product}@latest`));
    assert.match(root, new RegExp(`${product} uninstall --all`));
    assert.match(root, new RegExp(`${product} --all --allow-downgrade`));
  }
  assert.match(root, /BROWSER_VERIFIED/);
  assert.match(root, /ui-ux-audit-evidence-YYYY-MM-DD/);
  assert.match(root, /never auto-fix/i);

  for (const documentation of [code, ui]) {
    assert.match(documentation, /--allow-downgrade/);
    assert.match(documentation, /uninstall --all/);
    assert.match(documentation, /never (?:applies|auto-fixes)/i);
  }
  assert.match(code, /code-audit-YYYY-MM-DD\.md/);
  assert.match(ui, /ui-ux-audit-YYYY-MM-DD\.md/);
  assert.match(ui, /ui-ux-audit-evidence-YYYY-MM-DD/);
  for (const state of [
    'BROWSER_VERIFIED',
    'AUTOMATION_PROVEN',
    'SOURCE_TRACED',
    'NOT_OBSERVED',
    'BLOCKED',
    'PRODUCT_DECISION',
  ]) assert.ok(ui.includes(state), `UI/UX Audit documentation must define ${state}`);
});
