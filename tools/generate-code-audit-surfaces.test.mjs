import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  generateCodeAuditSurfaces,
  renderAuditSurface,
} from './generate-code-audit-surfaces.mjs';

test('renders standalone and Nectar surfaces from one tokenized core', () => {
  const core = '## Core\nRole: {{ROLE_PREFIX}}; report: `{{DEFAULT_REPORT}}`; lens: `{{LENS_ROLE_PATH}}`.\n';
  const standalone = renderAuditSurface({
    preamble: '# Standalone\n',
    core,
    replacements: {
      ROLE_PREFIX: 'code-audit',
      DEFAULT_REPORT: 'code-audit-YYYY-MM-DD.md',
      LENS_ROLE_PATH: '../../agents/lens.md',
      VALIDATOR_ROLE_PATH: '../../agents/validator.md',
    },
  });
  const nectar = renderAuditSurface({
    preamble: '# Nectar context\n',
    core,
    suffix: '## Atlas\n',
    replacements: {
      ROLE_PREFIX: 'nectar',
      DEFAULT_REPORT: 'docs/work/audit-YYYY-MM-DD.md',
      LENS_ROLE_PATH: '../../agents/lens.md',
      VALIDATOR_ROLE_PATH: '../../agents/validator.md',
    },
  });

  assert.match(standalone, /code-audit-YYYY-MM-DD\.md/);
  assert.doesNotMatch(standalone, /Atlas|\{\{/);
  assert.match(nectar, /Nectar context/);
  assert.match(nectar, /## Atlas/);
  assert.match(nectar, /docs\/work\/audit-YYYY-MM-DD\.md/);
});

test('check mode reports generated-surface drift without writing', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'code-audit-surfaces-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = {
    core: path.join(root, 'core.md'),
    standalonePreamble: path.join(root, 'standalone.md'),
    nectarPreamble: path.join(root, 'nectar.md'),
    nectarSuffix: path.join(root, 'atlas.md'),
    standaloneDestination: path.join(root, 'out', 'code-audit.md'),
    nectarDestination: path.join(root, 'out', 'nectar-audit.md'),
  };
  fs.writeFileSync(files.core, 'Core {{ROLE_PREFIX}} {{DEFAULT_REPORT}} {{LENS_ROLE_PATH}} {{VALIDATOR_ROLE_PATH}}\n');
  fs.writeFileSync(files.standalonePreamble, 'Standalone\n');
  fs.writeFileSync(files.nectarPreamble, 'Nectar\n');
  fs.writeFileSync(files.nectarSuffix, 'Atlas\n');

  generateCodeAuditSurfaces({ paths: files });
  fs.writeFileSync(files.standaloneDestination, 'drift\n');
  const result = generateCodeAuditSurfaces({ paths: files, check: true });

  assert.deepEqual(result.mismatches, ['code-audit']);
  assert.equal(fs.readFileSync(files.standaloneDestination, 'utf8'), 'drift\n');
});

test('generation rejects symbolic-link destinations without changing their targets', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'code-audit-surfaces-symlink-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = {
    core: path.join(root, 'core.md'),
    standalonePreamble: path.join(root, 'standalone.md'),
    nectarPreamble: path.join(root, 'nectar.md'),
    nectarSuffix: path.join(root, 'atlas.md'),
    standaloneDestination: path.join(root, 'out', 'code-audit.md'),
    nectarDestination: path.join(root, 'out', 'nectar-audit.md'),
  };
  fs.writeFileSync(files.core, 'Core {{ROLE_PREFIX}} {{DEFAULT_REPORT}} {{LENS_ROLE_PATH}} {{VALIDATOR_ROLE_PATH}}\n');
  fs.writeFileSync(files.standalonePreamble, 'Standalone\n');
  fs.writeFileSync(files.nectarPreamble, 'Nectar\n');
  fs.writeFileSync(files.nectarSuffix, 'Atlas\n');
  fs.mkdirSync(path.dirname(files.standaloneDestination), { recursive: true });
  const victim = path.join(root, 'victim.md');
  fs.writeFileSync(victim, 'preserve me\n');
  fs.symlinkSync(victim, files.standaloneDestination);

  assert.throws(
    () => generateCodeAuditSurfaces({ paths: files }),
    /destination must not be a symbolic link/i,
  );
  assert.equal(fs.readFileSync(victim, 'utf8'), 'preserve me\n');
});

test('generation rejects symbolic-link destination ancestors', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'code-audit-surfaces-parent-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  const linkedParent = path.join(root, 'linked-out');
  fs.symlinkSync(outside, linkedParent);
  const files = {
    core: path.join(root, 'core.md'),
    standalonePreamble: path.join(root, 'standalone.md'),
    nectarPreamble: path.join(root, 'nectar.md'),
    nectarSuffix: path.join(root, 'atlas.md'),
    standaloneDestination: path.join(linkedParent, 'code-audit.md'),
    nectarDestination: path.join(root, 'normal', 'nectar-audit.md'),
  };
  fs.writeFileSync(files.core, 'Core {{ROLE_PREFIX}} {{DEFAULT_REPORT}} {{LENS_ROLE_PATH}} {{VALIDATOR_ROLE_PATH}}\n');
  fs.writeFileSync(files.standalonePreamble, 'Standalone\n');
  fs.writeFileSync(files.nectarPreamble, 'Nectar\n');
  fs.writeFileSync(files.nectarSuffix, 'Atlas\n');

  assert.throws(
    () => generateCodeAuditSurfaces({ paths: files }),
    /destination ancestor must not be a symbolic link/i,
  );
  assert.equal(fs.existsSync(path.join(outside, 'code-audit.md')), false);
});
