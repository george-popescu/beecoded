import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { listProductDefinitions } from './plugin-products.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');
const readJson = (relative) => JSON.parse(read(relative));

function filesBelow(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    return entry.isDirectory() ? filesBelow(absolute) : [absolute];
  });
}

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

test('current public sources contain no colon-style Bee or Nectar invocation', () => {
  const colon = ':';
  const products = listProductDefinitions().map(({ id }) => id).join('|');
  const legacy = new RegExp(`(?:/|\\$)(?:${products})${colon}`);
  const roots = [
    path.join(repoRoot, 'README.md'),
    ...listProductDefinitions().map(({ packageRoot }) => path.join(repoRoot, packageRoot)),
    path.join(repoRoot, 'tools'),
    path.join(repoRoot, '.claude-plugin'),
    path.join(repoRoot, '.agents'),
  ];
  const offenders = roots.flatMap((root) => (
    fs.statSync(root).isDirectory() ? filesBelow(root) : [root]
  ))
    .filter((file) => !file.endsWith('CHANGELOG.md'))
    .filter((file) => /\.(?:md|json|js|mjs|cjs|sh|ya?ml)$/i.test(file))
    .filter((file) => legacy.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(repoRoot, file))
    .sort();

  assert.deepEqual(offenders, []);
});

test('current documentation teaches standalone prefixed skills and managed source layout', () => {
  const rootReadme = read('README.md');
  assert.match(rootReadme, /\/bee-init/);
  assert.match(rootReadme, /\$bee-init/);
  assert.match(rootReadme, /\/nectar-shape/);
  assert.match(rootReadme, /\$nectar-shape/);
  assert.match(rootReadme, /internal-skills\//);
  assert.doesNotMatch(rootReadme, /The colon is intentional/);

  const beeReadme = read('plugins/bee/README.md');
  const nectarReadme = read('plugins/nectar/README.md');
  assert.match(beeReadme, /standalone/i);
  assert.match(beeReadme, /\/bee-init/);
  assert.match(beeReadme, /\$bee-init/);
  assert.match(beeReadme, /Reinstalling upgrades all/);
  assert.match(beeReadme, /uninstall/);
  assert.match(nectarReadme, /standalone/i);
  assert.match(nectarReadme, /\/nectar-shape/);
  assert.match(nectarReadme, /\$nectar-shape/);
  assert.match(nectarReadme, /Reinstalling upgrades only/);
  assert.match(nectarReadme, /uninstall/);
  assert.match(nectarReadme, /Only confirmed medium-or-higher code defects block convergence/i);
  assert.match(nectarReadme, /default maximum of three full review passes/i);
});

test('installed-command smoke is read-only, environment-scrubbed, and cleans credentials on signals', () => {
  const smoke = read('tools/test-installed-commands.mjs');
  assert.doesNotMatch(smoke, /env:\s*process\.env/);
  assert.doesNotMatch(smoke, /allowedTools['",\s]+Read,Glob,Grep,Bash['"]/);
  assert.match(smoke, /Bash\(git log \*\)/);
  assert.match(smoke, /Bash\(git status \*\)/);
  assert.match(smoke, /ENVIRONMENT_ALLOWLIST/);
  assert.match(smoke, /stopOnSignal\('SIGINT', 130\)/);
  assert.match(smoke, /stopOnSignal\('SIGTERM', 143\)/);
  assert.match(smoke, /process\.once\('exit', cleanup\)/);
  assert.match(smoke, /'-s',\s*'read-only'/);
  assert.doesNotMatch(smoke, /'--add-dir',\s*codexHome/);
  assert.match(smoke, /'pack',\s*'--workspace'/);
  assert.match(smoke, /'install',\s*'--global'/);
  assert.match(smoke, /run\(product, \['--all'\]/);
  assert.doesNotMatch(smoke, /plugins['"], product, ['"]bin/);
});

test('Atlas release smoke uses isolated homes and never invokes a model', () => {
  const smoke = read('tools/test-atlas-release.mjs');
  assert.match(smoke, /ENVIRONMENT_ALLOWLIST/);
  assert.match(smoke, /CODEX_HOME/);
  assert.match(smoke, /CLAUDE_CONFIG_DIR/);
  assert.match(smoke, /BEECODED_HOME/);
  assert.match(smoke, /'pack'/);
  assert.match(smoke, /'install',\s*'--global'/);
  assert.match(smoke, /'atlas',\s*'enable'/);
  assert.match(smoke, /'atlas',\s*'refresh'/);
  assert.match(smoke, /'uninstall',\s*'--all'/);
  assert.doesNotMatch(smoke, /codex['"], \['exec'/);
  assert.doesNotMatch(smoke, /claude['"], \['-p'/);
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
