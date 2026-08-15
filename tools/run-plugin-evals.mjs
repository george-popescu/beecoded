#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { runClaudeCase } from './evals/claude.mjs';
import { runCodexCase } from './evals/codex.mjs';
import { loadContracts, selectContracts } from './evals/contracts.mjs';
import { aggregateResults } from './evals/results.mjs';
import { listProductDefinitions } from './plugin-products.mjs';

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseEvalArguments(argv) {
  const options = {
    hosts: [],
    products: [],
    casePatterns: [],
    outputDir: null,
    concurrency: 1,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--claude' || argument === '--codex') {
      const host = argument.slice(2);
      if (!options.hosts.includes(host)) options.hosts.push(host);
    } else if (argument === '--all') {
      options.hosts = ['claude', 'codex'];
    } else if (argument === '--product') {
      const value = argv[++index];
      if (!value) throw new Error('--product requires an id');
      options.products.push(value);
    } else if (argument.startsWith('--product=')) {
      const value = argument.slice('--product='.length);
      if (!value) throw new Error('--product requires an id');
      options.products.push(value);
    } else if (argument === '--case') {
      const value = argv[++index];
      if (!value) throw new Error('--case requires a glob');
      options.casePatterns.push(value);
    } else if (argument.startsWith('--case=')) {
      const value = argument.slice('--case='.length);
      if (!value) throw new Error('--case requires a glob');
      options.casePatterns.push(value);
    } else if (argument === '--output-dir') {
      const value = argv[++index];
      if (!value) throw new Error('--output-dir requires a path');
      options.outputDir = value;
    } else if (argument === '--concurrency') {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 1 || value > 8) throw new Error('--concurrency must be an integer from 1 to 8');
      options.concurrency = value;
    } else if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  options.products = [...new Set(options.products)];
  return options;
}

function commandExists(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

async function runWithConcurrency(jobs, concurrency, worker) {
  const results = new Array(jobs.length);
  let cursor = 0;
  async function consume() {
    while (cursor < jobs.length) {
      const index = cursor++;
      results[index] = await worker(jobs[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, consume));
  return results;
}

export async function runPluginEvals({
  repoRoot = defaultRepoRoot,
  options,
  definitions = listProductDefinitions(),
  runners = { claude: runClaudeCase, codex: runCodexCase },
} = {}) {
  const selectedDefinitions = definitions.filter(({ id, evalContracts }) => (
    evalContracts && (!options.products.length || options.products.includes(id))
  ));
  const missing = options.products.filter((id) => !definitions.some((definition) => definition.id === id));
  if (missing.length) throw new Error(`Unknown plugin product: ${missing[0]}`);
  if (!selectedDefinitions.length) throw new Error('No selected plugin product has behavioral contracts.');

  const hosts = options.hosts.length
    ? options.hosts
    : ['claude', 'codex'].filter(commandExists);
  if (!hosts.length && !options.dryRun) throw new Error('Neither Claude Code nor Codex is available.');

  const jobs = [];
  for (const definition of selectedDefinitions) {
    const contracts = selectContracts(loadContracts(
      path.join(repoRoot, definition.evalContracts),
      { allowedSkills: definition.publicSkills },
    ), options.casePatterns);
    for (const contract of contracts) {
      for (const host of hosts) {
        jobs.push({
          product: definition.id,
          host,
          contract,
          pluginRoot: path.join(repoRoot, definition.packageRoot),
        });
      }
    }
  }
  if (!jobs.length) throw new Error('No behavioral cases matched the requested filters.');
  const listing = jobs.map((job) => `${job.host}:${job.product}:${job.contract.id}`).join('\n');
  if (options.dryRun) return { output: listing, aggregate: null, jobs };

  const results = await runWithConcurrency(jobs, options.concurrency, (job) => runners[job.host](job));
  const aggregate = aggregateResults(results);
  if (options.outputDir) {
    const outputDirectory = path.resolve(repoRoot, options.outputDir);
    fs.mkdirSync(outputDirectory, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(
      path.join(outputDirectory, `plugin-evals-${timestamp}.json`),
      `${JSON.stringify(aggregate, null, 2)}\n`,
    );
  }
  const output = results.map((result) => (
    `${result.status.toUpperCase()} ${result.host}:${result.product}:${result.caseId} score=${result.score.toFixed(2)}`
  )).join('\n');
  return { output, aggregate, jobs };
}

function usage() {
  return `Usage: node tools/run-plugin-evals.mjs [--product <id>] [--claude|--codex|--all]\n  [--case <glob>] [--output-dir <path>] [--concurrency <1-8>] [--dry-run]`;
}

export function evalExitCode(aggregate) {
  if (!aggregate) return 0;
  if (aggregate.failed) return 1;
  if (aggregate.unavailable) return 2;
  return 0;
}

async function main(argv) {
  let options;
  try {
    options = parseEvalArguments(argv);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return 2;
  }
  if (options.help) {
    console.log(usage());
    return 0;
  }
  try {
    const outcome = await runPluginEvals({ options });
    console.log(outcome.output);
    return evalExitCode(outcome.aggregate);
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
