#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { listProductDefinitions } from './plugin-products.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoots = [];

const hostStub = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const host = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const stateDirectory = process.env.STUB_STATE_DIR;
const stateFile = path.join(stateDirectory, host + '.json');
const logFile = path.join(stateDirectory, host + '.log');
fs.mkdirSync(stateDirectory, { recursive: true });
fs.appendFileSync(logFile, JSON.stringify(args) + '\\n');

const state = fs.existsSync(stateFile)
  ? JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  : { marketplaces: [], plugins: [] };
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\\n');
const json = (value) => console.log(JSON.stringify(value));

if (args[0] === '--version') {
  console.log(host + '-stub 1.0.0');
  process.exit(0);
}

if (args[0] !== 'plugin') {
  console.error('Unsupported stub command: ' + args.join(' '));
  process.exit(2);
}

if (args[1] === 'marketplace' && args[2] === 'list') {
  if (process.env.STUB_FAIL_MARKETPLACE_LIST === host) {
    console.error('simulated marketplace-list failure');
    process.exit(1);
  }
  if (host === 'claude') {
    json(state.marketplaces.map((entry) => ({
      name: entry.name,
      source: 'directory',
      path: entry.root,
      installLocation: entry.root,
    })));
  } else {
    json({ marketplaces: state.marketplaces.map((entry) => ({
      name: entry.name,
      root: entry.root,
      marketplaceSource: { sourceType: 'local', source: entry.root },
    })) });
  }
  process.exit(0);
}

if (args[1] === 'marketplace' && args[2] === 'add') {
  const source = host === 'claude' ? args.at(-1) : args[3];
  const catalog = host === 'claude'
    ? path.join(source, '.claude-plugin', 'marketplace.json')
    : path.join(source, '.agents', 'plugins', 'marketplace.json');
  const name = JSON.parse(fs.readFileSync(catalog, 'utf8')).name;
  const root = fs.realpathSync(source);
  if (!state.marketplaces.some((entry) => entry.name === name)) {
    state.marketplaces.push({ name, root });
  }
  save();
  if (host === 'codex') json({ marketplaceName: name, installedRoot: root, alreadyAdded: false });
  else console.log('added ' + name);
  process.exit(0);
}

if (args[1] === 'marketplace' && args[2] === 'update') {
  process.exit(0);
}

if (args[1] === 'marketplace' && args[2] === 'remove') {
  state.marketplaces = state.marketplaces.filter((entry) => entry.name !== args[3]);
  save();
  if (host === 'codex') json({ removed: args[3] });
  process.exit(0);
}

if (args[1] === 'list') {
  if (process.env.STUB_FAIL_PLUGIN_LIST === host) {
    console.error('simulated plugin-list failure');
    process.exit(1);
  }
  if (host === 'claude') {
    json(state.plugins.map((entry) => ({ id: entry.selector, version: entry.version, scope: 'user' })));
  } else {
    json({
      installed: state.plugins.map((entry) => ({
        pluginId: entry.selector,
        name: entry.product,
        marketplaceName: entry.marketplace,
        version: entry.version,
        installed: true,
      })),
      available: [],
    });
  }
  process.exit(0);
}

const isInstall = (host === 'claude' && (args[1] === 'install' || args[1] === 'update'))
  || (host === 'codex' && args[1] === 'add');
if (isInstall) {
  const selector = args[2];
  const separator = selector.lastIndexOf('@');
  const product = selector.slice(0, separator);
  const marketplace = selector.slice(separator + 1);
  const failOnceMarker = path.join(stateDirectory, host + '.plugin-add-failed-once');
  if (process.env.STUB_FAIL_PLUGIN_ADD_ONCE === host && !fs.existsSync(failOnceMarker)) {
    fs.writeFileSync(failOnceMarker, 'failed\\n');
    console.error('simulated plugin-add failure');
    process.exit(1);
  }
  const root = state.marketplaces.find((entry) => entry.name === marketplace)?.root;
  if (!root) {
    console.error('marketplace not registered: ' + marketplace);
    process.exit(1);
  }
  const version = JSON.parse(fs.readFileSync(path.join(root, 'plugins', product, 'package.json'), 'utf8')).version;
  state.plugins = state.plugins.filter((entry) => entry.selector !== selector);
  state.plugins.push({ selector, product, marketplace, version });
  save();
  if (process.env.STUB_CREATE_SKILL_COLLISION_AFTER_ADD === host) {
    const configRoot = host === 'claude' ? process.env.CLAUDE_CONFIG_DIR : process.env.CODEX_HOME;
    const skill = path.join(configRoot, 'skills', product);
    if (!fs.existsSync(skill)) {
      fs.mkdirSync(skill, { recursive: true });
      fs.writeFileSync(path.join(skill, 'SKILL.md'), '# Unowned collision\\n');
    }
  }
  if (host === 'codex') json({ pluginId: selector, version });
  process.exit(0);
}

const isRemove = (host === 'claude' && args[1] === 'uninstall')
  || (host === 'codex' && args[1] === 'remove');
if (isRemove) {
  state.plugins = state.plugins.filter((entry) => entry.selector !== args[2]);
  save();
  if (host === 'codex') json({ removed: args[2] });
  process.exit(0);
}

console.error('Unsupported stub command: ' + args.join(' '));
process.exit(2);
`;

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'beecoded-installer-test-'));
  temporaryRoots.push(root);
  const binDirectory = path.join(root, 'bin');
  const stateDirectory = path.join(root, 'state');
  fs.mkdirSync(binDirectory, { recursive: true });

  for (const host of ['claude', 'codex']) {
    const executable = path.join(binDirectory, host);
    fs.writeFileSync(executable, hostStub, { mode: 0o755 });
  }

  return {
    root,
    stateDirectory,
    managedHome: path.join(root, 'beecoded'),
    env: {
      ...process.env,
      HOME: path.join(root, 'home'),
      XDG_CONFIG_HOME: path.join(root, 'xdg'),
      PATH: `${binDirectory}${path.delimiter}${path.dirname(process.execPath)}`,
      STUB_STATE_DIR: stateDirectory,
      BEECODED_HOME: path.join(root, 'beecoded'),
      CLAUDE_CONFIG_DIR: path.join(root, 'claude'),
      CODEX_HOME: path.join(root, 'codex'),
    },
  };
}

function run(product, fixture, args = []) {
  const installer = path.join(repoRoot, 'plugins', product, 'bin', 'install.mjs');
  const result = runInstallerPath(installer, fixture, args);
  assert.equal(result.status, 0, `${product} ${args.join(' ')} failed:\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

function runInstallerPath(installer, fixture, args = []) {
  const result = spawnSync(process.execPath, [installer, ...args], {
    cwd: repoRoot,
    env: fixture.env,
    encoding: 'utf8',
  });
  return result;
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function packageCopy(product, version, { manifestMismatch = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `beecoded-${product}-package-`));
  temporaryRoots.push(root);
  const source = path.join(repoRoot, 'plugins', product);
  const copiedRoot = path.join(root, product);
  fs.cpSync(source, copiedRoot, { recursive: true });

  for (const relative of [
    'package.json',
    '.claude-plugin/plugin.json',
    '.codex-plugin/plugin.json',
  ]) {
    const file = path.join(copiedRoot, relative);
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    payload.version = manifestMismatch && relative === '.codex-plugin/plugin.json'
      ? '9.9.9'
      : version;
    writeJson(file, payload);
  }

  return {
    root: copiedRoot,
    installer: path.join(copiedRoot, 'bin', 'install.mjs'),
  };
}

function readState(fixture, host) {
  const file = path.join(fixture.stateDirectory, `${host}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { marketplaces: [], plugins: [] };
}

function seedLegacyMarketplace(fixture, product, version) {
  const marketplace = `beecoded-${product}`;
  const selector = `${product}@${marketplace}`;
  const legacyRoot = path.join(fixture.managedHome, 'marketplaces', product);
  const unrelatedRoot = path.join(fixture.root, 'unrelated-marketplace');
  fs.mkdirSync(path.join(legacyRoot, 'plugins', product), { recursive: true });
  fs.mkdirSync(unrelatedRoot, { recursive: true });
  fs.mkdirSync(fixture.stateDirectory, { recursive: true });
  writeJson(path.join(legacyRoot, 'plugins', product, 'package.json'), {
    name: `@beecoded/${product}`,
    version,
  });
  for (const host of ['claude', 'codex']) {
    writeJson(path.join(fixture.stateDirectory, `${host}.json`), {
      marketplaces: [
        { name: marketplace, root: legacyRoot },
        { name: 'third-party', root: unrelatedRoot },
      ],
      plugins: [
        { selector, product, marketplace, version },
        {
          selector: 'unrelated@third-party',
          product: 'unrelated',
          marketplace: 'third-party',
          version: '7.0.0',
        },
      ],
    });
  }
  return legacyRoot;
}

function seedUnownedProductMarketplace(fixture, product, { installed = false } = {}) {
  const marketplace = `beecoded-${product}`;
  const selector = `${product}@${marketplace}`;
  const unownedRoot = path.join(fixture.root, `custom-${product}-marketplace`);
  fs.mkdirSync(unownedRoot, { recursive: true });
  fs.mkdirSync(fixture.stateDirectory, { recursive: true });
  for (const host of ['claude', 'codex']) {
    writeJson(path.join(fixture.stateDirectory, `${host}.json`), {
      marketplaces: [{ name: marketplace, root: unownedRoot }],
      plugins: installed ? [{
        selector,
        product,
        marketplace,
        version: '9.9.9',
      }] : [],
    });
  }
  return unownedRoot;
}

function readLog(fixture, host) {
  const file = path.join(fixture.stateDirectory, `${host}.log`);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function skillsRoot(fixture, host) {
  return path.join(fixture.root, host === 'claude' ? 'claude' : 'codex', 'skills');
}

function managedRoot(fixture, product, host) {
  return path.join(fixture.managedHome, 'marketplaces', product, host);
}

function globalGitIgnore(fixture) {
  return path.join(fixture.env.XDG_CONFIG_HOME, 'git', 'ignore');
}

function installedSkillNames(fixture, host, product) {
  const root = skillsRoot(fixture, host);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()
      && (entry.name === product || entry.name.startsWith(`${product}-`)))
    .map((entry) => entry.name)
    .sort();
}

function declaredSkillNames(definition) {
  const sourceRoot = path.join(repoRoot, definition.packageRoot, 'internal-skills');
  return fs.readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()
      && fs.existsSync(path.join(sourceRoot, entry.name, 'SKILL.md')))
    .map((entry) => (
      entry.name === definition.id || entry.name.startsWith(`${definition.id}-`)
        ? entry.name
        : `${definition.id}-${entry.name}`
    ))
    .sort();
}

function assertOwnedSkill(fixture, host, name, packageName) {
  const directory = path.join(skillsRoot(fixture, host), name);
  const ownership = JSON.parse(fs.readFileSync(
    path.join(directory, '.beecoded-skill.json'),
    'utf8',
  ));
  assert.equal(ownership.package, packageName);
  assert.equal(ownership.skill, name);
  const skill = fs.readFileSync(path.join(directory, 'SKILL.md'), 'utf8');
  assert.match(skill, new RegExp(`^name: ${name}$`, 'm'));
  assert.doesNotMatch(skill, /\/(?:bee|nectar):|\$(?:bee|nectar):/);
}

try {
  const managedDefinitions = listProductDefinitions().filter(({ managedInstaller }) => managedInstaller);
  const canonicalInstaller = fs.readFileSync(
    path.join(repoRoot, managedDefinitions[0].packageRoot, 'bin', 'install.mjs'),
    'utf8',
  );
  for (const definition of managedDefinitions.slice(1)) {
    assert.equal(
      fs.readFileSync(path.join(repoRoot, definition.packageRoot, 'bin', 'install.mjs'), 'utf8'),
      canonicalInstaller,
      `${definition.id} must use the canonical generic installer`,
    );
  }

  const bee = makeFixture();
  const firstInstall = run('bee', bee);
  assert.match(firstInstall, /installed for Claude Code/);
  assert.match(firstInstall, /installed for Codex/);

  const beeProductRoot = path.join(bee.managedHome, 'marketplaces', 'bee');
  const beeClaudeRoot = managedRoot(bee, 'bee', 'claude');
  const beeCodexRoot = managedRoot(bee, 'bee', 'codex');
  for (const root of [beeClaudeRoot, beeCodexRoot]) {
    assert.ok(fs.existsSync(path.join(root, 'plugins', 'bee', '.claude-plugin', 'plugin.json')));
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'))).name, 'beecoded-bee');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.agents', 'plugins', 'marketplace.json'))).name, 'beecoded-bee');
  }
  assert.deepEqual(readState(bee, 'claude').plugins.map((entry) => entry.selector), ['bee@beecoded-bee']);
  assert.deepEqual(readState(bee, 'codex').plugins.map((entry) => entry.selector), ['bee@beecoded-bee']);
  assert.equal(installedSkillNames(bee, 'claude', 'bee').length, 51);
  assert.equal(installedSkillNames(bee, 'codex', 'bee').length, 51);
  assertOwnedSkill(bee, 'claude', 'bee-init', '@beecoded/bee');
  assertOwnedSkill(bee, 'codex', 'bee-plan-phase', '@beecoded/bee');
  assert.match(
    fs.readFileSync(path.join(skillsRoot(bee, 'claude'), 'bee-init', 'SKILL.md'), 'utf8'),
    new RegExp(path.join(beeClaudeRoot, 'plugins', 'bee', 'workflows', 'init.md')),
  );
  assert.doesNotMatch(
    fs.readFileSync(path.join(skillsRoot(bee, 'claude'), 'bee-init', 'SKILL.md'), 'utf8'),
    new RegExp(path.join(repoRoot, 'plugins', 'bee', 'workflows', 'init.md')),
  );
  assert.equal(fs.existsSync(path.join(skillsRoot(bee, 'claude'), 'init')), false);
  assert.equal(fs.existsSync(path.join(skillsRoot(bee, 'codex'), 'plan-phase')), false);
  assert.equal(
    readLog(bee, 'claude').filter((args) => args[0] === 'plugin' && args[1] === 'list').length,
    1,
    'install should reuse one Claude plugin-list snapshot',
  );
  assert.equal(
    readLog(bee, 'codex').filter((args) => args[0] === 'plugin' && args[1] === 'list').length,
    1,
    'install should reuse one Codex plugin-list snapshot',
  );

  for (const host of ['claude', 'codex']) {
    const retired = path.join(skillsRoot(bee, host), 'bee-retired');
    fs.mkdirSync(retired);
    writeJson(path.join(retired, '.beecoded-skill.json'), {
      schema: 1,
      package: '@beecoded/bee',
      version: '4.9.1',
      skill: 'bee-retired',
    });
    fs.writeFileSync(path.join(retired, 'SKILL.md'), '# Retired\n');
    const userOwned = path.join(skillsRoot(bee, host), 'bee-user-owned');
    fs.mkdirSync(userOwned);
    fs.writeFileSync(path.join(userOwned, 'SKILL.md'), '# User owned\n');
  }

  const beeVersion = JSON.parse(fs.readFileSync(
    path.join(repoRoot, 'plugins', 'bee', 'package.json'),
    'utf8',
  )).version;
  const updatedBee = packageCopy('bee', beeVersion);
  const updateMarker = 'runtime-update-marker';
  fs.appendFileSync(
    path.join(updatedBee.root, 'internal-skills', 'bee-init', 'SKILL.md'),
    `\n${updateMarker}\n`,
  );
  const secondInstall = runInstallerPath(updatedBee.installer, bee);
  assert.equal(secondInstall.status, 0, secondInstall.stderr);
  assert.match(secondInstall.stdout, /updated for Claude Code/);
  assert.match(secondInstall.stdout, /updated for Codex/);
  assert.ok(readLog(bee, 'claude').some((args) => args[0] === 'plugin' && args[1] === 'update'));
  assert.ok(readLog(bee, 'codex').some((args) => args[0] === 'plugin' && args[1] === 'remove'));
  for (const host of ['claude', 'codex']) {
    assert.match(
      fs.readFileSync(path.join(skillsRoot(bee, host), 'bee-init', 'SKILL.md'), 'utf8'),
      new RegExp(updateMarker),
    );
    for (const skillName of installedSkillNames(bee, host, 'bee')) {
      if (skillName === 'bee-user-owned') continue;
      const ownership = JSON.parse(fs.readFileSync(
        path.join(skillsRoot(bee, host), skillName, '.beecoded-skill.json'),
        'utf8',
      ));
      assert.equal(ownership.version, beeVersion);
    }
    assert.equal(fs.existsSync(path.join(skillsRoot(bee, host), 'bee-retired')), false);
    assert.equal(fs.existsSync(path.join(skillsRoot(bee, host), 'bee-user-owned')), true);
  }

  run('bee', bee, ['uninstall']);
  assert.equal(readState(bee, 'claude').plugins.length, 0);
  assert.equal(readState(bee, 'codex').plugins.length, 0);
  assert.equal(readState(bee, 'claude').marketplaces.length, 0);
  assert.equal(readState(bee, 'codex').marketplaces.length, 0);
  assert.equal(fs.existsSync(beeProductRoot), false);
  assert.deepEqual(installedSkillNames(bee, 'claude', 'bee'), ['bee-user-owned']);
  assert.deepEqual(installedSkillNames(bee, 'codex', 'bee'), ['bee-user-owned']);

  const nectar = makeFixture();
  const nectarInstall = run('nectar', nectar, ['--claude']);
  assert.match(nectarInstall, /executing @beecoded\/nectar@\d+\.\d+\.\d+ source=/);
  assert.equal(fs.readFileSync(globalGitIgnore(nectar), 'utf8'), '.nectar/\n');
  assert.deepEqual(readState(nectar, 'claude').plugins.map((entry) => entry.selector), ['nectar@beecoded-nectar']);
  assert.equal(installedSkillNames(nectar, 'claude', 'nectar').length, 11);
  assertOwnedSkill(nectar, 'claude', 'nectar-shape', '@beecoded/nectar');
  assert.equal(readState(nectar, 'codex').plugins.length, 0);
  assert.equal(readLog(nectar, 'codex').some((args) => args[0] === 'plugin'), false);
  const nectarProductRoot = path.join(nectar.managedHome, 'marketplaces', 'nectar');
  const nectarRoot = managedRoot(nectar, 'nectar', 'claude');
  const installedBuild = fs.readFileSync(
    path.join(skillsRoot(nectar, 'claude'), 'nectar-build', 'SKILL.md'),
    'utf8',
  );
  assert.match(installedBuild, new RegExp(path.join(
    nectarRoot,
    'plugins',
    'nectar',
    'agents',
    'implementer.md',
  )));
  assert.doesNotMatch(installedBuild, /\.\.\/\.\.\/agents\/implementer\.md/);
  run('nectar', nectar, ['uninstall', '--all']);
  assert.equal(fs.existsSync(nectarProductRoot), false, 'explicit --all uninstall must remove managed files');
  assert.equal(installedSkillNames(nectar, 'claude', 'nectar').length, 0);
  assert.equal(
    fs.readFileSync(globalGitIgnore(nectar), 'utf8'),
    '.nectar/\n',
    'uninstall keeps the global ignore because existing projects may still contain Nectar state',
  );

  const dryRun = makeFixture();
  run('nectar', dryRun, ['--all', '--dry-run']);
  assert.equal(fs.existsSync(globalGitIgnore(dryRun)), false);
  assert.equal(fs.existsSync(path.join(dryRun.managedHome, 'marketplaces', 'nectar')), false);
  assert.equal(readState(dryRun, 'claude').plugins.length, 0);
  assert.equal(readState(dryRun, 'codex').plugins.length, 0);
  assert.equal(fs.existsSync(skillsRoot(dryRun, 'claude')), false);
  assert.equal(fs.existsSync(skillsRoot(dryRun, 'codex')), false);

  const installedDryRun = makeFixture();
  run('nectar', installedDryRun, ['--all']);
  fs.rmSync(globalGitIgnore(installedDryRun));
  run('nectar', installedDryRun, ['--all']);
  assert.equal(
    fs.readFileSync(globalGitIgnore(installedDryRun), 'utf8')
      .split('\n')
      .filter((line) => line === '.nectar/')
      .length,
    1,
    'update must restore exactly one missing global ignore entry',
  );
  const installedDryRunVersion = JSON.parse(fs.readFileSync(
    path.join(repoRoot, 'plugins', 'nectar', 'package.json'),
    'utf8',
  )).version;
  const dryRunUpdate = run('nectar', installedDryRun, ['--all', '--dry-run']);
  assert.match(dryRunUpdate, /would run: claude plugin marketplace update beecoded-nectar/);
  assert.match(dryRunUpdate, /would run: claude plugin update nectar@beecoded-nectar --scope user/);
  assert.match(dryRunUpdate, /would run: codex plugin remove nectar@beecoded-nectar --json/);
  assert.doesNotMatch(dryRunUpdate, /plugin marketplace add/);
  assert.match(dryRunUpdate, /updated for Claude Code/);
  assert.match(dryRunUpdate, /updated for Codex/);
  assert.deepEqual(
    readState(installedDryRun, 'claude').plugins.map((entry) => entry.version),
    [installedDryRunVersion],
  );
  assert.deepEqual(
    readState(installedDryRun, 'codex').plugins.map((entry) => entry.version),
    [installedDryRunVersion],
  );

  const staleDryRun = packageCopy('nectar', '0.9.0');
  const rejectedDryRun = runInstallerPath(
    staleDryRun.installer,
    installedDryRun,
    ['--all', '--dry-run'],
  );
  assert.notEqual(rejectedDryRun.status, 0, 'dry-run must enforce downgrade protection');
  assert.match(rejectedDryRun.stderr, /Refusing to replace installed Nectar/);
  assert.match(rejectedDryRun.stderr, /--allow-downgrade/);

  const dryRunUninstall = run('nectar', installedDryRun, ['uninstall', '--all', '--dry-run']);
  assert.match(dryRunUninstall, /would run: claude plugin uninstall nectar@beecoded-nectar --scope user --yes/);
  assert.match(dryRunUninstall, /would run: claude plugin marketplace remove beecoded-nectar --scope user/);
  assert.match(dryRunUninstall, /would run: codex plugin remove nectar@beecoded-nectar --json/);
  assert.match(dryRunUninstall, /would run: codex plugin marketplace remove beecoded-nectar --json/);
  for (const host of ['claude', 'codex']) {
    assert.deepEqual(
      readState(installedDryRun, host).plugins.map((entry) => entry.version),
      [installedDryRunVersion],
      `dry-run uninstall must preserve the ${host} plugin`,
    );
    assert.equal(readState(installedDryRun, host).marketplaces.length, 1);
    assert.equal(installedSkillNames(installedDryRun, host, 'nectar').length, 11);
    assert.equal(fs.existsSync(managedRoot(installedDryRun, 'nectar', host)), true);
  }

  const legacyUpgrade = makeFixture();
  const legacyRoot = seedLegacyMarketplace(legacyUpgrade, 'nectar', '1.3.0');
  const legacyUpgradeOutput = run('nectar', legacyUpgrade, ['--all']);
  assert.match(legacyUpgradeOutput, /installed for Claude Code|updated for Claude Code/);
  assert.match(legacyUpgradeOutput, /installed for Codex|updated for Codex/);
  for (const host of ['claude', 'codex']) {
    const log = readLog(legacyUpgrade, host);
    assert.ok(
      log.some((args) => args[0] === 'plugin' && args[1] === 'marketplace'
        && args[2] === 'remove' && args[3] === 'beecoded-nectar'),
      `${host} upgrade removes the legacy marketplace registration`,
    );
    assert.ok(
      log.some((args) => args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add'),
      `${host} upgrade adds the host-specific marketplace registration`,
    );
    const state = readState(legacyUpgrade, host);
    assert.equal(
      state.marketplaces.find((entry) => entry.name === 'beecoded-nectar').root,
      fs.realpathSync(managedRoot(legacyUpgrade, 'nectar', host)),
    );
    assert.ok(state.marketplaces.some((entry) => entry.name === 'third-party'));
    assert.equal(
      state.plugins.find((entry) => entry.selector === 'nectar@beecoded-nectar').version,
      installedDryRunVersion,
    );
    assert.ok(state.plugins.some((entry) => entry.selector === 'unrelated@third-party'));
  }
  assert.equal(fs.existsSync(path.join(legacyRoot, 'plugins', 'nectar', 'package.json')), true);

  const legacySymlinkCollision = makeFixture();
  const legacySymlinkRoot = path.join(
    legacySymlinkCollision.managedHome,
    'marketplaces',
    'code-audit',
  );
  const legacySymlinkOutside = path.join(legacySymlinkCollision.root, 'outside-legacy-plugins');
  fs.mkdirSync(path.join(legacySymlinkOutside, 'code-audit'), { recursive: true });
  writeJson(path.join(legacySymlinkOutside, 'code-audit', 'package.json'), {
    name: '@beecoded/code-audit',
    version: '0.1.0',
  });
  fs.mkdirSync(legacySymlinkRoot, { recursive: true });
  fs.symlinkSync(legacySymlinkOutside, path.join(legacySymlinkRoot, 'plugins'));
  fs.mkdirSync(legacySymlinkCollision.stateDirectory, { recursive: true });
  writeJson(path.join(legacySymlinkCollision.stateDirectory, 'claude.json'), {
    marketplaces: [{ name: 'beecoded-code-audit', root: legacySymlinkRoot }],
    plugins: [{
      selector: 'code-audit@beecoded-code-audit',
      product: 'code-audit',
      marketplace: 'beecoded-code-audit',
      version: '0.1.0',
    }],
  });
  const legacySymlinkUninstall = runInstallerPath(
    path.join(repoRoot, 'plugins', 'code-audit', 'bin', 'install.mjs'),
    legacySymlinkCollision,
    ['uninstall', '--claude'],
  );
  assert.notEqual(legacySymlinkUninstall.status, 0);
  assert.match(legacySymlinkUninstall.stderr, /Refusing to remove unowned marketplace/);
  assert.equal(readState(legacySymlinkCollision, 'claude').plugins.length, 1);
  assert.equal(fs.existsSync(path.join(legacySymlinkOutside, 'code-audit', 'package.json')), true);

  const legacyDryRun = makeFixture();
  const legacyDryRunRoot = seedLegacyMarketplace(legacyDryRun, 'nectar', '1.3.0');
  const legacyPreview = run('nectar', legacyDryRun, ['--all', '--dry-run']);
  assert.match(legacyPreview, /claude plugin marketplace remove beecoded-nectar/);
  assert.match(legacyPreview, /claude plugin marketplace add/);
  assert.match(legacyPreview, /codex plugin marketplace remove beecoded-nectar --json/);
  assert.match(legacyPreview, /codex plugin marketplace add/);
  for (const host of ['claude', 'codex']) {
    const state = readState(legacyDryRun, host);
    assert.equal(
      state.marketplaces.find((entry) => entry.name === 'beecoded-nectar').root,
      legacyDryRunRoot,
    );
    assert.equal(
      state.plugins.find((entry) => entry.selector === 'nectar@beecoded-nectar').version,
      '1.3.0',
    );
    assert.equal(fs.existsSync(managedRoot(legacyDryRun, 'nectar', host)), false);
  }

  for (const definition of managedDefinitions.filter(({ kind }) => kind === 'skills-only')) {
    const isolated = makeFixture();
    const currentVersion = JSON.parse(fs.readFileSync(
      path.join(repoRoot, definition.packageRoot, 'package.json'),
      'utf8',
    )).version;
    run(definition.id, isolated, ['--all']);
    for (const host of ['claude', 'codex']) {
      assert.deepEqual(
        readState(isolated, host).plugins.map((entry) => entry.selector),
        [`${definition.id}@beecoded-${definition.id}`],
      );
      assert.deepEqual(installedSkillNames(isolated, host, definition.id), definition.publicSkills);
      assertOwnedSkill(isolated, host, definition.publicSkills[0], definition.packageName);
    }

    const update = packageCopy(definition.id, currentVersion);
    const updateMarker = `${definition.id}-isolated-update-marker`;
    fs.appendFileSync(
      path.join(update.root, 'internal-skills', definition.publicSkills[0], 'SKILL.md'),
      `\n${updateMarker}\n`,
    );
    const updated = runInstallerPath(update.installer, isolated, ['--all']);
    assert.equal(updated.status, 0, updated.stderr);
    for (const host of ['claude', 'codex']) {
      assert.match(
        fs.readFileSync(
          path.join(skillsRoot(isolated, host), definition.publicSkills[0], 'SKILL.md'),
          'utf8',
        ),
        new RegExp(updateMarker),
      );
    }

    const stale = packageCopy(definition.id, '0.0.1');
    const rejected = runInstallerPath(stale.installer, isolated, ['--all']);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /--allow-downgrade/);
    const allowed = runInstallerPath(stale.installer, isolated, ['--all', '--allow-downgrade']);
    assert.equal(allowed.status, 0, allowed.stderr);
    for (const host of ['claude', 'codex']) {
      assert.deepEqual(readState(isolated, host).plugins.map((entry) => entry.version), ['0.0.1']);
      assert.equal(JSON.parse(fs.readFileSync(
        path.join(skillsRoot(isolated, host), definition.publicSkills[0], '.beecoded-skill.json'),
        'utf8',
      )).version, '0.0.1');
    }

    run(definition.id, isolated, ['uninstall', '--all']);
    for (const host of ['claude', 'codex']) {
      assert.equal(readState(isolated, host).plugins.length, 0);
      assert.equal(readState(isolated, host).marketplaces.length, 0);
      assert.equal(installedSkillNames(isolated, host, definition.id).length, 0);
    }
  }

  const auditProductsToRemove = new Set(['code-audit', 'ui-ux-audit']);
  for (const removedDefinition of managedDefinitions.filter(({ id }) => auditProductsToRemove.has(id))) {
    const together = makeFixture();
    for (const definition of managedDefinitions) run(definition.id, together, ['--all']);
    for (const host of ['claude', 'codex']) {
      assert.deepEqual(
        readState(together, host).marketplaces.map((entry) => entry.name).sort(),
        managedDefinitions.map(({ id }) => `beecoded-${id}`).sort(),
      );
      for (const definition of managedDefinitions) {
        assert.deepEqual(
          installedSkillNames(together, host, definition.id),
          declaredSkillNames(definition),
        );
      }
      const installedUiAudit = fs.readFileSync(
        path.join(skillsRoot(together, host), 'ui-ux-audit', 'SKILL.md'),
        'utf8',
      );
      assert.ok(installedUiAudit.includes(path.join(
        managedRoot(together, 'ui-ux-audit', host),
        'plugins',
        'ui-ux-audit',
        'references',
        `${host}-browser.md`,
      )));
      assert.ok(!installedUiAudit.includes(path.join(
        repoRoot,
        'plugins',
        'ui-ux-audit',
        'references',
        `${host}-browser.md`,
      )));
    }
    const preservedDefinitions = managedDefinitions.filter(({ id }) => id !== removedDefinition.id);
    run(removedDefinition.id, together, ['uninstall', '--all']);
    for (const host of ['claude', 'codex']) {
      assert.equal(installedSkillNames(together, host, removedDefinition.id).length, 0);
      for (const definition of preservedDefinitions) {
        assert.deepEqual(
          installedSkillNames(together, host, definition.id),
          declaredSkillNames(definition),
        );
        assertOwnedSkill(
          together,
          host,
          declaredSkillNames(definition)[0],
          definition.packageName,
        );
      }
      assert.deepEqual(
        readState(together, host).plugins.map((entry) => entry.selector).sort(),
        preservedDefinitions.map(({ id }) => `${id}@beecoded-${id}`).sort(),
      );
      assert.deepEqual(
        readState(together, host).marketplaces.map((entry) => entry.name).sort(),
        preservedDefinitions.map(({ id }) => `beecoded-${id}`).sort(),
      );
    }
  }

  const marketplaceCollisionInstall = makeFixture();
  const collisionInstallRoot = seedUnownedProductMarketplace(
    marketplaceCollisionInstall,
    'code-audit',
  );
  const rejectedMarketplaceInstall = runInstallerPath(
    path.join(repoRoot, 'plugins', 'code-audit', 'bin', 'install.mjs'),
    marketplaceCollisionInstall,
    ['--claude'],
  );
  assert.notEqual(rejectedMarketplaceInstall.status, 0);
  assert.match(rejectedMarketplaceInstall.stderr, /Refusing to replace unowned marketplace/);
  assert.deepEqual(readState(marketplaceCollisionInstall, 'claude').marketplaces, [{
    name: 'beecoded-code-audit',
    root: collisionInstallRoot,
  }]);
  assert.deepEqual(readState(marketplaceCollisionInstall, 'claude').plugins, []);
  assert.equal(fs.existsSync(managedRoot(marketplaceCollisionInstall, 'code-audit', 'claude')), false);

  const marketplaceCollisionUninstall = makeFixture();
  const collisionUninstallRoot = seedUnownedProductMarketplace(
    marketplaceCollisionUninstall,
    'ui-ux-audit',
    { installed: true },
  );
  const rejectedMarketplaceUninstall = runInstallerPath(
    path.join(repoRoot, 'plugins', 'ui-ux-audit', 'bin', 'install.mjs'),
    marketplaceCollisionUninstall,
    ['uninstall', '--codex'],
  );
  assert.notEqual(rejectedMarketplaceUninstall.status, 0);
  assert.match(rejectedMarketplaceUninstall.stderr, /Refusing to remove unowned marketplace/);
  assert.deepEqual(readState(marketplaceCollisionUninstall, 'codex').marketplaces, [{
    name: 'beecoded-ui-ux-audit',
    root: collisionUninstallRoot,
  }]);
  assert.deepEqual(
    readState(marketplaceCollisionUninstall, 'codex').plugins.map((entry) => entry.selector),
    ['ui-ux-audit@beecoded-ui-ux-audit'],
  );

  const exactManagedCollisionInstall = makeFixture();
  const exactInstallRoot = managedRoot(exactManagedCollisionInstall, 'code-audit', 'claude');
  fs.mkdirSync(exactInstallRoot, { recursive: true });
  fs.writeFileSync(path.join(exactInstallRoot, 'user-content.txt'), 'preserve me\n');
  fs.mkdirSync(exactManagedCollisionInstall.stateDirectory, { recursive: true });
  writeJson(path.join(exactManagedCollisionInstall.stateDirectory, 'claude.json'), {
    marketplaces: [{ name: 'beecoded-code-audit', root: exactInstallRoot }],
    plugins: [],
  });
  const rejectedExactInstall = runInstallerPath(
    path.join(repoRoot, 'plugins', 'code-audit', 'bin', 'install.mjs'),
    exactManagedCollisionInstall,
    ['--claude'],
  );
  assert.notEqual(rejectedExactInstall.status, 0);
  assert.match(rejectedExactInstall.stderr, /Refusing to replace unowned managed payload/);
  assert.equal(fs.readFileSync(path.join(exactInstallRoot, 'user-content.txt'), 'utf8'), 'preserve me\n');

  const exactManagedCollisionUninstall = makeFixture();
  const exactUninstallRoot = managedRoot(exactManagedCollisionUninstall, 'ui-ux-audit', 'codex');
  fs.mkdirSync(exactUninstallRoot, { recursive: true });
  fs.writeFileSync(path.join(exactUninstallRoot, 'user-content.txt'), 'preserve me\n');
  fs.mkdirSync(exactManagedCollisionUninstall.stateDirectory, { recursive: true });
  writeJson(path.join(exactManagedCollisionUninstall.stateDirectory, 'codex.json'), {
    marketplaces: [{ name: 'beecoded-ui-ux-audit', root: exactUninstallRoot }],
    plugins: [{
      selector: 'ui-ux-audit@beecoded-ui-ux-audit',
      product: 'ui-ux-audit',
      marketplace: 'beecoded-ui-ux-audit',
      version: '9.9.9',
    }],
  });
  const rejectedExactUninstall = runInstallerPath(
    path.join(repoRoot, 'plugins', 'ui-ux-audit', 'bin', 'install.mjs'),
    exactManagedCollisionUninstall,
    ['uninstall', '--codex'],
  );
  assert.notEqual(rejectedExactUninstall.status, 0);
  assert.match(rejectedExactUninstall.stderr, /Refusing to remove unowned (?:managed payload|marketplace)/);
  assert.equal(fs.readFileSync(path.join(exactUninstallRoot, 'user-content.txt'), 'utf8'), 'preserve me\n');
  assert.equal(readState(exactManagedCollisionUninstall, 'codex').plugins.length, 1);

  for (const host of ['claude', 'codex']) {
    const unregisteredManagedCollision = makeFixture();
    const unregisteredRoot = managedRoot(
      unregisteredManagedCollision,
      'ui-ux-audit',
      host,
    );
    fs.mkdirSync(unregisteredRoot, { recursive: true });
    fs.writeFileSync(path.join(unregisteredRoot, 'user-content.txt'), 'preserve me\n');
    const rejectedUnregisteredUninstall = runInstallerPath(
      path.join(repoRoot, 'plugins', 'ui-ux-audit', 'bin', 'install.mjs'),
      unregisteredManagedCollision,
      ['uninstall', `--${host}`],
    );
    assert.notEqual(rejectedUnregisteredUninstall.status, 0);
    assert.match(rejectedUnregisteredUninstall.stderr, /Refusing to remove unowned managed payload/);
    assert.equal(
      fs.readFileSync(path.join(unregisteredRoot, 'user-content.txt'), 'utf8'),
      'preserve me\n',
    );
    assert.deepEqual(readState(unregisteredManagedCollision, host), { marketplaces: [], plugins: [] });
  }

  for (const host of ['claude', 'codex']) {
    const freshActivationFailure = makeFixture();
    freshActivationFailure.env.STUB_FAIL_PLUGIN_ADD_ONCE = host;
    const failedFreshInstall = runInstallerPath(
      path.join(repoRoot, 'plugins', 'code-audit', 'bin', 'install.mjs'),
      freshActivationFailure,
      [`--${host}`],
    );
    assert.notEqual(failedFreshInstall.status, 0);
    assert.match(failedFreshInstall.stderr, /simulated plugin-add failure/);
    assert.deepEqual(readState(freshActivationFailure, host).plugins, []);
    assert.deepEqual(readState(freshActivationFailure, host).marketplaces, []);
    assert.equal(fs.existsSync(managedRoot(freshActivationFailure, 'code-audit', host)), false);
    assert.equal(installedSkillNames(freshActivationFailure, host, 'code-audit').length, 0);
  }

  for (const host of ['claude', 'codex']) {
    const postActivationSkillFailure = makeFixture();
    postActivationSkillFailure.env.STUB_CREATE_SKILL_COLLISION_AFTER_ADD = host;
    const failedSkillInstall = runInstallerPath(
      path.join(repoRoot, 'plugins', 'ui-ux-audit', 'bin', 'install.mjs'),
      postActivationSkillFailure,
      [`--${host}`],
    );
    assert.notEqual(failedSkillInstall.status, 0);
    assert.match(failedSkillInstall.stderr, /Refusing to overwrite unowned skill/);
    assert.deepEqual(readState(postActivationSkillFailure, host).plugins, []);
    assert.deepEqual(readState(postActivationSkillFailure, host).marketplaces, []);
    assert.equal(fs.existsSync(managedRoot(postActivationSkillFailure, 'ui-ux-audit', host)), false);
    assert.equal(
      fs.readFileSync(
        path.join(skillsRoot(postActivationSkillFailure, host), 'ui-ux-audit', 'SKILL.md'),
        'utf8',
      ),
      '# Unowned collision\n',
    );
  }

  const codexRecovery = makeFixture();
  run('ui-ux-audit', codexRecovery, ['--codex']);
  const uiAuditVersion = JSON.parse(fs.readFileSync(
    path.join(repoRoot, 'plugins', 'ui-ux-audit', 'package.json'),
    'utf8',
  )).version;
  const failedUpdatePackage = packageCopy('ui-ux-audit', uiAuditVersion);
  fs.appendFileSync(
    path.join(failedUpdatePackage.root, 'internal-skills', 'ui-ux-audit', 'SKILL.md'),
    '\nfailed-update-marker\n',
  );
  codexRecovery.env.STUB_FAIL_PLUGIN_ADD_ONCE = 'codex';
  const failedUpdate = runInstallerPath(failedUpdatePackage.installer, codexRecovery, ['--codex']);
  assert.notEqual(failedUpdate.status, 0);
  assert.match(failedUpdate.stderr, /simulated plugin-add failure/);
  assert.deepEqual(
    readState(codexRecovery, 'codex').plugins.map((entry) => entry.selector),
    ['ui-ux-audit@beecoded-ui-ux-audit'],
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(
      managedRoot(codexRecovery, 'ui-ux-audit', 'codex'),
      'plugins',
      'ui-ux-audit',
      'package.json',
    ))).version,
    uiAuditVersion,
  );
  assert.doesNotMatch(
    fs.readFileSync(path.join(skillsRoot(codexRecovery, 'codex'), 'ui-ux-audit', 'SKILL.md'), 'utf8'),
    /failed-update-marker/,
  );

  fs.rmSync(path.join(codexRecovery.stateDirectory, 'codex.plugin-add-failed-once'));
  const failedDowngradePackage = packageCopy('ui-ux-audit', '0.0.1');
  const failedDowngrade = runInstallerPath(
    failedDowngradePackage.installer,
    codexRecovery,
    ['--codex', '--allow-downgrade'],
  );
  assert.notEqual(failedDowngrade.status, 0);
  assert.match(failedDowngrade.stderr, /simulated plugin-add failure/);
  assert.deepEqual(
    readState(codexRecovery, 'codex').plugins.map((entry) => entry.version),
    [uiAuditVersion],
  );
  assert.equal(JSON.parse(fs.readFileSync(path.join(
    managedRoot(codexRecovery, 'ui-ux-audit', 'codex'),
    'plugins',
    'ui-ux-audit',
    'package.json',
  ))).version, uiAuditVersion);

  const collision = makeFixture();
  const collisionPath = path.join(skillsRoot(collision, 'codex'), 'nectar-shape');
  fs.mkdirSync(collisionPath, { recursive: true });
  fs.writeFileSync(path.join(collisionPath, 'SKILL.md'), '# User-owned shape\n');
  const collisionResult = runInstallerPath(
    path.join(repoRoot, 'plugins', 'nectar', 'bin', 'install.mjs'),
    collision,
    ['--all'],
  );
  assert.notEqual(collisionResult.status, 0);
  assert.match(collisionResult.stderr, /Refusing to overwrite unowned skill/);
  assert.match(collisionResult.stderr, new RegExp(collisionPath));
  assert.equal(
    fs.readFileSync(path.join(collisionPath, 'SKILL.md'), 'utf8'),
    '# User-owned shape\n',
  );
  assert.equal(
    fs.existsSync(path.join(collision.managedHome, 'marketplaces', 'nectar')),
    false,
  );
  assert.deepEqual(readState(collision, 'claude').plugins, []);
  assert.deepEqual(readState(collision, 'codex').plugins, []);
  assert.deepEqual(readState(collision, 'claude').marketplaces, []);
  assert.deepEqual(readState(collision, 'codex').marketplaces, []);
  assert.deepEqual(installedSkillNames(collision, 'claude', 'nectar'), []);
  assert.deepEqual(installedSkillNames(collision, 'codex', 'nectar'), ['nectar-shape']);

  const guarded = makeFixture();
  run('nectar', guarded, ['--all']);
  const currentVersion = JSON.parse(fs.readFileSync(
    path.join(repoRoot, 'plugins', 'nectar', 'package.json'),
    'utf8',
  )).version;
  const guardedClaudeRoot = managedRoot(guarded, 'nectar', 'claude');
  const guardedCodexRoot = managedRoot(guarded, 'nectar', 'codex');
  const stale = packageCopy('nectar', '0.9.0');
  const rejected = runInstallerPath(stale.installer, guarded);
  assert.notEqual(
    rejected.status,
    0,
    `stale package must be rejected:\n${rejected.stderr}\n${rejected.stdout}`,
  );
  assert.match(rejected.stderr, /Refusing to replace installed Nectar/);
  assert.match(rejected.stderr, /--allow-downgrade/);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(guardedClaudeRoot, 'plugins', 'nectar', 'package.json'))).version,
    currentVersion,
    'rejected downgrade must preserve the managed payload',
  );
  assert.deepEqual(
    readState(guarded, 'claude').plugins.map((entry) => entry.version),
    [currentVersion],
  );
  assert.deepEqual(
    readState(guarded, 'codex').plugins.map((entry) => entry.version),
    [currentVersion],
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(guardedCodexRoot, 'plugins', 'nectar', 'package.json'))).version,
    currentVersion,
  );

  const allowed = runInstallerPath(stale.installer, guarded, ['--allow-downgrade']);
  assert.equal(allowed.status, 0, `explicit downgrade failed:\n${allowed.stderr}\n${allowed.stdout}`);
  assert.deepEqual(readState(guarded, 'claude').plugins.map((entry) => entry.version), ['0.9.0']);
  assert.deepEqual(readState(guarded, 'codex').plugins.map((entry) => entry.version), ['0.9.0']);
  assert.equal(
    JSON.parse(fs.readFileSync(
      path.join(skillsRoot(guarded, 'claude'), 'nectar-shape', '.beecoded-skill.json'),
      'utf8',
    )).version,
    '0.9.0',
  );

  const mismatch = makeFixture();
  run('nectar', mismatch, ['--all']);
  const mismatchedPackage = packageCopy('nectar', currentVersion, { manifestMismatch: true });
  const mismatchResult = runInstallerPath(mismatchedPackage.installer, mismatch);
  assert.notEqual(mismatchResult.status, 0, 'mismatched staged payload must be rejected');
  assert.match(mismatchResult.stderr, /version mismatch/i);
  for (const host of ['claude', 'codex']) {
    assert.equal(
      JSON.parse(fs.readFileSync(
        path.join(managedRoot(mismatch, 'nectar', host), 'plugins', 'nectar', 'package.json'),
      )).version,
      currentVersion,
      'failed staged verification must preserve the previous managed payload',
    );
  }
  assert.deepEqual(readState(mismatch, 'claude').plugins.map((entry) => entry.version), [currentVersion]);
  assert.deepEqual(readState(mismatch, 'codex').plugins.map((entry) => entry.version), [currentVersion]);

  const targeted = makeFixture();
  run('nectar', targeted, ['--all']);
  const targetedStale = packageCopy('nectar', '0.9.0');
  const targetedResult = runInstallerPath(
    targetedStale.installer,
    targeted,
    ['--claude', '--allow-downgrade'],
  );
  assert.equal(targetedResult.status, 0, targetedResult.stderr);
  assert.equal(
    JSON.parse(fs.readFileSync(
      path.join(managedRoot(targeted, 'nectar', 'claude'), 'plugins', 'nectar', 'package.json'),
    )).version,
    '0.9.0',
  );
  assert.equal(
    JSON.parse(fs.readFileSync(
      path.join(managedRoot(targeted, 'nectar', 'codex'), 'plugins', 'nectar', 'package.json'),
    )).version,
    currentVersion,
  );
  assert.deepEqual(readState(targeted, 'claude').plugins.map((entry) => entry.version), ['0.9.0']);
  assert.deepEqual(readState(targeted, 'codex').plugins.map((entry) => entry.version), [currentVersion]);
  assert.equal(
    JSON.parse(fs.readFileSync(
      path.join(skillsRoot(targeted, 'claude'), 'nectar-shape', '.beecoded-skill.json'),
      'utf8',
    )).version,
    '0.9.0',
  );
  assert.equal(
    JSON.parse(fs.readFileSync(
      path.join(skillsRoot(targeted, 'codex'), 'nectar-shape', '.beecoded-skill.json'),
      'utf8',
    )).version,
    currentVersion,
  );
  run('nectar', targeted, ['uninstall', '--claude']);
  assert.equal(fs.existsSync(managedRoot(targeted, 'nectar', 'claude')), false);
  assert.equal(fs.existsSync(managedRoot(targeted, 'nectar', 'codex')), true);
  assert.deepEqual(readState(targeted, 'codex').plugins.map((entry) => entry.version), [currentVersion]);
  assertOwnedSkill(targeted, 'codex', 'nectar-shape', '@beecoded/nectar');

  const listFailure = makeFixture();
  listFailure.env.STUB_FAIL_PLUGIN_LIST = 'claude';
  const listFailureResult = runInstallerPath(
    path.join(repoRoot, 'plugins', 'nectar', 'bin', 'install.mjs'),
    listFailure,
    ['--claude'],
  );
  assert.notEqual(listFailureResult.status, 0);
  assert.match(listFailureResult.stderr, /Could not inspect installed Nectar versions for claude/);
  assert.match(listFailureResult.stderr, /simulated plugin-list failure/);
  assert.doesNotMatch(listFailureResult.stderr, /\n\s+at execute/);

  const marketplaceListFreshFailure = makeFixture();
  marketplaceListFreshFailure.env.STUB_FAIL_MARKETPLACE_LIST = 'claude';
  const marketplaceListFreshResult = runInstallerPath(
    path.join(repoRoot, 'plugins', 'code-audit', 'bin', 'install.mjs'),
    marketplaceListFreshFailure,
    ['--claude'],
  );
  assert.notEqual(marketplaceListFreshResult.status, 0);
  assert.match(marketplaceListFreshResult.stderr, /simulated marketplace-list failure/);
  assert.deepEqual(readState(marketplaceListFreshFailure, 'claude'), { marketplaces: [], plugins: [] });
  assert.equal(fs.existsSync(managedRoot(marketplaceListFreshFailure, 'code-audit', 'claude')), false);
  assert.equal(installedSkillNames(marketplaceListFreshFailure, 'claude', 'code-audit').length, 0);

  const marketplaceListUpdateFailure = makeFixture();
  run('ui-ux-audit', marketplaceListUpdateFailure, ['--codex']);
  const marketplaceListRoot = managedRoot(marketplaceListUpdateFailure, 'ui-ux-audit', 'codex');
  const marketplaceListStateBefore = readState(marketplaceListUpdateFailure, 'codex');
  const marketplaceListSkillBefore = fs.readFileSync(
    path.join(skillsRoot(marketplaceListUpdateFailure, 'codex'), 'ui-ux-audit', 'SKILL.md'),
    'utf8',
  );
  marketplaceListUpdateFailure.env.STUB_FAIL_MARKETPLACE_LIST = 'codex';
  const marketplaceListUpdatePackage = packageCopy('ui-ux-audit', uiAuditVersion);
  fs.appendFileSync(
    path.join(marketplaceListUpdatePackage.root, 'internal-skills', 'ui-ux-audit', 'SKILL.md'),
    '\nmarketplace-list-update-marker\n',
  );
  const marketplaceListUpdateResult = runInstallerPath(
    marketplaceListUpdatePackage.installer,
    marketplaceListUpdateFailure,
    ['--codex'],
  );
  assert.notEqual(marketplaceListUpdateResult.status, 0);
  assert.match(marketplaceListUpdateResult.stderr, /simulated marketplace-list failure/);
  assert.deepEqual(readState(marketplaceListUpdateFailure, 'codex'), marketplaceListStateBefore);
  assert.equal(
    fs.readFileSync(
      path.join(skillsRoot(marketplaceListUpdateFailure, 'codex'), 'ui-ux-audit', 'SKILL.md'),
      'utf8',
    ),
    marketplaceListSkillBefore,
  );
  assert.equal(JSON.parse(fs.readFileSync(path.join(
    marketplaceListRoot,
    'plugins',
    'ui-ux-audit',
    'package.json',
  ))).version, uiAuditVersion);
  assert.deepEqual(
    fs.readdirSync(path.dirname(marketplaceListRoot)).sort(),
    ['codex'],
    'marketplace-list failure must not create staging or backup roots',
  );

  console.log('Runtime installer tests passed: canonical installers, prefixed skills, isolated skills-only lifecycle, multi-product isolation, collision safety, owned marketplace guards, transactional host/payload/skill recovery, dual-host install, legacy-root migration, update, stale rejection, explicit downgrade, staged verification, uninstall, host selection, and state-aware dry-run');
} finally {
  for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true });
}
