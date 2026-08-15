import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  defineProductRegistry,
  getProductDefinition,
  listProductDefinitions,
} from './plugin-products.mjs';
import { runAllPackagePack, runAllPackageValidation } from './validate-all-packages.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function skillsOnly(id, publicSkills = [id]) {
  return {
    id,
    kind: 'skills-only',
    packageName: `@beecoded/${id}`,
    packageRoot: `plugins/${id}`,
    publicSkills,
    reservedSkillPrefixes: [],
    managedInstaller: true,
    evalContracts: `plugins/${id}/evals/contracts`,
  };
}

test('ships declarative Bee, Nectar, Code Audit, and UI/UX Audit product definitions', () => {
  assert.deepEqual(listProductDefinitions().map(({ id }) => id), ['bee', 'nectar', 'code-audit', 'ui-ux-audit']);
  assert.equal(getProductDefinition('bee').packageName, '@beecoded/bee');
  assert.equal(getProductDefinition('nectar').packageRoot, 'plugins/nectar');
  assert.deepEqual(getProductDefinition('code-audit'), {
    id: 'code-audit',
    kind: 'skills-only',
    packageName: '@beecoded/code-audit',
    packageRoot: 'plugins/code-audit',
    publicSkills: ['code-audit'],
    reservedSkillPrefixes: [],
    managedInstaller: true,
    evalContracts: 'plugins/code-audit/evals/contracts',
  });
  assert.deepEqual(getProductDefinition('ui-ux-audit'), {
    id: 'ui-ux-audit',
    kind: 'skills-only',
    packageName: '@beecoded/ui-ux-audit',
    packageRoot: 'plugins/ui-ux-audit',
    publicSkills: ['ui-ux-audit'],
    reservedSkillPrefixes: [],
    managedInstaller: true,
    evalContracts: 'plugins/ui-ux-audit/evals/contracts',
  });
});

test('registers both standalone audit products once in the root workspace and host marketplaces', () => {
  const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(repoRoot, relative), 'utf8'));
  const rootManifest = readJson('package.json');
  const claude = readJson('.claude-plugin/marketplace.json');
  const codex = readJson('.agents/plugins/marketplace.json');

  for (const product of ['code-audit', 'ui-ux-audit']) {
    assert.equal(rootManifest.workspaces.filter((entry) => entry === `plugins/${product}`).length, 1);
    for (const marketplace of [claude, codex]) {
      const entries = marketplace.plugins.filter(({ name }) => name === product);
      assert.equal(entries.length, 1);
      assert.equal(entries[0].source.package, `@beecoded/${product}`);
      assert.equal(entries[0].source.version, '0.1.0');
    }
  }
});

test('rejects unknown products with a stable diagnostic', () => {
  assert.throws(() => getProductDefinition('unknown'), /Unknown plugin product: unknown/);
});

test('accepts a valid standalone skills-only product declaration', () => {
  const registry = defineProductRegistry([skillsOnly('code-audit')]);
  assert.equal(registry.get('code-audit').publicSkills[0], 'code-audit');
});

test('rejects invalid standalone skills-only declarations', () => {
  assert.throws(
    () => defineProductRegistry([{
      ...skillsOnly('code-audit'),
      packageName: '@elsewhere/code-audit',
    }]),
    /packageName must be @beecoded\/code-audit/,
  );
  assert.throws(
    () => defineProductRegistry([{ ...skillsOnly('code-audit'), publicSkills: [] }]),
    /publicSkills must contain at least one skill/,
  );
});

test('rejects duplicate public skill ownership', () => {
  assert.throws(
    () => defineProductRegistry([
      skillsOnly('code-audit'),
      skillsOnly('audit-suite', ['code-audit']),
    ]),
    /public skill code-audit is owned by both code-audit and audit-suite/,
  );
});

test('rejects explicit skills that collide with another product reserved prefix', () => {
  assert.throws(
    () => defineProductRegistry([
      {
        ...skillsOnly('bee'),
        kind: 'bee',
        publicSkills: [],
        reservedSkillPrefixes: ['bee-'],
        evalContracts: null,
      },
      skillsOnly('workflow', ['bee-init']),
    ]),
    /public skill bee-init collides with bee reserved prefix bee-/,
  );
});

test('registry-wide validation invokes every declared product exactly once', () => {
  const invocations = [];
  const exitCode = runAllPackageValidation({
    execute(command, args) {
      invocations.push([command, ...args]);
      return { status: 0 };
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(invocations.map((invocation) => invocation.at(-1)), ['bee', 'nectar', 'code-audit', 'ui-ux-audit']);
});

test('package validator reports an unknown registry product', () => {
  const result = spawnSync(process.execPath, ['tools/validate-package.mjs', 'unknown'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown plugin product: unknown/);
});

test('registry-wide pack dry-run invokes every declared workspace', () => {
  const invocations = [];
  const exitCode = runAllPackagePack({
    execute(command, args) {
      invocations.push([command, ...args]);
      return { status: 0 };
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(invocations.map((invocation) => invocation.slice(-3)), [
    ['@beecoded/bee', '--dry-run', '--json'],
    ['@beecoded/nectar', '--dry-run', '--json'],
    ['@beecoded/code-audit', '--dry-run', '--json'],
    ['@beecoded/ui-ux-audit', '--dry-run', '--json'],
  ]);
});
