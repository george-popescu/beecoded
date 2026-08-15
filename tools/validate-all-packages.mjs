#!/usr/bin/env node

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { listProductDefinitions } from './plugin-products.mjs';

const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
const validator = path.join(toolsRoot, 'validate-package.mjs');

export function runAllPackageValidation({ execute = spawnSync } = {}) {
  for (const { id } of listProductDefinitions()) {
    const result = execute(process.execPath, [validator, id], { stdio: 'inherit' });
    if (result.error) {
      console.error(`${id} package validation could not start: ${result.error.message}`);
      return 1;
    }
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

export function runAllPackagePack({ execute = spawnSync } = {}) {
  for (const { id, packageName } of listProductDefinitions()) {
    const result = execute('npm', ['pack', '--workspace', packageName, '--dry-run', '--json'], {
      stdio: 'inherit',
    });
    if (result.error) {
      console.error(`${id} package dry-run could not start: ${result.error.message}`);
      return 1;
    }
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--pack')) {
    console.error('Usage: node tools/validate-all-packages.mjs [--pack]');
    process.exitCode = 2;
  } else {
    process.exitCode = args[0] === '--pack'
      ? runAllPackagePack()
      : runAllPackageValidation();
  }
}
