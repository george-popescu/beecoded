#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = path.join(repoRoot, 'plugins', 'nectar');
const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-atlas-release-'));

const ENVIRONMENT_ALLOWLIST = [
  'PATH',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'NO_COLOR',
];

function environment(overrides = {}) {
  const result = {};
  for (const name of ENVIRONMENT_ALLOWLIST) {
    if (process.env[name] !== undefined) result[name] = process.env[name];
  }
  return { ...result, ...overrides };
}

function run(command, args, {
  cwd = repoRoot,
  env,
  allowFailure = false,
} = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 240_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!allowFailure) {
    assert.equal(
      result.status,
      0,
      `${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout || result.error?.message || ''}`,
    );
  }
  return result;
}

function jsonRun(command, args, options) {
  const result = run(command, args, options);
  try {
    return JSON.parse(result.stdout);
  } catch {
    assert.fail(
      `${command} ${args.join(' ')} did not return JSON:\n${result.stdout}\n${result.stderr}`,
    );
  }
}

function write(root, relativePath, content) {
  const destination = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content);
}

function managedSkillNames(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => (
      entry.isDirectory()
      && entry.name.startsWith('nectar-')
      && fs.existsSync(path.join(root, entry.name, '.beecoded-skill.json'))
    ))
    .map((entry) => entry.name)
    .sort();
}

try {
  const home = path.join(temporaryRoot, 'home');
  const codexHome = path.join(home, '.codex');
  const claudeHome = path.join(home, '.claude');
  const beecodedHome = path.join(home, '.beecoded');
  const globalPrefix = path.join(temporaryRoot, 'global');
  const packageDirectory = path.join(temporaryRoot, 'package');
  const projectRoot = path.join(temporaryRoot, 'project');
  fs.mkdirSync(packageDirectory, { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(codexHome, { recursive: true });
  fs.mkdirSync(claudeHome, { recursive: true });
  fs.mkdirSync(beecodedHome, { recursive: true });
  fs.mkdirSync(globalPrefix, { recursive: true });

  run('git', ['init', '-q'], { cwd: projectRoot, env: environment({ HOME: home }) });
  run('git', ['config', 'user.email', 'atlas-release@example.test'], {
    cwd: projectRoot,
    env: environment({ HOME: home }),
  });
  run('git', ['config', 'user.name', 'Atlas Release'], {
    cwd: projectRoot,
    env: environment({ HOME: home }),
  });
  for (let index = 0; index < 120; index += 1) {
    write(
      projectRoot,
      `src/module-${String(index).padStart(4, '0')}.ts`,
      `export const releaseValue${index} = ${index};\n`,
    );
  }
  write(
    projectRoot,
    'src/release-target.ts',
    'export class AtlasReleaseTarget { run() { return true; } }\n',
  );
  write(
    projectRoot,
    'src/release-target.test.ts',
    'import { AtlasReleaseTarget } from "./release-target";\n'
      + 'export const releaseTest = () => new AtlasReleaseTarget().run();\n',
  );
  run('git', ['add', '.'], { cwd: projectRoot, env: environment({ HOME: home }) });
  run('git', ['commit', '-qm', 'release fixture'], {
    cwd: projectRoot,
    env: environment({ HOME: home }),
  });

  const isolatedEnv = environment({
    HOME: home,
    CODEX_HOME: codexHome,
    CLAUDE_CONFIG_DIR: claudeHome,
    BEECODED_HOME: beecodedHome,
    NPM_CONFIG_CACHE: path.join(temporaryRoot, 'npm-cache'),
  });
  run('npm', [
    'pack',
    '--workspace',
    pkg.name,
    '--pack-destination',
    packageDirectory,
    '--ignore-scripts',
  ], { env: isolatedEnv });
  const archive = path.join(
    packageDirectory,
    `beecoded-nectar-${pkg.version}.tgz`,
  );
  assert.ok(fs.existsSync(archive), 'Nectar tarball must be created');

  run('npm', [
    'install',
    '--global',
    '--prefix',
    globalPrefix,
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    archive,
  ], { env: isolatedEnv });
  const globalBin = path.join(globalPrefix, process.platform === 'win32' ? '' : 'bin');
  const runnerEnv = {
    ...isolatedEnv,
    PATH: `${globalBin}${path.delimiter}${isolatedEnv.PATH}`,
  };
  const nectar = process.platform === 'win32'
    ? path.join(globalBin, 'nectar.cmd')
    : path.join(globalBin, 'nectar');

  const install = run(nectar, ['install', '--all'], { env: runnerEnv });
  assert.match(install.stdout, /updated for Claude Code|installed for Claude Code/);
  assert.match(install.stdout, /updated for Codex|installed for Codex/);
  assert.equal(managedSkillNames(path.join(claudeHome, 'skills')).length, 10);
  assert.equal(managedSkillNames(path.join(codexHome, 'skills')).length, 10);

  const claudePlugins = run('claude', ['plugin', 'list', '--json'], {
    env: runnerEnv,
  }).stdout;
  const codexPlugins = run('codex', ['plugin', 'list', '--json'], {
    env: runnerEnv,
  }).stdout;
  const claudeMcp = run('claude', ['mcp', 'list'], { env: runnerEnv }).stdout;
  const codexMcp = run('codex', ['mcp', 'list'], { env: runnerEnv }).stdout;
  for (const output of [claudePlugins, codexPlugins]) {
    assert.match(output, /nectar@beecoded-nectar/);
    assert.match(output, new RegExp(pkg.version.replaceAll('.', '\\.')));
  }
  assert.match(claudeMcp, /nectar-atlas[\s\S]*Connected/i);
  assert.match(codexMcp, /nectar-atlas[\s\S]*enabled/i);

  const status = jsonRun(nectar, [
    'atlas',
    'status',
    '--path',
    projectRoot,
    '--json',
  ], { env: runnerEnv });
  assert.equal(status.preference.effective, 'disabled');
  assert.equal(status.prompt.required, true);
  assert.equal(status.index.code, 'ATLAS_INDEX_ABSENT');

  const enabled = jsonRun(nectar, [
    'atlas',
    'enable',
    '--path',
    projectRoot,
    '--json',
  ], { env: runnerEnv });
  assert.equal(enabled.state, 'enabled');
  assert.equal(enabled.index.state, 'indexed');

  const query = jsonRun(nectar, [
    'atlas',
    'find-symbol',
    'AtlasReleaseTarget',
    '--path',
    projectRoot,
    '--json',
  ], { env: runnerEnv });
  assert.equal(query.state, 'ready');
  assert.equal(query.fallback, false);
  assert.ok(query.evidence.some((entry) => (
    entry.path === 'src/release-target.ts'
    && entry.name === 'AtlasReleaseTarget'
  )));

  const refreshed = jsonRun(nectar, [
    'atlas',
    'refresh',
    '--path',
    projectRoot,
    '--json',
  ], { env: runnerEnv });
  assert.equal(refreshed.state, 'indexed');
  assert.equal(refreshed.writeResult.filesWritten, 0);
  assert.ok(refreshed.summary.counts.reused >= 122);

  const disabled = jsonRun(nectar, [
    'atlas',
    'disable',
    '--path',
    projectRoot,
    '--json',
  ], { env: runnerEnv });
  assert.equal(disabled.effective, 'disabled');
  const cleared = jsonRun(nectar, [
    'atlas',
    'clear',
    '--path',
    projectRoot,
    '--json',
  ], { env: runnerEnv });
  assert.equal(cleared.state, 'cleared');
  assert.equal(cleared.removed, true);

  run(nectar, ['uninstall', '--all'], { env: runnerEnv });
  assert.equal(managedSkillNames(path.join(claudeHome, 'skills')).length, 0);
  assert.equal(managedSkillNames(path.join(codexHome, 'skills')).length, 0);
  const claudeAfter = run('claude', ['plugin', 'list', '--json'], {
    env: runnerEnv,
  }).stdout;
  const codexAfter = run('codex', ['plugin', 'list', '--json'], {
    env: runnerEnv,
  }).stdout;
  assert.doesNotMatch(claudeAfter, /nectar@beecoded-nectar/);
  assert.doesNotMatch(codexAfter, /nectar@beecoded-nectar/);

  console.log(
    `Atlas release smoke passed: ${pkg.name}@${pkg.version}; `
    + 'packed install, both hosts, MCP, prompt, index, query, warm refresh, '
    + 'disable, clear, and uninstall',
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
