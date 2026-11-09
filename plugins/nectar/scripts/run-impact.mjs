#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { containsSymlink } from './atlas/paths.mjs';

const MAX_BYTES = 8 * 1024 * 1024;
const identifier = value => typeof value === 'string' && /^[a-z0-9_-]{1,128}$/i.test(value);
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function normalizeRows(input) {
  if (!Array.isArray(input) || !input.length || input.length > 10000) throw new Error('Expected a non-empty benchmark results array (at most 10000 rows).');
  const schema = input[0]?.caseId ? 'inspection' : input[0]?.scenario ? 'delivery' : null;
  const variants = schema === 'inspection' ? ['baseline', 'skill'] : ['baseline', 'published', 'nectar'];
  if (!schema) throw new Error('Unsupported benchmark schema.');
  return input.map(row => {
    const scenario = schema === 'inspection' ? row.caseId : row.scenario;
    if (!identifier(scenario) || !variants.includes(row.variant) || !['passed', 'failed', 'unavailable'].includes(row.status)
      || (schema === 'inspection' && !['codex', 'claude'].includes(row.host))
      || (row.status !== 'unavailable' && (!Number.isInteger(row.repetition) || row.repetition < 1))) throw new Error('Unsupported or malformed benchmark row.');
    const metrics = schema === 'inspection' ? row.metrics : row;
    const passed = schema === 'inspection' ? row.passed : row.behaviorPassed;
    if (row.status !== 'unavailable' && passed !== (row.status === 'passed')) throw new Error('Benchmark status contradicts its correctness result.');
    const settings = metrics?.settings;
    const settingsKey = settings && typeof settings === 'object' && !Array.isArray(settings)
      && typeof settings.model === 'string' && settings.model.trim()
      && Object.values(settings).every(value => typeof value === 'string')
      ? JSON.stringify(Object.entries(settings).sort(([a], [b]) => a.localeCompare(b))) : null;
    return { scenario, repetition: row.repetition, variant: row.variant, status: row.status,
      settingsKey, host: schema === 'inspection' ? row.host : 'codex', model: row.model || null,
      elapsedMs: schema === 'inspection' ? metrics?.actorMs : metrics?.actorElapsedMs,
      commands: metrics?.commandCount, outputTokens: metrics?.usage?.output_tokens };
  });
}

function aggregate(pairs, field) {
  const measured = pairs.filter(([a, b]) => a.status === 'passed' && b.status === 'passed' && number(a[field]) && number(b[field]));
  if (!measured.length) return { pairs: 0, baselineTotal: null, candidateTotal: null, percentChange: null };
  const baselineTotal = measured.reduce((sum, [a]) => sum + a[field], 0);
  const candidateTotal = measured.reduce((sum, [, b]) => sum + b[field], 0);
  return { pairs: measured.length, baselineTotal, candidateTotal,
    percentChange: baselineTotal > 0 ? +((candidateTotal / baselineTotal - 1) * 100).toFixed(2) : null };
}

export function summarizeImpact(input) {
  const rows = normalizeRows(input);
  const groups = new Map();
  let unavailable = 0;
  for (const row of rows) {
    if (row.status === 'unavailable') { unavailable++; continue; }
    const key = `${row.scenario}/${row.repetition}`;
    if (!groups.has(key)) groups.set(key, new Map());
    const group = groups.get(key);
    if (group.has(row.variant)) throw new Error('Duplicate benchmark arm for the same scenario and repetition; select an unambiguous run.');
    group.set(row.variant, row);
  }
  const variants = [...new Set(rows.map(row => row.variant))].filter(variant => variant !== 'baseline').sort();
  const comparisons = variants.map(variant => {
    const pairs = [];
    const excluded = { missingArm: 0, missingSettings: 0, differentSettings: 0 };
    for (const group of groups.values()) {
      const baseline = group.get('baseline');
      const candidate = group.get(variant);
      if (!baseline || !candidate) { excluded.missingArm++; continue; }
      if (!baseline.settingsKey || !candidate.settingsKey) { excluded.missingSettings++; continue; }
      if (baseline.settingsKey !== candidate.settingsKey || baseline.host !== candidate.host || baseline.model !== candidate.model) { excluded.differentSettings++; continue; }
      pairs.push([baseline, candidate]);
    }
    return { variant, pairedTrials: pairs.length, excluded,
      correctness: { baselinePassed: pairs.filter(([a]) => a.status === 'passed').length,
        candidatePassed: pairs.filter(([, b]) => b.status === 'passed').length,
        bothPassed: pairs.filter(([a, b]) => a.status === 'passed' && b.status === 'passed').length },
      elapsedMs: aggregate(pairs, 'elapsedMs'), commands: aggregate(pairs, 'commands'), outputTokens: aggregate(pairs, 'outputTokens') };
  });
  return { version: 1, status: comparisons.some(item => item.pairedTrials) ? 'paired-summary' : 'not-comparable',
    trials: rows.length, unavailable, comparisons, cost: null,
    limitations: ['Results are self-reported benchmark evidence, not independently re-executed.', 'Pairs require the same scenario, repetition, host and recorded model settings; environment and fixture equality are not reverified.', 'Efficiency totals include only matched pairs where both arms passed; negative percent change means less, not better correctness.', 'No cost savings or production-wide improvement is inferred from these trials.'] };
}

function readResults(file) {
  const absolute = path.resolve(file);
  const filesystemRoot = path.parse(absolute).root;
  if (containsSymlink(filesystemRoot, path.relative(filesystemRoot, absolute))) throw new Error('Benchmark input must not traverse symlinks; use its real path.');
  if (!fs.lstatSync(absolute).isFile()) throw new Error('Benchmark input must be a normal file.');
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Benchmark input must be a normal file of at most 8 MiB.');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    const length = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (length > MAX_BYTES) throw new Error('Benchmark input exceeds 8 MiB.');
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length))); }
    catch { throw new Error('Benchmark input is not valid UTF-8 JSON.'); }
  } finally { fs.closeSync(fd); }
}

export function runImpact({ argv = [], cwd = process.cwd() } = {}) {
  const args = argv[0] === 'impact' ? argv.slice(1) : argv;
  const help = 'Usage: nectar impact [--file <results.json>] [--json]\nSelect results.json from tools/benchmark-nectar.mjs or tools/benchmark-burciu-inspection.mjs; this command never executes a benchmark.';
  if (args.includes('--help') || args.includes('-h')) return { exitCode: 0, output: help };
  let file = null;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') json = true;
    else if (args[i] === '--file' && !file && args[i + 1] && !args[i + 1].startsWith('-')) file = args[++i];
    else return { exitCode: 2, output: '[nectar-impact] Invalid arguments.\n' + help };
  }
  if (!file) {
    const report = { version: 1, status: 'no-benchmark-selected', comparisons: [], instructions: help };
    return { exitCode: 0, report, output: json ? JSON.stringify(report, null, 2) : 'No benchmark selected. No impact claim available.\n' + help };
  }
  try {
    const report = summarizeImpact(readResults(path.resolve(cwd, file)));
    return { exitCode: 0, report, output: json ? JSON.stringify(report, null, 2) : [
      `Benchmark: ${report.trials} trials, ${report.unavailable} unavailable; ${report.status}.`,
      ...report.comparisons.map(item => `${item.variant} vs baseline: ${item.pairedTrials} comparable pairs; passed ${item.correctness.candidatePassed}/${item.pairedTrials} vs ${item.correctness.baselinePassed}/${item.pairedTrials}. Time change (both passed): ${item.elapsedMs.percentChange === null ? 'unavailable' : `${item.elapsedMs.percentChange}%`}.`),
      ...report.limitations,
    ].join('\n') };
  } catch (error) { return { exitCode: 2, output: `[nectar-impact] ${error.code ? 'Could not safely read selected benchmark input.' : error.message}` }; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runImpact({ argv: process.argv.slice(2) });
  console.log(result.output);
  process.exitCode = result.exitCode;
}
