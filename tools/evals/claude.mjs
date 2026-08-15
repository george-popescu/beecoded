import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { writeFixture } from './contracts.mjs';
import { evalEnvironment, runCommand } from './process.mjs';
import { normalizeResult } from './results.mjs';

function title(product) {
  return product.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function copyPlugin(source, destination) {
  fs.cpSync(source, destination, {
    recursive: true,
    filter(entry) {
      const relative = path.relative(source, entry);
      if (!relative) return true;
      const top = relative.split(path.sep)[0];
      return top !== 'node_modules' && top !== '.git';
    },
  });
}

function exposeSkill(pluginRoot, skill) {
  const source = path.join(pluginRoot, 'internal-skills', skill);
  const stat = fs.lstatSync(source);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`eval skill must be a normal directory: ${skill}`);
  const destination = path.join(pluginRoot, 'skills', skill);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
  const manifestPath = path.join(pluginRoot, '.claude-plugin', 'plugin.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.skills = './skills/';
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function promptFor(product, contract) {
  return `# ${title(product)} behavioral case: ${contract.id}\n\nUse the public \`${contract.skill}\` skill in this isolated fixture. Preserve its normal read/write and approval boundaries.\n\n## User request\n\n${contract.prompt}\n`;
}

function graderFor(contract) {
  const criteria = contract.graderCriteria.map((criterion) => `- ${criterion}`).join('\n');
  const checks = contract.checks.map((check) => `- ${check.type} ${JSON.stringify(check)}`).join('\n');
  return `# Grading criteria\n\nA passing score requires every behavioral criterion and deterministic observation.\n\n## Behavioral criteria\n\n${criteria}\n\n## Deterministic observations\n\n${checks}\n`;
}

export function createClaudeEvalWorkspace({ product, contract, pluginRoot }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${product}-claude-${contract.id}-`));
  try {
    const temporaryPluginRoot = path.join(root, product);
    copyPlugin(pluginRoot, temporaryPluginRoot);
    exposeSkill(temporaryPluginRoot, contract.skill);
    const caseRoot = path.join(temporaryPluginRoot, 'evals', contract.id);
    const promptPath = path.join(caseRoot, 'prompt.md');
    const graderPath = path.join(caseRoot, 'graders', 'criteria.md');
    const fixtureRoot = path.join(caseRoot, 'fixture');
    fs.mkdirSync(path.dirname(graderPath), { recursive: true });
    fs.writeFileSync(promptPath, promptFor(product, contract));
    fs.writeFileSync(graderPath, graderFor(contract));
    writeFixture(fixtureRoot, contract);
    return {
      root,
      pluginRoot: temporaryPluginRoot,
      caseRoot,
      promptPath,
      graderPath,
      fixtureRoot,
      cleanup() { fs.rmSync(root, { recursive: true, force: true }); },
    };
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function findCase(value, caseId) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findCase(item, caseId);
      if (found) return found;
    }
    return null;
  }
  const id = value.caseId || value.case_id || value.name || value.id;
  if (id === caseId && typeof value.score === 'number') return value;
  for (const nested of Object.values(value)) {
    const found = findCase(nested, caseId);
    if (found) return found;
  }
  return null;
}

function nativeEvidence(nativeCase, payload) {
  const evidence = nativeCase?.evidence || nativeCase?.reasons || nativeCase?.feedback || nativeCase?.summary;
  if (Array.isArray(evidence) && evidence.length) return evidence.map(String);
  if (typeof evidence === 'string' && evidence.trim()) return [evidence.trim()];
  return [`Claude native eval result: ${JSON.stringify(nativeCase || payload)}`];
}

export async function runClaudeCase({
  product,
  contract,
  pluginRoot,
  command = 'claude',
  execute = runCommand,
  keepTemp = false,
}) {
  const workspace = createClaudeEvalWorkspace({ product, contract, pluginRoot });
  try {
    let execution;
    try {
      execution = await Promise.resolve(execute(command, [
        'plugin', 'eval', workspace.pluginRoot, '--json', '--case', contract.id,
        '--ablation', 'none', '--runs', '1',
      ], {
        encoding: 'utf8',
        env: evalEnvironment(),
        maxBuffer: 10 * 1024 * 1024,
      }));
    } catch (error) {
      return normalizeResult({
        product,
        host: 'claude',
        caseId: contract.id,
        passed: false,
        score: 0,
        status: error.code === 'ENOENT' || /ENOENT/.test(error.message) ? 'unavailable' : 'failed',
        evidence: [`Claude CLI could not be executed: ${error.message}`],
      });
    }
    if (execution.error) {
      return normalizeResult({
        product,
        host: 'claude',
        caseId: contract.id,
        passed: false,
        score: 0,
        status: execution.error.code === 'ENOENT' ? 'unavailable' : 'failed',
        evidence: [`Claude CLI could not be executed: ${execution.error.message}`],
      });
    }
    let payload = null;
    try { payload = JSON.parse(String(execution.stdout || '').trim()); } catch {}
    const nativeCase = findCase(payload, contract.id);
    const score = nativeCase?.score ?? payload?.score;
    if (typeof score === 'number') {
      const normalizedScore = Math.max(0, Math.min(1, score));
      return normalizeResult({
        product,
        host: 'claude',
        caseId: contract.id,
        passed: normalizedScore >= 1,
        score: normalizedScore,
        evidence: nativeEvidence(nativeCase, payload),
      });
    }
    const combined = [execution.stderr, execution.stdout].filter(Boolean).join('\n');
    const unavailable = execution.status !== 0 && /early access|not available|unknown command|command not found/i.test(combined);
    return normalizeResult({
      product,
      host: 'claude',
      caseId: contract.id,
      passed: false,
      score: 0,
      status: unavailable ? 'unavailable' : 'failed',
      evidence: [combined || 'Claude native eval returned no parseable score'],
    });
  } finally {
    if (!keepTemp) workspace.cleanup();
  }
}
