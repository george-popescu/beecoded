#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const defaultPaths = {
  core: path.join(repoRoot, 'plugins/code-audit/methodology/audit-core.md'),
  standalonePreamble: path.join(repoRoot, 'tools/templates/code-audit-standalone-preamble.md'),
  nectarPreamble: path.join(repoRoot, 'tools/templates/nectar-audit-preamble.md'),
  nectarSuffix: path.join(repoRoot, 'tools/templates/nectar-audit-atlas.md'),
  standaloneDestination: path.join(repoRoot, 'plugins/code-audit/internal-skills/code-audit/SKILL.md'),
  nectarDestination: path.join(repoRoot, 'plugins/nectar/internal-skills/nectar-audit/SKILL.md'),
};

function normalFile(file, label) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a normal file: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

function lstatIfPresent(entry) {
  try {
    return fs.lstatSync(entry);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function commonPathBoundary(entries) {
  const resolved = entries.map((entry) => path.resolve(entry));
  let boundary = resolved[0];
  while (resolved.some((entry) => entry !== boundary && !entry.startsWith(`${boundary}${path.sep}`))) {
    const parent = path.dirname(boundary);
    if (parent === boundary) break;
    boundary = parent;
  }
  return boundary;
}

function assertSafeDestination(destination, boundary) {
  const absolute = path.resolve(destination);
  const relation = path.relative(boundary, absolute);
  if (relation.startsWith('..') || path.isAbsolute(relation)) {
    throw new Error(`destination escapes generation boundary: ${destination}`);
  }
  const boundaryStat = lstatIfPresent(boundary);
  if (!boundaryStat || !boundaryStat.isDirectory() || boundaryStat.isSymbolicLink()) {
    throw new Error(`generation boundary must be a normal directory: ${boundary}`);
  }
  const parts = relation.split(path.sep).filter(Boolean);
  let current = boundary;

  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = lstatIfPresent(current);
    if (!stat) continue;
    const leaf = index === parts.length - 1;
    if (stat.isSymbolicLink()) {
      throw new Error(`${leaf ? 'destination' : 'destination ancestor'} must not be a symbolic link: ${current}`);
    }
    if (!leaf && !stat.isDirectory()) {
      throw new Error(`destination ancestor must be a normal directory: ${current}`);
    }
    if (leaf && !stat.isFile()) {
      throw new Error(`destination must be a normal file when it exists: ${current}`);
    }
  }
}

function writeSurface(destination, content, boundary) {
  assertSafeDestination(destination, boundary);
  const directory = path.dirname(destination);
  fs.mkdirSync(directory, { recursive: true });
  assertSafeDestination(destination, boundary);

  const temporary = path.join(directory, `.${path.basename(destination)}.${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o666);
    fs.writeFileSync(descriptor, content, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    assertSafeDestination(destination, boundary);
    fs.renameSync(temporary, destination);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force: true });
  }
}

export function renderAuditSurface({ preamble, core, suffix = '', replacements }) {
  let renderedCore = core;
  for (const [token, value] of Object.entries(replacements)) {
    renderedCore = renderedCore.replaceAll(`{{${token}}}`, value);
  }
  const unresolved = renderedCore.match(/\{\{[A-Z_]+\}\}/g);
  if (unresolved) throw new Error(`Unresolved audit methodology token: ${unresolved[0]}`);
  return [preamble.trimEnd(), renderedCore.trim(), suffix.trim()]
    .filter(Boolean)
    .join('\n\n') + '\n';
}

function surfaceDefinitions(paths) {
  const core = normalFile(paths.core, 'audit methodology core');
  return [
    {
      id: 'code-audit',
      destination: paths.standaloneDestination,
      content: renderAuditSurface({
        preamble: normalFile(paths.standalonePreamble, 'standalone audit preamble'),
        core,
        replacements: {
          ROLE_PREFIX: 'code-audit',
          DEFAULT_REPORT: 'code-audit-YYYY-MM-DD.md',
          LENS_ROLE_PATH: '../../agents/lens.md',
          VALIDATOR_ROLE_PATH: '../../agents/validator.md',
        },
      }),
    },
    {
      id: 'nectar-audit',
      destination: paths.nectarDestination,
      content: renderAuditSurface({
        preamble: normalFile(paths.nectarPreamble, 'Nectar audit preamble'),
        core,
        suffix: normalFile(paths.nectarSuffix, 'Nectar Atlas suffix'),
        replacements: {
          ROLE_PREFIX: 'nectar',
          DEFAULT_REPORT: 'docs/work/audit-YYYY-MM-DD.md',
          LENS_ROLE_PATH: '../../agents/lens.md',
          VALIDATOR_ROLE_PATH: '../../agents/validator.md',
        },
      }),
    },
  ];
}

export function generateCodeAuditSurfaces({ paths = defaultPaths, check = false } = {}) {
  const boundary = commonPathBoundary(Object.values(paths));
  const updated = [];
  const mismatches = [];
  for (const surface of surfaceDefinitions(paths)) {
    assertSafeDestination(surface.destination, boundary);
    const current = lstatIfPresent(surface.destination)
      ? fs.readFileSync(surface.destination, 'utf8')
      : null;
    if (current === surface.content) continue;
    if (check) {
      mismatches.push(surface.id);
      continue;
    }
    writeSurface(surface.destination, surface.content, boundary);
    updated.push(surface.id);
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
  const result = generateCodeAuditSurfaces({ check });
  if (check && result.mismatches.length) {
    console.error(`Generated audit surface drift: ${result.mismatches.join(', ')}`);
    return 1;
  }
  if (check) console.log('Generated Code Audit and Nectar Audit surfaces are in sync.');
  else if (result.updated.length) console.log(`Updated audit surfaces: ${result.updated.join(', ')}`);
  else console.log('Generated audit surfaces already in sync.');
  return 0;
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
