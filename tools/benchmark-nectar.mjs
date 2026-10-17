#!/usr/bin/env node

// Opt-in live smoke benchmark. Not part of npm test or release validation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { renderManagedSkill } from '../plugins/nectar/bin/install.mjs';
import { runCommand } from '../plugins/nectar/scripts/evals/process.mjs';
import { createCodexIsolation, verificationEnvironment } from '../plugins/nectar/scripts/evals/isolation.mjs';
import { redactExcludedValues } from '../plugins/nectar/scripts/evals/results.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = path.join(repoRoot, 'plugins', 'nectar');
const fixtureTests = {
  debug: `import assert from 'node:assert/strict';
import { amount } from './src/amount.mjs';
assert.equal(amount({amount:0}),0);
assert.equal(amount({amount:7}),7);
assert.equal(amount({amount:null}),10);
assert.equal(amount({}),10);
`,
  rounding: `import assert from 'node:assert/strict';
import { calculateTotal } from './src/total.mjs';
assert.equal(calculateTotal([{price:0.1,quantity:3}]),0.3);
assert.equal(calculateTotal([{price:1.005,quantity:1}]),1.01);
assert.equal(calculateTotal([{price:0.105,quantity:2}]),0.21);
assert.equal(calculateTotal([{price:0.104,quantity:1},{price:0.104,quantity:1}]),0.21);
assert.equal(calculateTotal([]),0);
console.log('5 behavioral checks passed');
`,
  honey: `import assert from 'node:assert/strict';
import { quote } from './src/cart.mjs';
assert.deepEqual(quote([],true),{subtotalCents:0,discountCents:0,shippingCents:0,totalCents:0});
assert.deepEqual(quote([{priceCents:10001,quantity:1}],true),{subtotalCents:10001,discountCents:1000,shippingCents:500,totalCents:9501});
assert.deepEqual(quote([{priceCents:10000,quantity:1}],false),{subtotalCents:10000,discountCents:0,shippingCents:0,totalCents:10000});
assert.deepEqual(quote([{priceCents:9999,quantity:1}],false),{subtotalCents:9999,discountCents:0,shippingCents:500,totalCents:10499});
console.log('4 behavioral checks passed');
`,
};

function write(root, relative, text) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text, { flag: 'wx' });
}

function populate(root, scenario) {
  write(root, 'package.json', JSON.stringify({ private: true, type: 'module', scripts: { test: 'node test.mjs' } }));
  write(root, 'test.mjs', `import fs from 'node:fs';\nfs.appendFileSync('test-runs.log','run\\n');\n${fixtureTests[scenario]}`);
  if (scenario === 'debug') {
    write(root, 'src/amount.mjs', 'export const amount = input => input.amount || 10;\n');
    return 'Customers submitting amount zero receive 10. A colleague suspects a rounding problem. Diagnose the actual cause and fix it: preserve provided numeric values, use 10 only for null or missing amount. Keep the public API; no dependencies. Implement and verify, using an available workflow if useful.';
  }
  if (scenario === 'rounding') {
    write(root, 'src/total.mjs', 'export function calculateTotal(items) { return items.reduce((sum, item) => sum + item.price * item.quantity, 0); }\n');
    return 'Fix calculateTotal in src/total.mjs: return the total rounded to two decimal places after summing all line items, not after each item. Preserve its public signature and add no dependencies. npm test is the existing verification command. Implement and verify the complete fix. Use an available workflow if it helps.';
  }
  write(root, 'src/cart.mjs', 'export function quote(items, vip = false) { const subtotalCents = items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0); return { subtotalCents, discountCents: 0, shippingCents: 0, totalCents: subtotalCents }; }\n');
  const topic = 'docs/work/2026-09-16-checkout';
  write(root, `${topic}/design.md`, '# Checkout\nImplement the approved quote: VIP discount is 10% of subtotal, rounded to whole cents. Shipping is 500 cents below 10000 discounted cents, otherwise free. Empty carts cost zero. Preserve the quote return fields; no dependencies or external services.\n');
  write(root, `${topic}/plan.md`, '# Checkout plan\n\nWorkflow: nectar-slim-v1\n\n## Wave 1\n- [x] T1: Implement subtotal.\n  - files: `src/cart.mjs`\n- [ ] T2: Implement the VIP discount.\n  - files: `src/cart.mjs`\n\n## Wave 2\n- [ ] T3: Apply shipping and return the total.\n  - files: `src/cart.mjs`\n\n## Verification\nStatus: pending\nCommands: npm test\nEvidence:\n');
  return 'Finish the already approved checkout delivery in docs/work/2026-09-16-checkout. Subtotal is implemented; complete the remaining behavior, final verification and review. Use an available workflow if it helps. No commit, publication or archive operation is requested.';
}

function installFixtureSkills(root, selectedPlugin = pluginRoot) {
  const payload = path.join(root, '.benchmark-plugin');
  fs.cpSync(selectedPlugin, payload, { recursive: true, filter: (file) => !path.relative(selectedPlugin, file).split(path.sep).includes('node_modules') });
  const version = JSON.parse(fs.readFileSync(path.join(selectedPlugin, 'package.json'), 'utf8')).version;
  for (const name of fs.readdirSync(path.join(payload, 'internal-skills'))) {
    const rendered = renderManagedSkill({
      sourceDirectory: path.join(payload, 'internal-skills', name), entryName: name,
      packageName: '@beecoded/nectar', packageVersion: version, packageRoot: payload, installedPackageRoot: payload,
    });
    write(root, `.agents/skills/${name}/SKILL.md`, rendered.skill);
  }
}

export function evaluateBenchmarkOutcome(root, scenario) {
  if (!Object.hasOwn(fixtureTests, scenario)) throw new Error('Unknown benchmark scenario');
  const marker = crypto.randomBytes(24).toString('hex');
  const oracleUrl = new URL('./benchmark-oracle.mjs', import.meta.url).href;
  const program = `import {runOracle} from ${JSON.stringify(oracleUrl)}; await runOracle(${JSON.stringify(fs.realpathSync(root))}, ${JSON.stringify(fixtureTests[scenario])}); process.stdout.write(${JSON.stringify(marker)});`;
  const verifierHome = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-verifier-'));
  let golden;
  try {
    golden = spawnSync(process.execPath, ['--experimental-permission',
      `--allow-fs-read=${fs.realpathSync(root)}`, `--allow-fs-read=${fileURLToPath(oracleUrl)}`,
      '--experimental-vm-modules', '--input-type=module', '-e', program], {
      cwd: root, env: verificationEnvironment(verifierHome), encoding: 'utf8', timeout: 10_000,
    });
  } finally { fs.rmSync(verifierHome, { recursive: true, force: true }); }
  const completed = golden.status === 0 && golden.stdout === marker;
  let noAddedDependencies = false;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    noAddedDependencies = ['dependencies', 'devDependencies', 'optionalDependencies']
      .every((field) => !Object.keys(pkg[field] || {}).length);
  } catch {}
  return {
    behaviorPassed: completed && noAddedDependencies,
    noAddedDependencies,
    verificationError: completed ? null : redactExcludedValues(null, golden.stderr || golden.error?.message || 'Oracle did not complete'),
  };
}

async function trial(output, scenario, variant, execute, binary, repetition, selectedPlugin) {
  const directory = path.join(output, `${scenario}-${variant}-${repetition}`);
  fs.mkdirSync(directory);
  const root = path.join(directory, 'project');
  fs.mkdirSync(root);
  const prompt = populate(root, scenario);
  if (variant !== 'baseline') installFixtureSkills(root, selectedPlugin);
  const testBefore = fs.readFileSync(path.join(root, 'test.mjs'), 'utf8');
  const packageBefore = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  const started = Date.now();
  let isolation;
  let actor;
  try {
    isolation = createCodexIsolation();
    actor = await execute(binary, [
    'exec', '--ephemeral', '--sandbox', 'workspace-write', '--skip-git-repo-check',
    '--json', '--color', 'never', '--cd', root, '--output-last-message', path.join(directory, 'response.txt'), prompt,
  ], { cwd: root, env: isolation.env, timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
  } catch (error) {
    actor = { status: null, error, stdout: '', stderr: '' };
  } finally { isolation?.cleanup(); }
  if (isolation) {
    actor.stdout = isolation.redact(actor.stdout);
    actor.stderr = isolation.redact(actor.stderr);
    const responsePath = path.join(directory, 'response.txt');
    if (fs.existsSync(responsePath) && fs.lstatSync(responsePath).isFile()) {
      fs.writeFileSync(responsePath, redactExcludedValues(null, isolation.redact(fs.readFileSync(responsePath, 'utf8'))));
    }
  }
  const actorElapsedMs = Date.now() - started;
  fs.writeFileSync(path.join(directory, 'actor.jsonl'), redactExcludedValues(null, actor.stdout));
  fs.writeFileSync(path.join(directory, 'actor.stderr.log'), redactExcludedValues(null, actor.stderr));
  const events = actor.stdout.split('\n').flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  if (actor.error || actor.status !== 0) {
    return {
      scenario, variant, status: 'unavailable', actorElapsedMs, actorStatus: actor.status,
      actorError: redactExcludedValues(null, actor.error?.message || events.findLast((event) => event.type === 'turn.failed')?.error?.message
        || events.findLast((event) => event.type === 'error')?.message || actor.stderr || 'CLI did not complete the task'),
      behaviorPassed: null, artifacts: directory,
    };
  }
  const commands = [...new Map(events.filter((event) => event.item?.type === 'command_execution').map((event) => [event.item.id, event.item.command])).values()];
  const skillReads = [...new Set(commands.flatMap((command) => [...command.matchAll(/(nectar-[a-z-]+)\/SKILL\.md/g)].map((match) => match[1])))];
  // Grade immutable external behavior, not whether the actor kept test prose.
  // Test additions are observable review evidence, not automatically a failure.
  const behavior = evaluateBenchmarkOutcome(root, scenario);
  const unchanged = (file, before) => fs.existsSync(path.join(root, file)) && fs.readFileSync(path.join(root, file), 'utf8') === before;
  const testsUnchanged = unchanged('test.mjs', testBefore) && unchanged('package.json', packageBefore);
  const counter = path.join(root, 'test-runs.log');
  const outcome = {
    scenario, variant, repetition, settings: isolation?.settings || null, actorElapsedMs, actorStatus: actor.status, actorError: actor.error?.message || null,
    ...behavior, testsUnchanged,
    recordedTestRuns: fs.existsSync(counter) ? fs.readFileSync(counter, 'utf8').trim().split('\n').length : 0,
    observedSkillReads: skillReads, commandCount: commands.length,
    usage: events.findLast((event) => event.type === 'turn.completed')?.usage || null,
    model: actor.stderr.match(/^model:\s*(.+)$/m)?.[1] || null,
    artifacts: directory,
  };
  if (scenario === 'honey') {
    const { inspectWorkTree } = await import('../plugins/nectar/scripts/doctor/inspect.mjs');
    outcome.topicStatus = inspectWorkTree(root).topics.find((topic) => topic.path.endsWith('-checkout'))?.status || null;
  }
  outcome.status = outcome.behaviorPassed ? 'passed' : 'failed';
  return outcome;
}

export async function benchmarkNectar({ execute = runCommand, binary = 'codex', temporaryRoot = os.tmpdir(), report = console.log, publishedRoot = null, repetitions = 1, scenarios = ['rounding', 'honey'] } = {}) {
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) throw new Error('Repetitions must be 1-10');
  if (!scenarios.length || scenarios.some((s) => !Object.hasOwn(fixtureTests, s))) throw new Error('Unknown benchmark scenario');
  const output = fs.mkdtempSync(path.join(temporaryRoot, 'nectar-benchmark-'));
  const results = [];
  const jobs = [];
  for (let repetition = 1; repetition <= repetitions; repetition++) {
    for (const scenario of scenarios) {
      const variants = publishedRoot ? ['baseline', 'published', 'nectar'] : ['baseline', 'nectar'];
      if (repetition % 2 === 0) variants.reverse();
      for (const variant of variants) jobs.push([scenario, variant, repetition]);
    }
  }
  for (const [scenario, variant, repetition] of jobs) {
    report(`[nectar-benchmark] ${scenario}/${variant}/${repetition}; timeout 180s; isolated host, same selected model/effort`);
    results.push(await trial(output, scenario, variant, execute, binary, repetition, variant === 'published' ? publishedRoot : pluginRoot));
    if (results.at(-1).settings && results[0].settings
      && JSON.stringify(results.at(-1).settings) !== JSON.stringify(results[0].settings)) {
      results.at(-1).status = 'unavailable';
      results.at(-1).actorError = 'Model/provider/effort settings changed during the comparison; exclude this run.';
    }
    fs.writeFileSync(path.join(output, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
    report(JSON.stringify(results.at(-1)));
    if (results.at(-1).status === 'unavailable') break;
  }
  report(`[nectar-benchmark] Local artifacts: ${output}`);
  return results;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i + 1]) throw new Error('Missing benchmark option value');
    if (args[i] === '--codex') options.binary = args[i + 1];
    else if (args[i] === '--published-root') options.publishedRoot = path.resolve(args[i + 1]);
    else if (args[i] === '--repetitions') options.repetitions = Number(args[i + 1]);
    else if (args[i] === '--scenarios') options.scenarios = args[i + 1].split(',');
    else throw new Error('Unknown benchmark option');
  }
  const results = await benchmarkNectar(options);
  process.exitCode = results.every((result) => result.status === 'passed') ? 0 : 1;
}
