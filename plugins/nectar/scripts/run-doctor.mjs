#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatDoctorHuman } from './doctor/format.mjs';
import { inspectWorkTree } from './doctor/inspect.mjs';

function usage() {
  return `Inspect a project's docs/work hierarchy without modifying it.

Usage:
  nectar doctor [path] [--json]
  node scripts/run-doctor.mjs [path] [--json]

Options:
  --json       Print the stable machine-readable report
  -h, --help   Show this help`;
}

export function parseDoctorArguments(argv) {
  const args = argv[0] === 'doctor' ? argv.slice(1) : [...argv];
  const options = {
    projectPath: null,
    json: false,
    help: false,
  };

  for (const argument of args) {
    if (argument === '--json') {
      options.json = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument.startsWith('-')) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (options.projectPath !== null) {
      throw new Error('Doctor accepts at most one project path.');
    } else {
      options.projectPath = argument;
    }
  }

  return options;
}

export function runDoctor({
  argv,
  cwd = process.cwd(),
  inspect = inspectWorkTree,
}) {
  let options;
  try {
    options = parseDoctorArguments(argv);
  } catch (error) {
    return { exitCode: 2, output: `[nectar-doctor] ${error.message}` };
  }

  if (options.help) return { exitCode: 0, output: usage() };
  const projectRoot = path.resolve(cwd, options.projectPath || '.');
  if (!fs.existsSync(projectRoot)) {
    return {
      exitCode: 2,
      output: `[nectar-doctor] Project path does not exist: ${projectRoot}`,
    };
  }
  if (!fs.statSync(projectRoot).isDirectory()) {
    return {
      exitCode: 2,
      output: `[nectar-doctor] Project path is not a directory: ${projectRoot}`,
    };
  }

  let report;
  try {
    report = inspect(projectRoot);
  } catch (error) {
    return {
      exitCode: 2,
      output: `[nectar-doctor] Could not inspect ${projectRoot}: ${error.message}`,
    };
  }

  return {
    exitCode: report.diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? 1 : 0,
    output: options.json ? JSON.stringify(report, null, 2) : formatDoctorHuman(report),
    report,
  };
}

function main() {
  const outcome = runDoctor({ argv: process.argv.slice(2) });
  console.log(outcome.output);
  process.exitCode = outcome.exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
