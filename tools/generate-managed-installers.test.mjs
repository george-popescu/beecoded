import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { generateManagedInstallers } from './generate-managed-installers.mjs';

const definitions = [
  { id: 'alpha', packageRoot: 'plugins/alpha', managedInstaller: true },
  { id: 'beta', packageRoot: 'plugins/beta', managedInstaller: true },
];

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-installer-generator-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const template = path.join(root, 'template.mjs');
  fs.writeFileSync(template, '#!/usr/bin/env node\nconsole.log("managed");\n');
  for (const definition of definitions) {
    fs.mkdirSync(path.join(root, definition.packageRoot, 'bin'), { recursive: true });
  }
  return { root, template };
}

test('generates one executable standalone installer per managed product', (t) => {
  const { root, template } = fixture(t);
  const result = generateManagedInstallers({ repoRoot: root, template, definitions });

  assert.deepEqual(result.updated, ['alpha', 'beta']);
  for (const definition of definitions) {
    const destination = path.join(root, definition.packageRoot, 'bin', 'install.mjs');
    assert.equal(fs.readFileSync(destination, 'utf8'), fs.readFileSync(template, 'utf8'));
    assert.notEqual(fs.statSync(destination).mode & 0o111, 0);
  }
});

test('check mode reports drift without modifying the shipped installer', (t) => {
  const { root, template } = fixture(t);
  generateManagedInstallers({ repoRoot: root, template, definitions });
  const destination = path.join(root, 'plugins/alpha/bin/install.mjs');
  fs.writeFileSync(destination, '#!/usr/bin/env node\nconsole.log("drift");\n');

  const result = generateManagedInstallers({
    repoRoot: root,
    template,
    definitions,
    check: true,
  });

  assert.deepEqual(result.mismatches, ['alpha']);
  assert.match(fs.readFileSync(destination, 'utf8'), /drift/);
});

test('skips registry products that do not use the managed installer', (t) => {
  const { root, template } = fixture(t);
  const result = generateManagedInstallers({
    repoRoot: root,
    template,
    definitions: [{ ...definitions[0], managedInstaller: false }],
  });

  assert.deepEqual(result.updated, []);
  assert.equal(fs.existsSync(path.join(root, 'plugins/alpha/bin/install.mjs')), false);
});
