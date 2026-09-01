import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { listProductDefinitions } from './plugin-products.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');
const readJson = (relative) => JSON.parse(read(relative));

test('breaking package and marketplace versions are synchronized', () => {
  const claudeMarketplace = readJson('.claude-plugin/marketplace.json');
  const codexMarketplace = readJson('.agents/plugins/marketplace.json');
  const lock = readJson('package-lock.json');

  for (const definition of listProductDefinitions()) {
    const { id: product, packageRoot } = definition;
    const packageManifest = readJson(`${packageRoot}/package.json`);
    const { version } = packageManifest;
    assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    assert.match(packageManifest.scripts.prepack, /npm test/);
    assert.match(packageManifest.scripts.prepack, /npm run validate/);
    assert.equal(readJson(`${packageRoot}/.claude-plugin/plugin.json`).version, version);
    assert.equal(readJson(`${packageRoot}/.codex-plugin/plugin.json`).version, version);
    assert.equal(
      claudeMarketplace.plugins.find((entry) => entry.name === product).source.version,
      version,
    );
    assert.equal(
      codexMarketplace.plugins.find((entry) => entry.name === product).source.version,
      version,
    );
    assert.equal(lock.packages[packageRoot].version, version);
  }
});

test('root contributor commands enforce registry, generated installer, eval, and pack gates', () => {
  const manifest = readJson('package.json');
  assert.match(manifest.scripts['check:generated'], /generate-managed-installers\.mjs --check/);
  assert.match(manifest.scripts.validate, /validate-all-packages\.mjs/);
  assert.match(manifest.scripts.validate, /tools\/evals\/\*\.test\.mjs/);
  assert.equal(manifest.scripts['eval:plugins'], 'node tools/run-plugin-evals.mjs');
  assert.equal(manifest.scripts['pack:check'], 'node tools/validate-all-packages.mjs --pack');
  assert.equal(manifest.scripts.install, undefined);
  assert.equal(manifest.scripts.postinstall, undefined);
  assert.equal(manifest.scripts.prepare, undefined);
});
