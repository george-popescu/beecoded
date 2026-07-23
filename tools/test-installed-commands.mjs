#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');
const unexpected = process.argv.slice(2).filter((argument) => argument !== '--dry-run');
if (unexpected.length) {
  console.error(`Unknown argument: ${unexpected[0]}`);
  process.exit(2);
}

const ENVIRONMENT_ALLOWLIST = [
  'PATH',
  'HOME',
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

function childEnvironment(overrides = {}) {
  const environment = {};
  for (const name of ENVIRONMENT_ALLOWLIST) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  return { ...environment, ...overrides };
}

function commandExists(command) {
  const result = spawnSync(command, ['--version'], {
    env: childEnvironment(),
    stdio: 'ignore',
  });
  return !result.error && result.status === 0;
}

function run(command, args, {
  cwd = repoRoot,
  env = childEnvironment(),
  timeout = 240_000,
} = {}) {
  if (dryRun) {
    console.log(`[installed-command-smoke] would run: ${command} ${args.join(' ')}`);
    return '';
  }
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout || result.error?.message || ''}`,
  );
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

for (const command of ['claude', 'codex', 'npm']) {
  assert.ok(commandExists(command), `${command} must be available in PATH`);
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'beecoded-installed-command-smoke-'));
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
function stopOnSignal(signal, exitCode) {
  process.once(signal, () => {
    cleanup();
    process.exit(exitCode);
  });
}
stopOnSignal('SIGINT', 130);
stopOnSignal('SIGTERM', 143);
process.once('exit', cleanup);

const projectRoot = path.join(temporaryRoot, 'project');
const claudeProjectConfig = path.join(projectRoot, '.claude');
const codexHome = path.join(temporaryRoot, 'codex');
const beecodedHome = path.join(temporaryRoot, 'beecoded');
const packageDirectory = path.join(temporaryRoot, 'packages');
const globalPrefix = path.join(temporaryRoot, 'global');
const originalCodexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

try {
  fs.mkdirSync(path.join(projectRoot, 'docs', 'work', '2026-07-17-command-smoke'), { recursive: true });
  fs.mkdirSync(claudeProjectConfig, { recursive: true });
  fs.mkdirSync(codexHome, { recursive: true });
  fs.mkdirSync(packageDirectory, { recursive: true });
  fs.mkdirSync(globalPrefix, { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, 'docs', 'work', '2026-07-17-command-smoke', 'design.md'),
    '# Installed Command Smoke\n\n## Problem\nVerify installed skill invocation.\n',
  );
  run('git', ['init', '-q'], { cwd: projectRoot });

  const sourceAuth = path.join(originalCodexHome, 'auth.json');
  const targetAuth = path.join(codexHome, 'auth.json');
  if (!dryRun) {
    assert.ok(
      fs.existsSync(sourceAuth),
      'Codex auth.json is required for the opt-in installed-command smoke',
    );
    fs.copyFileSync(sourceAuth, targetAuth);
    fs.chmodSync(targetAuth, 0o600);
  }

  const installEnv = childEnvironment({
    BEECODED_HOME: beecodedHome,
    CLAUDE_CONFIG_DIR: claudeProjectConfig,
    CODEX_HOME: codexHome,
  });
  const packageArchives = [];
  for (const product of ['bee', 'nectar']) {
    const packageManifest = JSON.parse(fs.readFileSync(
      path.join(repoRoot, 'plugins', product, 'package.json'),
      'utf8',
    ));
    run('npm', [
      'pack',
      '--workspace',
      packageManifest.name,
      '--pack-destination',
      packageDirectory,
      '--ignore-scripts',
    ], { env: installEnv });
    const archive = path.join(
      packageDirectory,
      `beecoded-${product}-${packageManifest.version}.tgz`,
    );
    if (!dryRun) assert.ok(fs.existsSync(archive), `npm pack must create ${path.basename(archive)}`);
    packageArchives.push(archive);
  }
  run('npm', [
    'install',
    '--global',
    '--prefix',
    globalPrefix,
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    ...packageArchives,
  ], { env: installEnv });

  const globalBin = path.join(globalPrefix, process.platform === 'win32' ? '' : 'bin');
  const runnerEnv = {
    ...installEnv,
    PATH: `${globalBin}${path.delimiter}${installEnv.PATH}`,
  };
  for (const product of ['bee', 'nectar']) {
    run(product, ['--all'], { env: runnerEnv });
  }

  const claudeArgs = (prompt) => [
    '-p',
    prompt,
    '--setting-sources',
    'project',
    '--add-dir',
    beecodedHome,
    '--model',
    process.env.BEECODED_CLAUDE_SMOKE_MODEL || 'haiku',
    '--max-budget-usd',
    process.env.BEECODED_CLAUDE_SMOKE_BUDGET || '0.50',
    '--permission-mode',
    'dontAsk',
    '--allowedTools',
    'Read,Glob,Grep,Bash(git log *),Bash(git status *)',
    '--no-session-persistence',
  ];
  const claudeBee = run('claude', claudeArgs('/bee-help plan-phase'), {
    cwd: projectRoot,
    env: childEnvironment(),
  });
  const claudeNectar = run('claude', claudeArgs('/nectar-orient'), {
    cwd: projectRoot,
    env: childEnvironment(),
  });

  const codexArgs = (prompt) => [
    'exec',
    '-C',
    projectRoot,
    '--add-dir',
    beecodedHome,
    '--ephemeral',
    '-s',
    'read-only',
    '--color',
    'never',
    '-c',
    'model_reasoning_effort="low"',
    prompt,
  ];
  const codexEnv = childEnvironment({ CODEX_HOME: codexHome });
  const codexBee = run('codex', codexArgs('$bee-help plan-phase'), {
    cwd: projectRoot,
    env: codexEnv,
  });
  const codexNectar = run('codex', codexArgs('$nectar-orient'), {
    cwd: projectRoot,
    env: codexEnv,
  });

  if (!dryRun) {
    for (const [host, output] of [
      ['Claude', claudeBee],
      ['Codex', codexBee],
    ]) {
      assert.match(output, /bee-plan-phase/i, `${host} must execute the installed Bee help workflow`);
      assert.match(output, /Description:/i, `${host} must return Bee command details`);
    }
    for (const [host, output] of [
      ['Claude', claudeNectar],
      ['Codex', codexNectar],
    ]) {
      assert.match(output, /designed, needs plan/i, `${host} must derive the Nectar topic status`);
      assert.match(output, /nectar-plan|plan skill/i, `${host} must propose the Nectar plan skill`);
    }
    console.log('Installed command smoke passed: /bee-help + /nectar-orient on Claude, $bee-help + $nectar-orient on Codex');
  }
} finally {
  cleanup();
}
