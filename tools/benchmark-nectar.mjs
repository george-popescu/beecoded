#!/usr/bin/env node

// Opt-in live smoke benchmark. Not part of npm test or release validation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { renderManagedSkill } from '../plugins/nectar/bin/install.mjs';
import { evalEnvironment, runCommand } from '../plugins/nectar/scripts/evals/process.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = path.join(repoRoot, 'plugins', 'nectar');
const fixtureTests = {
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
  if (scenario === 'rounding') {
    write(root, 'src/total.mjs', 'export function calculateTotal(items) { return items.reduce((sum, item) => sum + item.price * item.quantity, 0); }\n');
    return 'Fix calculateTotal in src/total.mjs: return the total rounded to two decimal places after summing all line items, not after each item. Preserve its public signature and add no dependencies. npm test is the existing verification command. Implement and verify the complete fix. Use an available workflow if it helps.';
  }
  write(root, 'src/cart.mjs', 'export function quote(items, vip = false) { const subtotalCents = items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0); return { subtotalCents, discountCents: 0, shippingCents: 0, totalCents: subtotalCents }; }\n');
  const topic = 'docs/work/2026-09-16-checkout';
  write(root, `${topic}/design.md`, '# Checkout\nImplement the approved quote: VIP discount is 10% of subtotal, rounded to whole cents. Shipping is 500 cents below 10000 discounted cents, otherwise free. Empty carts cost zero. Preserve the quote return fields; no dependencies or external services.\n');
  write(root, `${topic}/plan.md`, '# Checkout plan\n\nWorkflow: nectar-slim-v1\n\n## Wave 1\n- [x] T1: Implement subtotal.\n  - files: `src/cart.mjs`\n- [ ] T2: Implement the VIP discount.\n  - files: `src/cart.mjs`\n\n## Wave 2\n- [ ] T3: Apply shipping and return the total.\n  - files: `src/cart.mjs`\n\n## Verification\nStatus: pending\nCommands: npm test\nEvidence:\n');
  return 'Use $nectar-honey to finish the already approved checkout delivery in docs/work/2026-09-16-checkout. Subtotal is implemented; complete the remaining behavior, final verification and review. No commit, publication or archive operation is requested.';
}

function installFixtureSkills(root) {
  const payload = path.join(root, '.benchmark-plugin');
  fs.cpSync(pluginRoot, payload, { recursive: true, filter: (file) => !path.relative(pluginRoot, file).split(path.sep).includes('node_modules') });
  const version = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf8')).version;
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
  const golden = spawnSync(process.execPath, ['--input-type=module', '-e', fixtureTests[scenario]], {
    cwd: root, env: evalEnvironment(), encoding: 'utf8', timeout: 10_000,
  });
  let noAddedDependencies = false;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    noAddedDependencies = ['dependencies', 'devDependencies', 'optionalDependencies']
      .every((field) => !Object.keys(pkg[field] || {}).length);
  } catch {}
  return {
    behaviorPassed: golden.status === 0 && noAddedDependencies,
    noAddedDependencies,
    verificationError: golden.status === 0 ? null : golden.stderr || golden.error?.message,
  };
}

async function trial(output, scenario, variant, execute, binary) {
  const directory = path.join(output, `${scenario}-${variant}`);
  fs.mkdirSync(directory);
  const root = path.join(directory, 'project');
  fs.mkdirSync(root);
  const prompt = populate(root, scenario);
  if (variant === 'nectar') installFixtureSkills(root);
  const testBefore = fs.readFileSync(path.join(root, 'test.mjs'), 'utf8');
  const packageBefore = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  const started = Date.now();
  const actor = await execute(binary, [
    'exec', '--ephemeral', '--sandbox', 'workspace-write', '--skip-git-repo-check',
    '--json', '--color', 'never', '--cd', root, '--output-last-message', path.join(directory, 'response.txt'), prompt,
  ], { cwd: root, env: evalEnvironment(), timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
  const actorElapsedMs = Date.now() - started;
  fs.writeFileSync(path.join(directory, 'actor.jsonl'), actor.stdout);
  fs.writeFileSync(path.join(directory, 'actor.stderr.log'), actor.stderr);
  const events = actor.stdout.split('\n').flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  if (actor.error || actor.status !== 0) {
    return {
      scenario, variant, status: 'unavailable', actorElapsedMs, actorStatus: actor.status,
      actorError: actor.error?.message || events.findLast((event) => event.type === 'turn.failed')?.error?.message
        || events.findLast((event) => event.type === 'error')?.message || 'CLI did not complete the task',
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
    scenario, variant, actorElapsedMs, actorStatus: actor.status, actorError: actor.error?.message || null,
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
  outcome.status = outcome.behaviorPassed && (scenario !== 'honey' || outcome.topicStatus === 'done') ? 'passed' : 'failed';
  return outcome;
}

export async function benchmarkNectar({ execute = runCommand, binary = 'codex', temporaryRoot = os.tmpdir(), report = console.log } = {}) {
  const output = fs.mkdtempSync(path.join(temporaryRoot, 'nectar-benchmark-'));
  const results = [];
  for (const [scenario, variant] of [['rounding', 'baseline'], ['rounding', 'nectar'], ['honey', 'nectar']]) {
    report(`[nectar-benchmark] ${scenario}/${variant}; timeout 180s; existing CLI model/effort settings unchanged`);
    results.push(await trial(output, scenario, variant, execute, binary));
    fs.writeFileSync(path.join(output, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
    report(JSON.stringify(results.at(-1)));
    if (results.at(-1).status === 'unavailable') break;
  }
  report(`[nectar-benchmark] Local artifacts: ${output}`);
  return results;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--codex')) throw new Error('Usage: node tools/benchmark-nectar.mjs [--codex /path/to/codex]');
  const results = await benchmarkNectar({ binary: args[1] || 'codex' });
  process.exitCode = results.every((result) => result.status === 'passed') ? 0 : 1;
}
