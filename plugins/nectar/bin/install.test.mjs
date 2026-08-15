import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import * as installerModule from './install.mjs';
import {
  classifyManagedSkill,
  collectInstalledVersions,
  compareSemver,
  evaluateDowngrade,
  formatProvenance,
  installManagedSkills,
  parseArguments,
  preflightManagedSkills,
  removeManagedSkills,
  renderManagedSkill,
  resolveProductCommand,
  resolveSkillsRoot,
} from './install.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

test('compares stable and prerelease semantic versions', () => {
  assert.equal(compareSemver('1.2.0', '1.2.0'), 0);
  assert.equal(compareSemver('1.3.0', '1.2.9'), 1);
  assert.equal(compareSemver('1.2.9', '1.3.0'), -1);
  assert.equal(compareSemver('1.3.0-beta.2', '1.3.0-beta.10'), -1);
  assert.equal(compareSemver('1.3.0-beta.1', '1.3.0'), -1);
  assert.equal(compareSemver('1.0.0-9007199254740993', '1.0.0-9007199254740992'), 1);
  assert.equal(compareSemver('1.0.0-9007199254740992', '1.0.0-9007199254740993'), -1);
  assert.equal(compareSemver('9007199254740993.0.0', '9007199254740992.0.0'), 1);
  assert.equal(compareSemver('1.3.0+build.2', '1.3.0+build.1'), 0);
  assert.throws(() => compareSemver('latest', '1.3.0'), /Invalid semantic version/);
});

test('extracts installed versions from Claude and Codex plugin-list shapes', () => {
  assert.deepEqual(
    collectInstalledVersions([
      { id: 'nectar@beecoded-nectar', version: '1.2.0' },
      { id: 'other@market', version: '9.0.0' },
    ], {
      selector: 'nectar@beecoded-nectar',
      product: 'nectar',
      marketplaceName: 'beecoded-nectar',
    }),
    ['1.2.0'],
  );

  assert.deepEqual(
    collectInstalledVersions({
      installed: [{
        pluginId: 'nectar@beecoded-nectar',
        name: 'nectar',
        marketplaceName: 'beecoded-nectar',
        version: '1.3.0',
      }],
      available: [],
    }, {
      selector: 'nectar@beecoded-nectar',
      product: 'nectar',
      marketplaceName: 'beecoded-nectar',
    }),
    ['1.3.0'],
  );
});

test('classifies fresh, same-version, upgrade, and downgrade decisions', () => {
  assert.deepEqual(evaluateDowngrade({
    executingVersion: '1.3.0',
    installedVersions: [],
    allowDowngrade: false,
  }), {
    allowed: true,
    direction: 'fresh',
    highestInstalled: null,
  });
  assert.equal(evaluateDowngrade({
    executingVersion: '1.3.0',
    installedVersions: ['1.3.0'],
    allowDowngrade: false,
  }).direction, 'same');
  assert.equal(evaluateDowngrade({
    executingVersion: '1.3.0',
    installedVersions: ['1.2.0'],
    allowDowngrade: false,
  }).direction, 'upgrade');

  const rejected = evaluateDowngrade({
    executingVersion: '1.2.0',
    installedVersions: ['1.3.0', '1.1.0'],
    allowDowngrade: false,
  });
  assert.deepEqual(rejected, {
    allowed: false,
    direction: 'downgrade',
    highestInstalled: '1.3.0',
  });
  assert.equal(evaluateDowngrade({
    executingVersion: '1.2.0',
    installedVersions: ['1.3.0'],
    allowDowngrade: true,
  }).allowed, true);
});

test('parses the explicit downgrade override', () => {
  const options = parseArguments(['--all', '--allow-downgrade', '--dry-run']);
  assert.equal(options.allowDowngrade, true);
  assert.equal(options.dryRun, true);
  assert.deepEqual([...options.requestedHosts], ['claude', 'codex']);
});

test('formats package provenance with name, version, and source path', () => {
  const line = formatProvenance({
    name: '@beecoded/nectar',
    version: '1.3.0',
    packageRoot: path.resolve(currentDirectory, '..'),
  });

  assert.match(line, /@beecoded\/nectar@1\.3\.0/);
  assert.match(line, /source=/);
  assert.match(line, /plugins\/nectar/);
});

test('keeps Nectar project state in the effective global Git excludes file', () => {
  assert.equal(typeof installerModule.ensureNectarGitIgnore, 'function');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-global-ignore-'));
  try {
    const home = path.join(root, 'home');
    const xdg = path.join(root, 'xdg');
    const ignoreFile = path.join(xdg, 'git', 'ignore');
    fs.mkdirSync(path.dirname(ignoreFile), { recursive: true });
    fs.writeFileSync(ignoreFile, '*.local\n');
    const messages = [];
    const missingGlobalConfig = () => ({ status: 1, stdout: '', stderr: '' });

    const added = installerModule.ensureNectarGitIgnore({
      env: { XDG_CONFIG_HOME: xdg },
      home,
      spawn: missingGlobalConfig,
      log: (message) => messages.push(message),
    });
    assert.deepEqual(added, { status: 'added', file: ignoreFile });
    assert.equal(fs.readFileSync(ignoreFile, 'utf8'), '*.local\n.nectar/\n');

    const present = installerModule.ensureNectarGitIgnore({
      env: { XDG_CONFIG_HOME: xdg },
      home,
      spawn: missingGlobalConfig,
      log: (message) => messages.push(message),
    });
    assert.deepEqual(present, { status: 'present', file: ignoreFile });
    assert.equal(
      fs.readFileSync(ignoreFile, 'utf8').split('\n').filter((line) => line === '.nectar/').length,
      1,
    );
    assert.ok(messages.some((message) => message.includes('configured global Git ignore')));
    assert.ok(messages.some((message) => message.includes('already ignores .nectar/')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('respects core.excludesFile and previews global ignore changes without writing', () => {
  assert.equal(typeof installerModule.ensureNectarGitIgnore, 'function');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-configured-ignore-'));
  try {
    const configuredFile = path.join(root, 'custom', 'global-ignore');
    const messages = [];
    const configuredGlobalFile = () => ({
      status: 0,
      stdout: `${configuredFile}\n`,
      stderr: '',
    });

    const preview = installerModule.ensureNectarGitIgnore({
      env: {},
      home: path.join(root, 'home'),
      spawn: configuredGlobalFile,
      dryRun: true,
      log: (message) => messages.push(message),
    });
    assert.deepEqual(preview, { status: 'would-add', file: configuredFile });
    assert.equal(fs.existsSync(configuredFile), false);
    assert.ok(messages.some((message) => (
      message.includes('would configure global Git ignore')
      && message.includes(configuredFile)
    )));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('routes Nectar reliability subcommands without exposing them through Bee', () => {
  assert.deepEqual(resolveProductCommand({
    product: 'nectar',
    argv: ['doctor', '../project', '--json'],
  }), {
    script: 'scripts/run-doctor.mjs',
    args: ['../project', '--json'],
  });
  assert.deepEqual(resolveProductCommand({
    product: 'nectar',
    argv: ['eval', '--codex', '--dry-run'],
  }), {
    script: 'scripts/run-behavioral-evals.mjs',
    args: ['--codex', '--dry-run'],
  });
  assert.deepEqual(resolveProductCommand({
    product: 'nectar',
    argv: ['atlas', 'find-symbol', 'OrderService', '--json'],
  }), {
    script: 'scripts/run-atlas.mjs',
    args: ['find-symbol', 'OrderService', '--json'],
  });
  assert.equal(resolveProductCommand({
    product: 'bee',
    argv: ['doctor'],
  }), null);
  assert.equal(resolveProductCommand({
    product: 'nectar',
    argv: ['--all'],
  }), null);
});

test('resolves standalone user skill roots for Claude and Codex', () => {
  const environment = {
    CLAUDE_CONFIG_DIR: '/tmp/custom-claude',
    CODEX_HOME: '/tmp/custom-codex',
  };
  assert.equal(
    resolveSkillsRoot('claude', { env: environment, home: '/tmp/home' }),
    path.resolve('/tmp/custom-claude/skills'),
  );
  assert.equal(
    resolveSkillsRoot('codex', { env: environment, home: '/tmp/home' }),
    path.resolve('/tmp/custom-codex/skills'),
  );
  assert.equal(
    resolveSkillsRoot('claude', { env: {}, home: '/tmp/home' }),
    path.resolve('/tmp/home/.claude/skills'),
  );
  assert.equal(
    resolveSkillsRoot('codex', { env: {}, home: '/tmp/home' }),
    path.resolve('/tmp/home/.codex/skills'),
  );
});

test('classifies absent, owned, and unowned standalone skills', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'beecoded-skill-owner-'));
  try {
    const skill = path.join(root, 'nectar-shape');
    assert.equal(classifyManagedSkill(skill, { packageName: '@beecoded/nectar' }), 'absent');

    fs.mkdirSync(skill);
    fs.writeFileSync(path.join(skill, 'SKILL.md'), '# User skill\n');
    assert.equal(classifyManagedSkill(skill, { packageName: '@beecoded/nectar' }), 'unowned');

    fs.writeFileSync(path.join(skill, '.beecoded-skill.json'), JSON.stringify({
      schema: 1,
      package: '@beecoded/nectar',
      skill: 'nectar-other',
    }));
    assert.equal(classifyManagedSkill(skill, { packageName: '@beecoded/nectar' }), 'unowned');

    fs.writeFileSync(path.join(skill, '.beecoded-skill.json'), JSON.stringify({
      schema: 1,
      package: '@beecoded/nectar',
      skill: 'nectar-shape',
    }));
    assert.equal(classifyManagedSkill(skill, { packageName: '@beecoded/nectar' }), 'owned');
    assert.equal(classifyManagedSkill(skill, { packageName: '@beecoded/bee' }), 'unowned');

    const externalMarker = path.join(root, 'external-marker.json');
    fs.writeFileSync(externalMarker, JSON.stringify({
      schema: 1,
      package: '@beecoded/nectar',
      skill: 'nectar-shape',
    }));
    fs.rmSync(path.join(skill, '.beecoded-skill.json'));
    fs.symlinkSync(externalMarker, path.join(skill, '.beecoded-skill.json'));
    assert.equal(classifyManagedSkill(skill, { packageName: '@beecoded/nectar' }), 'unowned');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('keeps a public skill equal to its product id without double-prefixing it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'beecoded-exact-product-skill-'));
  try {
    const packageRoot = path.join(root, 'package');
    const sourceRoot = path.join(packageRoot, 'internal-skills');
    const source = path.join(sourceRoot, 'code-audit');
    const skillsRoot = path.join(root, 'host-skills');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'SKILL.md'), '---\nname: code-audit\n---\nAudit.\n');

    const installed = installManagedSkills({
      sourceRoot,
      skillsRoot,
      packageName: '@beecoded/code-audit',
      packageVersion: '0.1.0',
      packageRoot,
    });

    assert.deepEqual(installed, ['code-audit']);
    assert.equal(
      classifyManagedSkill(path.join(skillsRoot, 'code-audit'), {
        packageName: '@beecoded/code-audit',
      }),
      'owned',
    );
    assert.equal(fs.existsSync(path.join(skillsRoot, 'code-audit-code-audit')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('renders a prefixed managed skill with package provenance and absolute references', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'beecoded-skill-render-'));
  try {
    const legacyName = ['nectar', 'shape'].join(':');
    const packageRoot = path.join(root, 'package');
    const source = path.join(packageRoot, 'skills', 'shape');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(path.join(packageRoot, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'agents', 'lens.md'), '# Lens\n');
    fs.writeFileSync(path.join(source, 'SKILL.md'), `---
name: shape
description: Use /${legacyName} or $${legacyName}.
---

Read [lens](../../agents/lens.md) and load \`../../agents/lens.md\`.
`);

    const rendered = renderManagedSkill({
      sourceDirectory: source,
      entryName: 'nectar-shape',
      packageName: '@beecoded/nectar',
      packageVersion: '2.0.0',
      packageRoot,
    });

    assert.match(rendered.skill, /^name: nectar-shape$/m);
    assert.doesNotMatch(rendered.skill, new RegExp(legacyName));
    assert.match(rendered.skill, /nectar-shape/);
    assert.match(rendered.skill, new RegExp(path.join(packageRoot, 'agents', 'lens.md')));
    assert.doesNotMatch(rendered.skill, /\.\.\/\.\.\/agents\/lens\.md/);
    assert.deepEqual(rendered.ownership, {
      schema: 1,
      package: '@beecoded/nectar',
      version: '2.0.0',
      skill: 'nectar-shape',
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('renders executable nectar-context commands for either host with durable references', () => {
  const packageRoot = path.resolve(currentDirectory, '..');
  const sourceDirectory = path.join(
    packageRoot,
    'internal-skills/nectar-context',
  );
  const installedPackageRoot = packageRoot;

  for (const host of ['claude', 'codex']) {
    const rendered = renderManagedSkill({
      sourceDirectory,
      entryName: 'nectar-context',
      packageName: '@beecoded/nectar',
      packageVersion: '2.2.0',
      packageRoot,
      installedPackageRoot,
    });

    assert.match(rendered.skill, /^name: nectar-context$/m, host);
    assert.match(
      rendered.skill,
      new RegExp(path.join(installedPackageRoot, 'scripts/run-context.mjs')),
      host,
    );
    assert.match(
      rendered.skill,
      new RegExp(path.join(installedPackageRoot, 'agents/context-builder.md')),
      host,
    );
    assert.doesNotMatch(rendered.skill, /\.\.\/\.\.\/(?:scripts|agents)\//, host);
    assert.doesNotMatch(rendered.skill, /node\s+`[^`]*run-context\.mjs`/, host);

    const statusCommand = rendered.skill.match(/```bash\n([^\n]*run-context\.mjs[^\n]*status[^\n]*)\n```/);
    assert.ok(statusCommand, `missing rendered status command for ${host}`);
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-rendered-command-'));
    try {
      const executed = spawnSync('/bin/sh', ['-c', statusCommand[1]], {
        cwd: projectRoot,
        encoding: 'utf8',
      });
      assert.equal(executed.status, 0, `${host}: ${executed.stderr}`);
      assert.match(executed.stdout, /state: missing/);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  }
});

test('preflights every skill before install and removes only owned entries', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'beecoded-skill-lifecycle-'));
  try {
    const sourceRoot = path.join(root, 'source');
    const skillsRoot = path.join(root, 'home-skills');
    for (const name of ['nectar-shape', 'nectar-plan']) {
      const directory = path.join(sourceRoot, name);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: Test\n---\n`);
    }

    const collision = path.join(skillsRoot, 'nectar-plan');
    fs.mkdirSync(collision, { recursive: true });
    fs.writeFileSync(path.join(collision, 'SKILL.md'), '# Mine\n');

    assert.throws(() => preflightManagedSkills({
      sourceRoot,
      skillsRoot,
      packageName: '@beecoded/nectar',
    }), new RegExp(collision));
    assert.equal(fs.existsSync(path.join(skillsRoot, 'nectar-shape')), false);

    fs.rmSync(collision, { recursive: true, force: true });
    installManagedSkills({
      sourceRoot,
      skillsRoot,
      packageName: '@beecoded/nectar',
      packageVersion: '2.0.0',
      packageRoot: root,
    });
    assert.equal(
      classifyManagedSkill(path.join(skillsRoot, 'nectar-shape'), {
        packageName: '@beecoded/nectar',
      }),
      'owned',
    );

    const userSkill = path.join(skillsRoot, 'nectar-user');
    fs.mkdirSync(userSkill);
    fs.writeFileSync(path.join(userSkill, 'SKILL.md'), '# User\n');
    removeManagedSkills({ skillsRoot, packageName: '@beecoded/nectar' });
    assert.equal(fs.existsSync(path.join(skillsRoot, 'nectar-shape')), false);
    assert.equal(fs.existsSync(userSkill), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
