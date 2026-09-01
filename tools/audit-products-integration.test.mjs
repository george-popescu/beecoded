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

});
