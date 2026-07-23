#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { runClaudeCase } from './evals/claude.mjs';
import { runCodexCase } from './evals/codex.mjs';
import { loadContracts, selectContracts } from './evals/contracts.mjs';
import { aggregateResults, normalizeResult } from './evals/results.mjs';

const defaultPluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  return `Run Nectar behavioral contracts against supported hosts.

Usage:
  node scripts/run-behavioral-evals.mjs [--claude | --codex | --all]
    [--case <glob>] [--output-dir <path>] [--concurrency <1-8>] [--dry-run]

Options:
  --claude       Run Claude Code native plugin evals
  --codex        Run Codex deterministic behavioral evals
  --all          Run both host adapters
  --case <glob>  Filter case IDs; repeatable
  --output-dir   Write aggregate-result.json to this directory
  --concurrency  Maximum model processes in flight (default: 2, maximum: 8)
  --dry-run      List selected host/case pairs without executing models
  -h, --help     Show this help`;
}

export function parseEvalArguments(argv) {
  const options = {
    hosts: [],
    explicitHosts: false,
    casePatterns: [],
    outputDirectory: null,
    concurrency: 2,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--claude' || argument === '--codex') {
      options.explicitHosts = true;
      const host = argument.slice(2);
      if (!options.hosts.includes(host)) options.hosts.push(host);
    } else if (argument === '--all') {
      options.explicitHosts = true;
      options.hosts = ['claude', 'codex'];
    } else if (argument === '--case') {
      const pattern = argv[++index];
      if (!pattern) throw new Error('--case requires a glob');
      options.casePatterns.push(pattern);
    } else if (argument.startsWith('--case=')) {
      const pattern = argument.slice('--case='.length);
      if (!pattern) throw new Error('--case requires a glob');
      options.casePatterns.push(pattern);
    } else if (argument === '--output-dir') {
      const outputDirectory = argv[++index];
      if (!outputDirectory) throw new Error('--output-dir requires a path');
      options.outputDirectory = outputDirectory;
    } else if (argument === '--concurrency' || argument.startsWith('--concurrency=')) {
      const raw = argument === '--concurrency'
        ? argv[++index]
        : argument.slice('--concurrency='.length);
      const concurrency = Number(raw);
      if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
        throw new Error('--concurrency requires an integer from 1 to 8');
      }
      options.concurrency = concurrency;
    } else if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function defaultCommandExists(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

function summary(aggregate) {
  const lines = aggregate.results.map(
    (result) => `${result.status.toUpperCase()} ${result.host}:${result.caseId} score=${result.score.toFixed(2)}`,
  );
  lines.push(
    `Nectar evals: ${aggregate.passed} passed, ${aggregate.failed} failed, ${aggregate.unavailable} unavailable, ${aggregate.total} total`,
  );
  return lines.join('\n');
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  const laneCount = Math.min(items.length, Math.max(1, concurrency));
  await Promise.all(Array.from({ length: laneCount }, () => lane()));
  return results;
}

export async function runEvalSuite({
  pluginRoot = defaultPluginRoot,
  options,
  commandExists = defaultCommandExists,
  hostRunners = {
    claude: runClaudeCase,
    codex: runCodexCase,
  },
}) {
  const contracts = selectContracts(
    loadContracts(path.join(pluginRoot, 'evals', 'contracts')),
    options.casePatterns,
  );
  if (!contracts.length) throw new Error('No behavioral cases matched the requested filters.');

  const hosts = options.explicitHosts
    ? options.hosts
    : ['claude', 'codex'].filter((host) => commandExists(host));
  if (!hosts.length) {
    throw new Error('Neither Claude Code nor Codex was found in PATH.');
  }

  if (options.dryRun) {
    return {
      exitCode: 0,
      aggregate: aggregateResults([]),
      output: hosts.flatMap(
        (host) => contracts.map((contract) => `${host}: ${contract.id}`),
      ).join('\n'),
    };
  }

  const availability = Object.fromEntries(hosts.map((host) => [host, commandExists(host)]));
  const jobs = hosts.flatMap(
    (host) => contracts.map((contract) => ({ host, contract })),
  );
  const results = await mapWithConcurrency(
    jobs,
    options.concurrency,
    async ({ host, contract }) => {
      const available = availability[host];
      if (!available) {
        return normalizeResult({
          host,
          caseId: contract.id,
          passed: false,
          score: 0,
          status: 'unavailable',
          evidence: [`${host} CLI is not available in PATH.`],
        });
      }
      const runner = hostRunners[host];
      if (typeof runner !== 'function') {
        return normalizeResult({
          host,
          caseId: contract.id,
          passed: false,
          score: 0,
          status: 'unavailable',
          evidence: [`No ${host} adapter is configured.`],
        });
      }
      return runner({ contract, pluginRoot });
    },
  );

  const aggregate = aggregateResults(results);
  if (options.outputDirectory) {
    const outputDirectory = path.resolve(options.outputDirectory);
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(outputDirectory, 'aggregate-result.json'),
      `${JSON.stringify(aggregate, null, 2)}\n`,
    );
  }

  return {
    exitCode: aggregate.failed ? 1 : aggregate.unavailable ? 2 : 0,
    aggregate,
    output: summary(aggregate),
  };
}

async function main() {
  let options;
  try {
    options = parseEvalArguments(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    const outcome = await runEvalSuite({ options });
    console.log(outcome.output);
    process.exitCode = outcome.exitCode;
  } catch (error) {
    console.error(`[nectar-evals] ${error.message}`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
