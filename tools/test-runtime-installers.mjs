#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
  const root = state.marketplaces.find((entry) => entry.name === marketplace)?.root;
  if (!root) {
    console.error('marketplace not registered: ' + marketplace);
    process.exit(1);
  }
  const version = JSON.parse(fs.readFileSync(path.join(root, 'plugins', product, 'package.json'), 'utf8')).version;
  state.plugins = state.plugins.filter((entry) => entry.selector !== selector);
  state.plugins.push({ selector, product, marketplace, version });
  save();
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
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${product}-`))
    .map((entry) => entry.name)
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
  const beeInstaller = fs.readFileSync(path.join(repoRoot, 'plugins', 'bee', 'bin', 'install.mjs'), 'utf8');
  const nectarInstaller = fs.readFileSync(path.join(repoRoot, 'plugins', 'nectar', 'bin', 'install.mjs'), 'utf8');
  assert.equal(beeInstaller, nectarInstaller, 'Bee and Nectar must use the same generic installer');

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
  assert.equal(installedSkillNames(nectar, 'claude', 'nectar').length, 10);
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
    assert.equal(installedSkillNames(installedDryRun, host, 'nectar').length, 10);
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

  const together = makeFixture();
  run('bee', together, ['--all']);
  run('nectar', together, ['--all']);
  for (const host of ['claude', 'codex']) {
    assert.equal(installedSkillNames(together, host, 'bee').length, 51);
    assert.equal(installedSkillNames(together, host, 'nectar').length, 10);
  }
  run('bee', together, ['uninstall', '--all']);
  for (const host of ['claude', 'codex']) {
    assert.equal(installedSkillNames(together, host, 'bee').length, 0);
    assert.equal(installedSkillNames(together, host, 'nectar').length, 10);
    assertOwnedSkill(together, host, 'nectar-orient', '@beecoded/nectar');
  }
  assert.deepEqual(
    readState(together, 'claude').plugins.map((entry) => entry.selector),
    ['nectar@beecoded-nectar'],
  );

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

  console.log('Runtime installer tests passed: prefixed skills, dual-product isolation, collision safety, dual-host install, legacy-root migration, update, stale rejection, explicit downgrade, staged verification, uninstall, host selection, and state-aware dry-run');
} finally {
  for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true });
}
