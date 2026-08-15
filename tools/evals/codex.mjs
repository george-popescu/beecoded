import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { evaluateChecks } from './checks.mjs';
import { snapshotFixture, writeFixture } from './contracts.mjs';
import { evalEnvironment, runCommand } from './process.mjs';
import { normalizeResult } from './results.mjs';

function promptFor(product, contract, skillContent) {
  return `You are executing a behavioral evaluation of a plugin skill. Follow the selected skill as authoritative instructions for this turn. The working directory contains the isolated fixture.\n\n<plugin-skill product="${product}" name="${contract.skill}">\n${skillContent}\n</plugin-skill>\n\n<user-request>\n${contract.prompt}\n</user-request>\n\nReturn the normal user-facing answer. Use filesystem tools only when the skill allows them. Do not mention the evaluation.\n`;
}

export function createCodexEvalWorkspace({ product, contract, pluginRoot }) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${product}-codex-${contract.id}-`));
  try {
    const root = path.join(temporaryRoot, 'project');
    fs.mkdirSync(root);
    writeFixture(root, contract);
    const skillPath = path.join(pluginRoot, 'internal-skills', contract.skill, 'SKILL.md');
    const skillStat = fs.lstatSync(skillPath);
    if (!skillStat.isFile() || skillStat.isSymbolicLink()) throw new Error(`eval skill must be a normal file: ${contract.skill}`);
    const skillContent = fs.readFileSync(skillPath, 'utf8');
    const outputPath = path.join(temporaryRoot, 'last-message.txt');
    fs.writeFileSync(outputPath, '', { flag: 'wx', mode: 0o600 });
    return {
      temporaryRoot,
      root,
      outputPath,
      initialSnapshot: snapshotFixture(root),
      prompt: promptFor(product, contract, skillContent),
      cleanup() { fs.rmSync(temporaryRoot, { recursive: true, force: true }); },
    };
  } catch (error) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

function responseFromJsonLines(stdout) {
  const messages = [];
  for (const line of String(stdout || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      const item = event.item || event.message || event;
      if (item.type === 'agent_message' && typeof item.text === 'string') messages.push(item.text);
      if (typeof item.content === 'string') messages.push(item.content);
      if (Array.isArray(item.content)) {
        for (const part of item.content) if (typeof part?.text === 'string') messages.push(part.text);
      }
    } catch {}
  }
  return messages.at(-1) || '';
}

export async function runCodexCase({
  product,
  contract,
  pluginRoot,
  command = 'codex',
  execute = runCommand,
  keepTemp = false,
}) {
  const workspace = createCodexEvalWorkspace({ product, contract, pluginRoot });
  try {
    let execution;
    const args = [
      'exec', '--json', '--sandbox', 'workspace-write', '--skip-git-repo-check',
      '--output-last-message', workspace.outputPath, '-',
    ];
    try {
      execution = await Promise.resolve(execute(command, args, {
        cwd: workspace.root,
        input: workspace.prompt,
        encoding: 'utf8',
        env: evalEnvironment(),
        maxBuffer: 10 * 1024 * 1024,
      }));
    } catch (error) {
      return normalizeResult({
        product,
        host: 'codex',
        caseId: contract.id,
        passed: false,
        score: 0,
        status: error.code === 'ENOENT' || /ENOENT/.test(error.message) ? 'unavailable' : 'failed',
        evidence: [`Codex CLI could not be executed: ${error.message}`],
      });
    }
    if (execution.error) {
      return normalizeResult({
        product,
        host: 'codex',
        caseId: contract.id,
        passed: false,
        score: 0,
        status: execution.error.code === 'ENOENT' ? 'unavailable' : 'failed',
        evidence: [`Codex CLI could not be executed: ${execution.error.message}`],
      });
    }
    const stored = fs.readFileSync(workspace.outputPath, 'utf8').trim();
    const response = stored || responseFromJsonLines(execution.stdout);
    const checks = evaluateChecks({
      contract,
      response,
      root: workspace.root,
      initialSnapshot: workspace.initialSnapshot,
    });
    const processPassed = execution.status === 0;
    const passed = processPassed && checks.passed;
    const checkScore = checks.results.length
      ? checks.results.filter((result) => result.passed).length / checks.results.length
      : 0;
    const evidence = [
      ...(processPassed ? [] : [`Codex exited ${execution.status}: ${String(execution.stderr || '').trim() || 'no stderr'}`]),
      ...checks.evidence,
    ];
    return normalizeResult({
      product,
      host: 'codex',
      caseId: contract.id,
      passed,
      score: passed ? 1 : checkScore,
      evidence: evidence.length ? evidence : ['No deterministic checks ran'],
    });
  } finally {
    if (!keepTemp) workspace.cleanup();
  }
}
