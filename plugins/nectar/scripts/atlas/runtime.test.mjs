import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(currentDirectory, '../..');
const repositoryRoot = path.resolve(pluginRoot, '../..');

const APPROVED_EXTERNAL_PACKAGES = [
  'node_modules/@babel/helper-string-parser',
  'node_modules/@babel/helper-validator-identifier',
  'node_modules/@babel/parser',
  'node_modules/@babel/types',
  'node_modules/php-parser',
];
const ENGINE_RANGE = '^22.18.0 || >=24.11.0';
const PARSER_DEPENDENCIES = {
  '@babel/parser': '^8.0.4',
  'php-parser': '^3.7.0',
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('accepts every Atlas Node boundary promised by the package engine contract', async () => {
  const {
    assertAtlasRuntime,
    isAtlasNodeVersionSupported,
  } = await import('./runtime.mjs');

  for (const version of ['22.18.0', '22.99.99', '24.11.0', '25.0.0']) {
    assert.equal(isAtlasNodeVersionSupported(version), true, version);
    assert.equal(assertAtlasRuntime(version), version);
  }
});

test('rejects Node releases outside the disjoint Atlas engine ranges', async () => {
  const {
    assertAtlasRuntime,
    isAtlasNodeVersionSupported,
  } = await import('./runtime.mjs');

  for (const version of [
    '22.17.99',
    '23.0.0',
    '24.10.99',
    '24.11.0-rc.1',
    'not-a-version',
  ]) {
    assert.equal(isAtlasNodeVersionSupported(version), false, version);
    assert.throws(
      () => assertAtlasRuntime(version),
      {
        message: `Nectar Atlas requires Node ${ENGINE_RANGE}; received ${version}`,
      },
    );
  }
});

test('package, guard, and lock contain only the approved pure-JavaScript parser trees', async () => {
  const { ATLAS_NODE_ENGINE_RANGE } = await import('./runtime.mjs');
  const packageJson = readJson(path.join(pluginRoot, 'package.json'));
  const lock = readJson(path.join(repositoryRoot, 'package-lock.json'));
  const lockedPlugin = lock.packages['plugins/nectar'];
  const lockedExternalPackages = Object.keys(lock.packages)
    .filter((entry) => entry.startsWith('node_modules/') && !lock.packages[entry].link)
    .sort();

  assert.equal(packageJson.version, '3.0.2');
  assert.equal(ATLAS_NODE_ENGINE_RANGE, ENGINE_RANGE);
  assert.equal(packageJson.engines.node, ENGINE_RANGE);
  assert.deepEqual(packageJson.dependencies, PARSER_DEPENDENCIES);
  assert.equal(lockedPlugin.version, packageJson.version);
  assert.equal(lockedPlugin.engines.node, ENGINE_RANGE);
  assert.deepEqual(lockedPlugin.dependencies, PARSER_DEPENDENCIES);
  assert.deepEqual(lockedExternalPackages, APPROVED_EXTERNAL_PACKAGES);

  for (const packagePath of lockedExternalPackages) {
    assert.notEqual(lock.packages[packagePath].hasInstallScript, true, packagePath);
  }
});

test('the active runtime loads built-in SQLite and both parser entry points', async () => {
  const [
    sqlite,
    babelParser,
    phpParserModule,
  ] = await Promise.all([
    import('node:sqlite'),
    import('@babel/parser'),
    import('php-parser'),
  ]);

  assert.equal(typeof sqlite.DatabaseSync, 'function');
  assert.equal(typeof babelParser.parse, 'function');
  assert.equal(typeof phpParserModule.default, 'function');
});
