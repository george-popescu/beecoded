import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  actorResponseArtifacts,
  normalizeResult,
  redactExcludedValues,
} from './results.mjs';
import { writeFixture } from './contracts.mjs';
import { evalEnvironment, runCommand } from './process.mjs';
import { evaluateContractChecks } from './checks.mjs';

function copyPlugin(source, destination) {
  fs.cpSync(source, destination, {
    recursive: true,
    filter(entry) {
      const relative = path.relative(source, entry);
      if (!relative) return true;
      const topLevel = relative.split(path.sep)[0];
      return topLevel !== 'node_modules' && topLevel !== '.git';
    },
  });
}

function exposeEvalSkill(pluginRoot, skillName) {
  const source = path.join(pluginRoot, 'internal-skills', skillName);
  const destination = path.join(pluginRoot, 'skills', skillName);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });

  const manifestPath = path.join(pluginRoot, '.claude-plugin', 'plugin.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.skills = './skills/';
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function promptFor(contract) {
  const fixture = Object.entries(contract.fixture.files)
    .map(([file, content]) => `### ${file}\n\`\`\`markdown\n${content.trimEnd()}\n\`\`\``)
    .join('\n\n');

  const workflow = contract.skill.replace(/^nectar-/, '');
  return `# Nectar behavioral case: ${contract.id}

Use the Nectar \`${workflow}\` skill through its public \`${contract.skill}\`
identifier for this request. Treat the fixture below as the exact initial
contents of the isolated project. When a fixture path is mentioned in the
request, operate on that path and preserve the skill's normal approval and
read/write boundaries.

## Initial project fixture

${fixture}

## User request

${contract.prompt}
`;
}

function graderFor(contract) {
  const criteria = contract.graderCriteria.map((criterion) => `- ${criterion}`).join('\n');
  const checks = contract.checks
    .map((check) => `- ${check.type} ${JSON.stringify(check)}`)
    .join('\n');

  return `# Grading criteria

Score this case from 0 to 1. A passing score requires every criterion and every
deterministic observation to hold. Use the assistant response, tool trace, and
final workspace state available to the evaluator. Quote concise evidence for
each failed requirement.

## Behavioral criteria

${criteria}

## Deterministic observations

${checks}
`;
}

export function createClaudeEvalWorkspace({ contract, pluginRoot }) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), `nectar-claude-${contract.id}-`));
  const temporaryPluginRoot = path.join(temporaryRoot, 'nectar');
  copyPlugin(pluginRoot, temporaryPluginRoot);
  exposeEvalSkill(temporaryPluginRoot, contract.skill);

  const caseRoot = path.join(temporaryPluginRoot, 'evals', contract.id);
  const promptPath = path.join(caseRoot, 'prompt.md');
  const graderPath = path.join(caseRoot, 'graders', 'criteria.md');
  const fixtureRoot = path.join(caseRoot, 'fixture');

  fs.mkdirSync(path.dirname(graderPath), { recursive: true });
  fs.writeFileSync(promptPath, promptFor(contract));
  fs.writeFileSync(graderPath, graderFor(contract));
  writeFixture(fixtureRoot, contract);

  return {
    root: temporaryRoot,
    pluginRoot: temporaryPluginRoot,
    caseRoot,
    promptPath,
    graderPath,
    fixtureRoot,
    cleanup() {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    },
  };
}

function findCaseResult(value, caseId) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findCaseResult(item, caseId);
      if (found) return found;
    }
    return null;
  }

  const id = value.caseId || value.case_id || value.name || value.id;
  if (id === caseId && typeof value.score === 'number') return value;

  for (const nested of Object.values(value)) {
    const found = findCaseResult(nested, caseId);
    if (found) return found;
  }
  return null;
}

function nativeEvidence(nativeCase, payload) {
  const evidence = nativeCase?.evidence
    || nativeCase?.reasons
    || nativeCase?.feedback
    || nativeCase?.summary;
  if (Array.isArray(evidence) && evidence.length) return evidence.map(String);
  if (typeof evidence === 'string' && evidence.trim()) return [evidence.trim()];
  return [`Claude native eval result: ${JSON.stringify(nativeCase || payload)}`];
}

export async function runClaudeCase({
  contract,
  pluginRoot,
  command = 'claude',
  execute = runCommand,
  keepTemp = false,
}) {
  const workspace = createClaudeEvalWorkspace({ contract, pluginRoot });
  const startedAt = Date.now();

  try {
    const args = [
      'plugin',
      'eval',
      workspace.pluginRoot,
      '--json',
      '--case',
      contract.id,
      '--ablation',
      'none',
      '--runs',
      '1',
      '--no-publish',
    ];
    if (contract.budgets?.claudeMaxCostUsd) {
      args.push('--max-cost-usd', String(contract.budgets.claudeMaxCostUsd));
    }
    let result;
    try {
      result = await Promise.resolve(execute(command, args, {
        encoding: 'utf8',
        env: evalEnvironment(),
        maxBuffer: 10 * 1024 * 1024,
        timeout: contract.budgets?.timeoutMs,
      }));
    } catch (error) {
      return normalizeResult({
        host: 'claude',
        caseId: contract.id,
        passed: false,
        score: 0,
        status: 'unavailable',
        evidence: [redactExcludedValues(
          contract,
          `Claude CLI could not be executed: ${error.message}`,
        )],
      });
    }

    const stdout = String(result.stdout || '').trim();
    const stderr = String(result.stderr || '').trim();
    const combinedOutput = [stderr, stdout].filter(Boolean).join('\n');
    if (result.error) {
      const unavailable = result.error.code === 'ENOENT' || /\bENOENT\b/.test(result.error.message);
      return normalizeResult({
        host: 'claude',
        caseId: contract.id,
        passed: false,
        score: 0,
        status: unavailable ? 'unavailable' : 'failed',
        evidence: [redactExcludedValues(
          contract,
          `Claude CLI could not be executed: ${result.error.message}`,
        )],
      });
    }

    let payload;
    try {
      payload = JSON.parse(stdout);
    } catch {
      payload = null;
    }

    const nativeCase = payload && findCaseResult(payload, contract.id);
    const score = nativeCase?.score ?? payload?.score;
    if (result.status === 2
      && contract.budgets?.claudeMaxCostUsd
      && (typeof score === 'number' || /(?:maximum|max).*cost|cost.*(?:ceiling|limit|reached)/i.test(stderr))) {
      return normalizeResult({
        host: 'claude',
        caseId: contract.id,
        passed: false,
        score: 0,
        evidence: ['Claude plugin eval reached the configured cost ceiling; partial numeric scores are not accepted.'],
      });
    }
    if (result.status !== 0
      && typeof score !== 'number'
      && /early access|not available|unknown command|command not found/i.test(stderr)) {
      return normalizeResult({
        host: 'claude',
        caseId: contract.id,
        passed: false,
        score: 0,
        status: 'unavailable',
        evidence: [redactExcludedValues(
          contract,
          stderr || 'Claude plugin eval is unavailable.',
        )],
      });
    }
    if (typeof score === 'number') {
      const normalizedScore = Math.max(0, Math.min(1, score));
      const response = nativeCase?.response || nativeCase?.output || nativeCase?.assistantResponse || '';
      const artifacts = response ? actorResponseArtifacts(contract, response) : undefined;
      if (result.status !== 0 && result.status !== 1) {
        return normalizeResult({
          artifacts,
          host: 'claude',
          caseId: contract.id,
          passed: false,
          score: normalizedScore,
          evidence: [redactExcludedValues(
            contract,
            combinedOutput || `Claude plugin eval exited ${result.status} with a partial score.`,
          )],
        });
      }
      if (contract.requireLocalChecks) {
        return normalizeResult({
          artifacts,
          host: 'claude',
          caseId: contract.id,
          passed: false,
          score: 0,
          status: 'unavailable',
          evidence: ['Claude native eval final workspace is not exposed authoritatively; required local final-state checks cannot be graded.'],
        });
      }
      const deterministic = contract.requireLocalChecks
        ? evaluateContractChecks({ contract, response, root: workspace.fixtureRoot })
        : { score: 1, evidence: [] };
      const combinedScore = Math.min(normalizedScore, deterministic.score);
      return normalizeResult({
        artifacts,
        host: 'claude',
        caseId: contract.id,
        passed: combinedScore >= 1,
        score: combinedScore,
        evidence: [
          ...nativeEvidence(nativeCase, payload).map((entry) => redactExcludedValues(contract, entry)),
          ...deterministic.evidence.map((entry) => redactExcludedValues(contract, entry)),
        ],
        ...(contract.requireLocalChecks || contract.budgets ? { metadata: {
          actorHost: 'claude', actorModel: nativeCase?.model || null,
          actorTimeoutMs: contract.budgets?.timeoutMs ?? null,
          costLimitEnforced: Boolean(contract.budgets?.claudeMaxCostUsd),
          costLimitUsd: contract.budgets?.claudeMaxCostUsd ?? null,
          deterministicScore: deterministic.score, elapsedMs: Date.now() - startedAt,
          judgeHost: 'claude-native', judgeModel: nativeCase?.graderModel || null,
          judgeModelSource: nativeCase?.graderModel ? 'claude-native-result' : null,
          judgeTimeoutMs: null,
          promptCharacters: fs.readFileSync(workspace.promptPath, 'utf8').length,
          responseCharacters: artifacts?.actorResponse.length ?? 0, runCount: 1,
          semanticScore: normalizedScore,
          turnLimit: Number.isInteger(nativeCase?.maxTurns) ? nativeCase.maxTurns : null,
          turnLimitEnforced: Number.isInteger(nativeCase?.maxTurns),
        } } : {}),
      });
    }

    if (result.status !== 0) {
      return normalizeResult({
        host: 'claude',
        caseId: contract.id,
        passed: false,
        score: 0,
        evidence: [redactExcludedValues(
          contract,
          combinedOutput || `Claude plugin eval exited ${result.status}.`,
        )],
      });
    }
    return normalizeResult({
      host: 'claude',
      caseId: contract.id,
      passed: false,
      score: 0,
      evidence: [
        stdout
          ? redactExcludedValues(
            contract,
            `Claude plugin eval returned invalid JSON or an unscored result: ${stdout}`,
          )
          : 'Claude plugin eval returned no JSON result.',
      ],
    });
  } finally {
    if (!keepTemp) workspace.cleanup();
  }
}
