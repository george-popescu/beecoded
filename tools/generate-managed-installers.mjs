#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listProductDefinitions } from './plugin-products.mjs';

const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(toolsRoot, '..');
const defaultTemplate = path.join(toolsRoot, 'templates', 'managed-plugin-install.mjs');

function writeAtomically(destination, content) {
  const directory = path.dirname(destination);
  const temporary = path.join(directory, `.install.mjs.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(temporary, content, { mode: 0o755, flag: 'wx' });
  try {
    fs.renameSync(temporary, destination);
    fs.chmodSync(destination, 0o755);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

export function generateManagedInstallers({
  repoRoot = defaultRepoRoot,
  template = defaultTemplate,
  definitions = listProductDefinitions(),
  check = false,
} = {}) {
  const templateStat = fs.lstatSync(template);
  if (!templateStat.isFile() || templateStat.isSymbolicLink()) {
    throw new Error(`managed installer template must be a normal file: ${template}`);
  }
  const content = fs.readFileSync(template, 'utf8');
  if (!content.startsWith('#!/usr/bin/env node\n')) {
    throw new Error('managed installer template must start with a Node shebang');
  }

  const updated = [];
  const mismatches = [];
  for (const definition of definitions) {
    if (!definition.managedInstaller) continue;
    const packageRoot = path.join(repoRoot, definition.packageRoot);
    const packageStat = fs.lstatSync(packageRoot);
    if (!packageStat.isDirectory() || packageStat.isSymbolicLink()) {
      throw new Error(`managed product root must be a normal directory: ${definition.packageRoot}`);
    }
    const destination = path.join(packageRoot, 'bin', 'install.mjs');
    const current = fs.existsSync(destination) ? fs.readFileSync(destination, 'utf8') : null;
    if (current === content) continue;
    if (check) {
      mismatches.push(definition.id);
      continue;
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    writeAtomically(destination, content);
    updated.push(definition.id);
  }

  return { updated, mismatches };
}

function main(argv) {
  const unknown = argv.filter((argument) => argument !== '--check');
  if (unknown.length) {
    console.error(`Unknown argument: ${unknown[0]}`);
    return 2;
  }
  const check = argv.includes('--check');
  const result = generateManagedInstallers({ check });
  if (check && result.mismatches.length) {
    console.error(`Managed installer drift: ${result.mismatches.join(', ')}`);
    return 1;
  }
  if (check) {
    console.log(`Managed installers are in sync (${listProductDefinitions().filter(({ managedInstaller }) => managedInstaller).length} products).`);
  } else if (result.updated.length) {
    console.log(`Updated managed installers: ${result.updated.join(', ')}`);
  } else {
    console.log('Managed installers already in sync.');
  }
  return 0;
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
