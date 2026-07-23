#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';

import {
  createContextStaging,
  inspectContext,
  promoteContextSnapshot,
} from './context/state.mjs';

function parseArguments(argv) {
  const positional = [];
  const options = { json: false, thresholds: {} };
  const thresholdFlags = new Map([
    ['--stale-days', 'staleDays'],
    ['--expired-days', 'expiredDays'],
    ['--stale-files', 'staleFiles'],
    ['--expired-files', 'expiredFiles'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      options.json = true;
    } else if (thresholdFlags.has(argument)) {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${argument} requires a value`);
      options.thresholds[thresholdFlags.get(argument)] = Number(value);
      index += 1;
    } else {
      positional.push(argument);
    }
  }
  return { positional, options };
}

function print(value, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  if (typeof value === 'string') {
    process.stdout.write(`${value}\n`);
    return;
  }
  process.stdout.write([
    `state: ${value.state}`,
    `source: ${value.source ?? 'none'}`,
    `age_days: ${value.ageDays ?? 'unknown'}`,
    `base_commit: ${value.baseCommit ?? 'none'}`,
    `changed_files: ${value.changedFiles?.length ?? 0}`,
  ].join('\n') + '\n');
}

export function run(argv = process.argv.slice(2)) {
  const { positional, options } = parseArguments(argv);
  const [command = 'status', projectArgument = '.', stagingArgument] = positional;
  const projectRoot = path.resolve(projectArgument);

  if (command === 'status') {
    print(inspectContext(projectRoot), options.json);
    return;
  }
  if (command === 'stage') {
    if (stagingArgument) throw new Error('stage accepts only a project root');
    print(createContextStaging(projectRoot), options.json);
    return;
  }
  if (command === 'promote') {
    if (!stagingArgument) throw new Error('promote requires a staging directory');
    const hasThresholdOverrides = Object.keys(options.thresholds).length > 0;
    const metadata = promoteContextSnapshot(
      projectRoot,
      path.resolve(stagingArgument),
      { thresholds: hasThresholdOverrides ? options.thresholds : undefined },
    );
    print(metadata, options.json);
    return;
  }
  throw new Error(`unknown context command: ${command}`);
}

try {
  run();
} catch (error) {
  process.stderr.write(`[nectar-context] ${error.message}\n`);
  process.exitCode = 1;
}
