#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
const product = pkg.name.split('/').at(-1);
const displayName = product.charAt(0).toUpperCase() + product.slice(1);
const marketplaceName = `beecoded-${product}`;
const selector = `${product}@${marketplaceName}`;
const beecodedHome = path.resolve(process.env.BEECODED_HOME || path.join(os.homedir(), '.beecoded'));
const managedProductRoot = path.join(beecodedHome, 'marketplaces', product);

function managedRootForHost(host) {
  if (host !== 'claude' && host !== 'codex') {
    throw new Error(`Unsupported coding host: ${host}`);
  }
  return path.join(managedProductRoot, host);
}

function usage() {
  console.log(`${displayName} ${pkg.version}

Install ${displayName} for every supported coding host found in PATH.

Usage:
  ${product} [install] [--claude | --codex | --all]
  ${product} uninstall [--claude | --codex | --all]
${product === 'nectar' ? `  ${product} doctor [path] [--json]
  ${product} eval [--claude | --codex | --all] [--case <glob>]` : ''}

Options:
  --claude       Target Claude Code only
  --codex        Target Codex only
  --all          Target both Claude Code and Codex
  --uninstall    Remove the plugin (same as the uninstall command)
  --allow-downgrade
                 Permit replacing a newer installed version with this package
  --dry-run      Show the actions without changing anything
  --global       Accepted for GSD-style compatibility; user scope is already the default
  -v, --version  Print the package version
  -h, --help     Show this help

Environment:
  BEECODED_HOME  Override the managed plugin data directory (default: ~/.beecoded)`);
}

function fail(message, code = 1) {
  console.error(`[${product}] ${message}`);
  process.exit(code);
}

export function parseArguments(argv) {
  const options = {
    action: 'install',
    allowDowngrade: false,
    dryRun: false,
    explicitHosts: false,
    requestedHosts: new Set(),
  };

  for (const argument of argv) {
    if (argument === 'install' || argument === '--install') {
      options.action = 'install';
    } else if (argument === 'uninstall' || argument === 'remove' || argument === '--uninstall') {
      options.action = 'uninstall';
    } else if (argument === '--claude') {
      options.explicitHosts = true;
      options.requestedHosts.add('claude');
    } else if (argument === '--codex') {
      options.explicitHosts = true;
      options.requestedHosts.add('codex');
    } else if (argument === '--all') {
      options.explicitHosts = true;
      options.requestedHosts.add('claude');
      options.requestedHosts.add('codex');
    } else if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--allow-downgrade') {
      options.allowDowngrade = true;
    } else if (argument === '--global') {
      // Both hosts install plugins in user scope by default.
    } else if (argument === '--help' || argument === '-h') {
      usage();
      process.exit(0);
    } else if (argument === '--version' || argument === '-v') {
      console.log(pkg.version);
      process.exit(0);
    } else {
      fail(`Unknown argument: ${argument}\nRun ${product} --help for usage.`, 2);
    }
  }

  return options;
}

function parseSemver(version) {
  const match = String(version).match(
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
  );
  if (!match) throw new Error(`Invalid semantic version: ${version}`);
  return {
    main: match.slice(1, 4),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function compareNumericIdentifier(left, right) {
  const normalizedLeft = left.replace(/^0+/, '') || '0';
  const normalizedRight = right.replace(/^0+/, '') || '0';
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length > normalizedRight.length ? 1 : -1;
  }
  if (normalizedLeft === normalizedRight) return 0;
  return normalizedLeft > normalizedRight ? 1 : -1;
}

export function compareSemver(left, right) {
  const parsedLeft = parseSemver(left);
  const parsedRight = parseSemver(right);
  for (let index = 0; index < 3; index++) {
    const comparison = compareNumericIdentifier(parsedLeft.main[index], parsedRight.main[index]);
    if (comparison !== 0) return comparison;
  }
  if (!parsedLeft.prerelease.length && !parsedRight.prerelease.length) return 0;
  if (!parsedLeft.prerelease.length) return 1;
  if (!parsedRight.prerelease.length) return -1;

  const length = Math.max(parsedLeft.prerelease.length, parsedRight.prerelease.length);
  for (let index = 0; index < length; index++) {
    const leftPart = parsedLeft.prerelease[index];
    const rightPart = parsedRight.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return compareNumericIdentifier(leftPart, rightPart);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

export function collectInstalledVersions(value, {
  selector: targetSelector,
  product: targetProduct,
  marketplaceName: targetMarketplace,
}) {
  const versions = new Set();

  function visit(candidate) {
    if (!candidate) return;
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    if (typeof candidate !== 'object') return;

    const id = candidate.id || candidate.plugin || candidate.selector || candidate.pluginId;
    const nameMatches = candidate.name === targetProduct || candidate.pluginName === targetProduct;
    const market = candidate.marketplace
      || candidate.marketplaceName
      || candidate.sourceMarketplace;
    if ((id === targetSelector || (nameMatches && market === targetMarketplace))
      && typeof candidate.version === 'string') {
      versions.add(candidate.version);
    }

    for (const nested of Object.values(candidate)) visit(nested);
  }

  visit(value);
  return [...versions].sort(compareSemver);
}

export function evaluateDowngrade({
  executingVersion,
  installedVersions,
  allowDowngrade,
}) {
  if (!installedVersions.length) {
    return { allowed: true, direction: 'fresh', highestInstalled: null };
  }
  const highestInstalled = [...installedVersions].sort(compareSemver).at(-1);
  const comparison = compareSemver(executingVersion, highestInstalled);
  return {
    allowed: comparison >= 0 || allowDowngrade,
    direction: comparison < 0 ? 'downgrade' : comparison > 0 ? 'upgrade' : 'same',
    highestInstalled,
  };
}

export function formatProvenance({ name, version, packageRoot: source }) {
  const label = name.split('/').at(-1);
  return `[${label}] executing ${name}@${version} source=${source}`;
}

export function resolveProductCommand({ product: targetProduct, argv }) {
  if (targetProduct !== 'nectar') return null;
  const [command, ...args] = argv;
  if (command === 'doctor') return { script: 'scripts/run-doctor.mjs', args };
  if (command === 'eval' || command === 'evals') {
    return { script: 'scripts/run-behavioral-evals.mjs', args };
  }
  return null;
}

const ownershipFile = '.beecoded-skill.json';

export function resolveSkillsRoot(host, {
  env = process.env,
  home = os.homedir(),
} = {}) {
  if (host === 'claude') {
    return path.resolve(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'skills');
  }
  if (host === 'codex') {
    return path.resolve(env.CODEX_HOME || path.join(home, '.codex'), 'skills');
  }
  throw new Error(`Unsupported coding host: ${host}`);
}

function readOwnership(directory) {
  const file = path.join(directory, ownershipFile);
  try {
    const marker = fs.lstatSync(file);
    if (!marker.isFile() || marker.isSymbolicLink()) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function classifyManagedSkill(directory, { packageName }) {
  let directoryStat;
  try {
    directoryStat = fs.lstatSync(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return 'absent';
    return 'unowned';
  }
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) return 'unowned';
  const entryName = path.basename(directory);
  const targetProduct = packageName.split('/').at(-1);
  if (!entryName.startsWith(`${targetProduct}-`)) return 'unowned';
  const ownership = readOwnership(directory);
  return ownership?.schema === 1
    && ownership.package === packageName
    && ownership.skill === entryName
    ? 'owned'
    : 'unowned';
}

function sourceSkillEntries(sourceRoot, packageName) {
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`Managed skill source is missing: ${sourceRoot}`);
  }
  const targetProduct = packageName.split('/').at(-1);
  return fs.readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()
      && fs.existsSync(path.join(sourceRoot, entry.name, 'SKILL.md')))
    .map((entry) => ({
      sourceDirectory: path.join(sourceRoot, entry.name),
      entryName: entry.name.startsWith(`${targetProduct}-`)
        ? entry.name
        : `${targetProduct}-${entry.name}`,
    }))
    .sort((left, right) => left.entryName.localeCompare(right.entryName));
}

function replaceActiveInvocationNames(content, targetProduct) {
  return content
    .replaceAll(`/${targetProduct}:`, `/${targetProduct}-`)
    .replaceAll(`$${targetProduct}:`, `$${targetProduct}-`);
}

function absoluteSkillReferences(content, sourceDirectory, sourcePackageRoot, installedPackageRoot) {
  const installedReference = (relative) => {
    const sourceTarget = path.resolve(sourceDirectory, relative);
    return path.join(
      installedPackageRoot,
      path.relative(sourcePackageRoot, sourceTarget),
    );
  };

  return content
    .replace(
      /(\]\()((?:\.\.\/)+[^)\s#]+)(#[^)\s]*)?(\))/g,
      (_match, open, relative, anchor = '', close) => (
        `${open}${installedReference(relative)}${anchor}${close}`
      ),
    )
    .replace(
      /(`)((?:\.\.\/)+[^`\s#]+)(#[^`\s]*)?(`)/g,
      (_match, open, relative, anchor = '', close) => (
        `${open}${installedReference(relative)}${anchor}${close}`
      ),
    );
}

export function renderManagedSkill({
  sourceDirectory,
  entryName,
  packageName,
  packageVersion,
  packageRoot: sourcePackageRoot,
  installedPackageRoot = sourcePackageRoot,
}) {
  const targetProduct = packageName.split('/').at(-1);
  const source = fs.readFileSync(path.join(sourceDirectory, 'SKILL.md'), 'utf8');
  let skill = source.match(/^name:/m)
    ? source.replace(/^name:\s*.+$/m, `name: ${entryName}`)
    : source.replace(/^---\n/, `---\nname: ${entryName}\n`);
  skill = absoluteSkillReferences(
    replaceActiveInvocationNames(skill, targetProduct),
    sourceDirectory,
    sourcePackageRoot,
    installedPackageRoot,
  );

  if (targetProduct === 'bee') {
    const preamble = `\n## Installed package location\n\n`
      + `This skill is managed by ${packageName}@${packageVersion}. Treat `
      + `\`${installedPackageRoot}\` as \`CLAUDE_PLUGIN_ROOT\` whenever the canonical workflow `
      + 'uses that variable, on both Claude Code and Codex.\n';
    skill = skill.replace(/\n---\n/, `\n---\n${preamble}`);
  }

  return {
    skill,
    ownership: {
      schema: 1,
      package: packageName,
      version: packageVersion,
      skill: entryName,
    },
  };
}

export function preflightManagedSkills({
  sourceRoot,
  skillsRoot,
  packageName,
  packageVersion = '0.0.0',
  packageRoot: sourcePackageRoot = path.dirname(sourceRoot),
  installedPackageRoot = sourcePackageRoot,
}) {
  const entries = sourceSkillEntries(sourceRoot, packageName);
  if (!entries.length) throw new Error(`No managed skills found in ${sourceRoot}`);

  for (const entry of entries) {
    const destination = path.join(skillsRoot, entry.entryName);
    if (classifyManagedSkill(destination, { packageName }) === 'unowned') {
      throw new Error(`Refusing to overwrite unowned skill: ${destination}`);
    }
    renderManagedSkill({
      ...entry,
      packageName,
      packageVersion,
      packageRoot: sourcePackageRoot,
      installedPackageRoot,
    });
  }
  return entries;
}

export function installManagedSkills({
  sourceRoot,
  skillsRoot,
  packageName,
  packageVersion,
  packageRoot: sourcePackageRoot,
  installedPackageRoot = sourcePackageRoot,
}) {
  const entries = preflightManagedSkills({
    sourceRoot,
    skillsRoot,
    packageName,
    packageVersion,
    packageRoot: sourcePackageRoot,
    installedPackageRoot,
  });
  fs.mkdirSync(skillsRoot, { recursive: true });

  for (const entry of entries) {
    const destination = path.join(skillsRoot, entry.entryName);
    const temporary = path.join(skillsRoot, `.${entry.entryName}.tmp-${process.pid}-${Date.now()}`);
    const backup = path.join(skillsRoot, `.${entry.entryName}.backup-${process.pid}`);
    fs.rmSync(temporary, { recursive: true, force: true });
    fs.rmSync(backup, { recursive: true, force: true });

    const rendered = renderManagedSkill({
      ...entry,
      packageName,
      packageVersion,
      packageRoot: sourcePackageRoot,
      installedPackageRoot,
    });
    fs.cpSync(entry.sourceDirectory, temporary, { recursive: true });
    fs.writeFileSync(path.join(temporary, 'SKILL.md'), rendered.skill);
    fs.writeFileSync(
      path.join(temporary, ownershipFile),
      `${JSON.stringify(rendered.ownership, null, 2)}\n`,
    );

    const hadExisting = fs.existsSync(destination);
    if (hadExisting) fs.renameSync(destination, backup);
    try {
      fs.renameSync(temporary, destination);
      fs.rmSync(backup, { recursive: true, force: true });
    } catch (error) {
      fs.rmSync(temporary, { recursive: true, force: true });
      if (hadExisting && fs.existsSync(backup)) fs.renameSync(backup, destination);
      throw error;
    }
  }
  const installedNames = entries.map((entry) => entry.entryName);
  removeStaleManagedSkills({ skillsRoot, packageName, keepNames: installedNames });
  return installedNames;
}

function removeStaleManagedSkills({ skillsRoot, packageName, keepNames }) {
  if (!fs.existsSync(skillsRoot)) return [];
  const keep = new Set(keepNames);
  const removed = [];
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || keep.has(entry.name)) continue;
    const destination = path.join(skillsRoot, entry.name);
    if (classifyManagedSkill(destination, { packageName }) !== 'owned') continue;
    fs.rmSync(destination, { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed.sort();
}

export function removeManagedSkills({ skillsRoot, packageName }) {
  if (!fs.existsSync(skillsRoot)) return [];
  const removed = [];
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const destination = path.join(skillsRoot, entry.name);
    if (classifyManagedSkill(destination, { packageName }) !== 'owned') continue;
    fs.rmSync(destination, { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed.sort();
}

function commandExists(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

function formatCommand(command, args) {
  return [command, ...args].map((part) => (/^[a-zA-Z0-9_./:@=-]+$/.test(part) ? part : JSON.stringify(part))).join(' ');
}

function execute(command, args, {
  allowFailure = false,
  captureJson = false,
  dryRun = false,
  readOnly = false,
} = {}) {
  if (dryRun && !readOnly) {
    console.log(`[${product}] would run: ${formatCommand(command, args)}`);
    return captureJson ? null : true;
  }

  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error || result.status !== 0) {
    if (allowFailure) return captureJson ? null : false;
    const detail = (result.stderr || result.stdout || result.error?.message || 'unknown error').trim();
    throw new Error(`${formatCommand(command, args)} failed${detail ? `: ${detail}` : ''}`);
  }

  if (!captureJson) return true;
  const output = result.stdout.trim();
  if (!output) return null;

  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${formatCommand(command, args)} returned invalid JSON: ${output}`);
  }
}

function marketplaceEntries(host, dryRun) {
  const result = execute(host, ['plugin', 'marketplace', 'list', '--json'], {
    captureJson: true,
    dryRun,
    readOnly: true,
  });
  if (!result) return [];
  return Array.isArray(result) ? result : result.marketplaces || [];
}

function marketplacePath(entry) {
  return entry.path || entry.root || entry.installLocation || entry.marketplaceSource?.source || null;
}

function normalizedPath(value) {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function hasInstalledPlugin(value) {
  if (!value) return false;
  if (Array.isArray(value)) return value.some(hasInstalledPlugin);
  if (typeof value !== 'object') return value === selector;

  const id = value.id || value.plugin || value.selector;
  if (id === selector) return true;

  const nameMatches = value.name === product || value.pluginName === product;
  const market = value.marketplace || value.marketplaceName || value.sourceMarketplace;
  if (nameMatches && market === marketplaceName) return true;

  return Object.values(value).some(hasInstalledPlugin);
}

function pluginIsInstalled(host, dryRun) {
  const result = execute(host, ['plugin', 'list', '--json'], {
    captureJson: true,
    dryRun,
    readOnly: true,
  });
  return hasInstalledPlugin(result);
}

function installedPluginState(host, dryRun) {
  const result = execute(host, ['plugin', 'list', '--json'], {
    captureJson: true,
    dryRun,
    readOnly: true,
  });
  return {
    installed: hasInstalledPlugin(result),
    versions: collectInstalledVersions(result, {
      selector,
      product,
      marketplaceName,
    }),
  };
}

function copyPluginPayload(destination) {
  const resolvedDestination = path.resolve(destination);
  fs.cpSync(packageRoot, destination, {
    recursive: true,
    filter(source) {
      const resolvedSource = path.resolve(source);
      const destinationFromSource = path.relative(resolvedSource, resolvedDestination);
      const sourceContainsDestination = destinationFromSource === ''
        || (!destinationFromSource.startsWith(`..${path.sep}`)
          && destinationFromSource !== '..'
          && !path.isAbsolute(destinationFromSource));
      if (resolvedSource !== packageRoot && sourceContainsDestination) return false;

      const relative = path.relative(packageRoot, source);
      if (!relative) return true;
      const topLevel = relative.split(path.sep)[0];
      return topLevel !== 'node_modules' && topLevel !== '.git';
    },
  });
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function verifyManagedPayload(root, {
  expectedName,
  expectedProduct,
  expectedVersion,
}) {
  const checks = [
    {
      label: 'npm package',
      file: path.join(root, 'plugins', expectedProduct, 'package.json'),
      read(payload) {
        return payload.name === expectedName ? payload.version : `${payload.name}@${payload.version}`;
      },
    },
    {
      label: 'Claude plugin manifest',
      file: path.join(root, 'plugins', expectedProduct, '.claude-plugin', 'plugin.json'),
      read(payload) {
        return payload.name === expectedProduct ? payload.version : `${payload.name}@${payload.version}`;
      },
    },
    {
      label: 'Codex plugin manifest',
      file: path.join(root, 'plugins', expectedProduct, '.codex-plugin', 'plugin.json'),
      read(payload) {
        return payload.name === expectedProduct ? payload.version : `${payload.name}@${payload.version}`;
      },
    },
    {
      label: 'Claude marketplace entry',
      file: path.join(root, '.claude-plugin', 'marketplace.json'),
      read(payload) {
        return payload.plugins?.find((entry) => entry.name === expectedProduct)?.version;
      },
    },
    {
      label: 'Codex marketplace entry',
      file: path.join(root, '.agents', 'plugins', 'marketplace.json'),
      read(payload) {
        return payload.plugins?.find((entry) => entry.name === expectedProduct)?.version;
      },
    },
  ];

  for (const check of checks) {
    if (!fs.existsSync(check.file)) {
      throw new Error(`${check.label} is missing from the managed payload`);
    }
    const payload = JSON.parse(fs.readFileSync(check.file, 'utf8'));
    const actualVersion = check.read(payload);
    if (actualVersion !== expectedVersion) {
      throw new Error(
        `${check.label} version mismatch: expected ${expectedVersion}, found ${actualVersion || 'missing'}`,
      );
    }
  }
  return true;
}

function prepareManagedMarketplace(host, dryRun) {
  const managedRoot = managedRootForHost(host);
  if (dryRun) {
    console.log(`[${product}] would stage ${pkg.name}@${pkg.version} in ${managedRoot}`);
    return;
  }

  const temporaryRoot = `${managedRoot}.tmp-${process.pid}-${Date.now()}`;
  fs.rmSync(temporaryRoot, { recursive: true, force: true });

  try {
    copyPluginPayload(path.join(temporaryRoot, 'plugins', product));

    writeJson(path.join(temporaryRoot, '.claude-plugin', 'marketplace.json'), {
      name: marketplaceName,
      owner: {
        name: 'Beecoded',
        email: 'george.popescu@beecoded.ro',
      },
      description: `${displayName} managed npm installation`,
      plugins: [{
        name: product,
        displayName,
        description: pkg.description,
        version: pkg.version,
        source: `./plugins/${product}`,
        category: 'development',
      }],
    });

    writeJson(path.join(temporaryRoot, '.agents', 'plugins', 'marketplace.json'), {
      name: marketplaceName,
      interface: {
        displayName: `${displayName} by Beecoded`,
      },
      plugins: [{
        name: product,
        version: pkg.version,
        source: {
          source: 'local',
          path: `./plugins/${product}`,
        },
        policy: {
          installation: 'AVAILABLE',
          authentication: 'ON_INSTALL',
        },
        category: 'Productivity',
      }],
    });

    verifyManagedPayload(temporaryRoot, {
      expectedName: pkg.name,
      expectedProduct: product,
      expectedVersion: pkg.version,
    });

    fs.mkdirSync(path.dirname(managedRoot), { recursive: true });
    const backupRoot = `${managedRoot}.backup-${process.pid}`;
    fs.rmSync(backupRoot, { recursive: true, force: true });
    const hadExistingRoot = fs.existsSync(managedRoot);
    if (hadExistingRoot) fs.renameSync(managedRoot, backupRoot);

    try {
      fs.renameSync(temporaryRoot, managedRoot);
    } catch (error) {
      if (hadExistingRoot && fs.existsSync(backupRoot)) fs.renameSync(backupRoot, managedRoot);
      throw error;
    }

    fs.rmSync(backupRoot, { recursive: true, force: true });
  } catch (error) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }

  console.log(`[${product}] staged ${pkg.name}@${pkg.version} in ${managedRoot}`);
}

function ensureMarketplace(host, managedRoot, dryRun) {
  const entries = marketplaceEntries(host, dryRun);
  const existing = entries.find((entry) => entry.name === marketplaceName);
  const existingPath = existing && marketplacePath(existing);
  const samePath = existingPath && normalizedPath(existingPath) === normalizedPath(managedRoot);

  if (existing && !samePath) {
    const removeArgs = host === 'claude'
      ? ['plugin', 'marketplace', 'remove', marketplaceName, '--scope', 'user']
      : ['plugin', 'marketplace', 'remove', marketplaceName, '--json'];
    execute(host, removeArgs, { dryRun });
  }

  if (!existing || !samePath) {
    const addArgs = host === 'claude'
      ? ['plugin', 'marketplace', 'add', '--scope', 'user', managedRoot]
      : ['plugin', 'marketplace', 'add', managedRoot, '--json'];
    execute(host, addArgs, { dryRun });
  } else if (host === 'claude') {
    execute('claude', ['plugin', 'marketplace', 'update', marketplaceName], { dryRun });
  }
}

function installForClaude(managedRoot, dryRun, installed) {
  ensureMarketplace('claude', managedRoot, dryRun);
  const action = installed ? 'update' : 'install';
  execute('claude', ['plugin', action, selector, '--scope', 'user'], { dryRun });
  console.log(`[${product}] ${installed ? 'updated' : 'installed'} for Claude Code`);
}

function installForCodex(managedRoot, dryRun, installed) {
  ensureMarketplace('codex', managedRoot, dryRun);
  if (installed) {
    execute('codex', ['plugin', 'remove', selector, '--json'], { dryRun });
  }
  execute('codex', ['plugin', 'add', selector, '--json'], { dryRun });
  console.log(`[${product}] ${installed ? 'updated' : 'installed'} for Codex`);
}

function uninstallFromHost(host, dryRun) {
  const installed = pluginIsInstalled(host, dryRun);
  if (installed) {
    const removeArgs = host === 'claude'
      ? ['plugin', 'uninstall', selector, '--scope', 'user', '--yes']
      : ['plugin', 'remove', selector, '--json'];
    execute(host, removeArgs, { dryRun });
  }

  const marketplace = marketplaceEntries(host, dryRun).find((entry) => entry.name === marketplaceName);
  if (marketplace) {
    const removeMarketplaceArgs = host === 'claude'
      ? ['plugin', 'marketplace', 'remove', marketplaceName, '--scope', 'user']
      : ['plugin', 'marketplace', 'remove', marketplaceName, '--json'];
    execute(host, removeMarketplaceArgs, { dryRun });
  }

  console.log(`[${product}] removed from ${host === 'claude' ? 'Claude Code' : 'Codex'}`);
}

function main() {
const argv = process.argv.slice(2);
const productCommand = resolveProductCommand({ product, argv });
if (productCommand) {
  const result = spawnSync(
    process.execPath,
    [path.join(packageRoot, productCommand.script), ...productCommand.args],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    },
  );
  if (result.error) fail(`Could not run ${argv[0]}: ${result.error.message}`);
  process.exitCode = result.status ?? 1;
  return;
}
const options = parseArguments(argv);
console.log(formatProvenance({ name: pkg.name, version: pkg.version, packageRoot }));
const availability = {
  claude: commandExists('claude'),
  codex: commandExists('codex'),
};
const hosts = options.explicitHosts
  ? [...options.requestedHosts]
  : Object.entries(availability).filter(([, available]) => available).map(([host]) => host);

if (options.explicitHosts) {
  const missing = hosts.filter((host) => !availability[host]);
  if (missing.length) {
    fail(`Requested host CLI${missing.length > 1 ? 's are' : ' is'} not available in PATH: ${missing.join(', ')}`);
  }
}

if (!hosts.length) {
  fail('Neither Claude Code nor Codex was found in PATH. Install a supported host and run this command again.');
}

const failures = [];
const hostStates = new Map();
const sourceSkillsRoot = fs.existsSync(path.join(packageRoot, 'internal-skills'))
  ? path.join(packageRoot, 'internal-skills')
  : path.join(packageRoot, 'skills');
if (options.action === 'install') {
  const selectedVersions = [];
  for (const host of hosts) {
    try {
      const state = installedPluginState(host, options.dryRun);
      hostStates.set(host, state);
      selectedVersions.push(...state.versions);
    } catch (error) {
      fail(`Could not inspect installed ${displayName} versions for ${host}: ${error.message}`);
    }
  }
  const downgrade = evaluateDowngrade({
    executingVersion: pkg.version,
    installedVersions: selectedVersions,
    allowDowngrade: options.allowDowngrade,
  });
  if (!downgrade.allowed) {
    fail(
      `Refusing to replace installed ${displayName} ${downgrade.highestInstalled} with older ${pkg.version}. `
      + 'Re-run with --allow-downgrade to confirm.',
    );
  }
  for (const host of hosts) {
    const skillsRoot = resolveSkillsRoot(host);
    const managedPackageRoot = path.join(managedRootForHost(host), 'plugins', product);
    try {
      preflightManagedSkills({
        sourceRoot: sourceSkillsRoot,
        skillsRoot,
        packageName: pkg.name,
        packageVersion: pkg.version,
        packageRoot,
        installedPackageRoot: managedPackageRoot,
      });
    } catch (error) {
      fail(`Could not install prefixed skills: ${error.message}`);
    }
  }
  try {
    for (const host of hosts) prepareManagedMarketplace(host, options.dryRun);
  } catch (error) {
    fail(`Could not stage the managed plugin: ${error.message}`);
  }
}

for (const host of hosts) {
  try {
    const managedRoot = managedRootForHost(host);
    if (options.action === 'install') {
      if (host === 'claude') {
        installForClaude(managedRoot, options.dryRun, hostStates.get(host)?.installed || false);
      } else {
        installForCodex(managedRoot, options.dryRun, hostStates.get(host)?.installed || false);
      }
      const skillsRoot = resolveSkillsRoot(host);
      const managedPackageRoot = path.join(managedRoot, 'plugins', product);
      const managedSourceSkillsRoot = path.join(
        managedPackageRoot,
        path.basename(sourceSkillsRoot),
      );
      if (options.dryRun) {
        console.log(`[${product}] would install prefixed skills in ${skillsRoot}`);
      } else {
        installManagedSkills({
          sourceRoot: managedSourceSkillsRoot,
          skillsRoot,
          packageName: pkg.name,
          packageVersion: pkg.version,
          packageRoot: managedPackageRoot,
          installedPackageRoot: managedPackageRoot,
        });
      }
    } else {
      uninstallFromHost(host, options.dryRun);
      const skillsRoot = resolveSkillsRoot(host);
      if (options.dryRun) {
        console.log(`[${product}] would remove owned prefixed skills from ${skillsRoot}`);
      } else {
        removeManagedSkills({ skillsRoot, packageName: pkg.name });
        fs.rmSync(managedRoot, { recursive: true, force: true });
      }
    }
  } catch (error) {
    failures.push(`${host}: ${error.message}`);
    console.error(`[${product}] ${host} failed: ${error.message}`);
  }
}

if (options.action === 'uninstall' && !failures.length && !options.dryRun) {
  try {
    if (fs.existsSync(managedProductRoot) && fs.readdirSync(managedProductRoot).length === 0) {
      fs.rmdirSync(managedProductRoot);
    }
  } catch {
    // Keep non-empty legacy or host data in place.
  }
}

if (failures.length) {
  fail(`Completed with ${failures.length} host failure${failures.length > 1 ? 's' : ''}.`);
}

if (options.action === 'install') {
  console.log(`[${product}] done. Restart the active coding host to load ${displayName}.`);
} else {
  console.log(`[${product}] uninstall complete.`);
}
}

function normalizedEntryPath(value) {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

if (process.argv[1]
  && normalizedEntryPath(process.argv[1]) === normalizedEntryPath(fileURLToPath(import.meta.url))) {
  main();
}
