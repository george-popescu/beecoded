import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { writeFixture } from './contracts.mjs';
import { normalizeResult } from './results.mjs';
import { evalEnvironment, runCommand } from './process.mjs';

function codexPrompt(contract, skillContent) {
  return `You are executing a behavioral evaluation of the current Nectar plugin.
Follow the Nectar skill below as authoritative instructions for this turn. The
working directory has already been populated with the shared case fixture.

<nectar-skill name="${contract.skill}">
${skillContent}
</nectar-skill>

<user-request>
${contract.prompt}
</user-request>

Return your normal user-facing answer. Use filesystem tools only when the skill
allows them. Do not mention that this is an evaluation.
`;
}

export function createCodexEvalWorkspace({ contract, pluginRoot }) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), `nectar-codex-${contract.id}-`));
  const root = path.join(temporaryRoot, 'project');
  fs.mkdirSync(root);
  writeFixture(root, contract);
  const skillPath = path.join(pluginRoot, 'internal-skills', contract.skill, 'SKILL.md');
  const skillContent = fs.readFileSync(skillPath, 'utf8');
  const outputPath = path.join(temporaryRoot, '.nectar-eval-last-message.txt');
  fs.writeFileSync(outputPath, '', { flag: 'wx', mode: 0o600 });

  return {
    temporaryRoot,
    root,
    outputPath,
    prompt: codexPrompt(contract, skillContent),
    cleanup() {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    },
  };
}

function extractResponse(stdout) {
  const messages = [];
  for (const line of String(stdout || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      const item = event.item || event.message || event;
      if (item.type === 'agent_message' && typeof item.text === 'string') messages.push(item.text);
      if (typeof item.content === 'string') messages.push(item.content);
      if (Array.isArray(item.content)) {
        for (const part of item.content) {
          if (typeof part?.text === 'string') messages.push(part.text);
        }
      }
    } catch {
      // `--json` should be JSONL, but the output-last-message file is authoritative.
    }
  }
  return messages.at(-1) || '';
}

function safeCheckTarget(root, checkPath) {
  const target = path.resolve(root, checkPath);
  const relation = path.relative(root, target);
  if (relation.startsWith('..') || path.isAbsolute(relation)) {
    return { error: `path escapes the eval workspace: ${checkPath}` };
  }

  let current = root;
  let stat = fs.lstatSync(root);
  for (const part of relation ? relation.split(path.sep) : []) {
    current = path.join(current, part);
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code === 'ENOENT') return { target, exists: false, stat: null };
      throw error;
    }
    if (stat.isSymbolicLink()) {
      return { error: `symbolic links are not allowed in eval check paths: ${checkPath}` };
    }
  }

  const realRoot = fs.realpathSync(root);
  const realTarget = fs.realpathSync(target);
  const realRelation = path.relative(realRoot, realTarget);
  if (realRelation.startsWith('..') || path.isAbsolute(realRelation)) {
    return { error: `resolved path escapes the eval workspace: ${checkPath}` };
  }
  return { target, exists: true, stat };
}

function normalizeFieldName(value) {
  return String(value).toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseFindings(response) {
  const findings = [];
  let current = null;

  for (const line of String(response || '').split('\n')) {
    const heading = line.match(/^\s*###\s+\[(CRITICAL|HIGH|MEDIUM|LOW)\]\s+(.+)$/i);
    if (heading) {
      current = {
        severity: heading[1].toLocaleUpperCase(),
        title: heading[2].trim(),
        fields: new Map(),
      };
      findings.push(current);
      continue;
    }
    if (!current) continue;
    const field = line.match(/^\s*-\s+\*\*([^*]+):\*\*\s*(.+?)\s*$/);
    if (field) current.fields.set(normalizeFieldName(field[1]), field[2].trim());
  }

  return findings;
}

function fieldHasToken(value, expected) {
  const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Z0-9_])${escaped}([^A-Z0-9_]|$)`, 'i').test(value || '');
}

function fieldHasCanonicalReference(value, expected) {
  const source = String(value || '').toLocaleLowerCase();
  const target = String(expected || '').toLocaleLowerCase();
  const beforeBoundary = (character) => !character || /[\s`'"([{]/.test(character);
  const afterBoundary = (character) => !character || /[\s`'":#)\]},;–—]/.test(character);

  let offset = source.indexOf(target);
  while (offset !== -1) {
    const before = source[offset - 1] || '';
    const after = source[offset + target.length] || '';
    if (beforeBoundary(before) && afterBoundary(after)) return true;
    offset = source.indexOf(target, offset + 1);
  }
  return false;
}

const ENUM_FIELDS = new Map([
  ['reachability', ['REACHABLE', 'CONDITIONALLY_REACHABLE', 'UNREACHABLE', 'NOT_APPLICABLE']],
  ['likelihood', ['COMMON', 'OCCASIONAL', 'RARE', 'VERY_RARE', 'NOT_APPLICABLE']],
  ['probability', ['COMMON', 'OCCASIONAL', 'RARE', 'VERY_RARE']],
  ['exploitability', ['NOT_APPLICABLE', 'ACCIDENTAL_ONLY', 'OPPORTUNISTIC', 'DELIBERATE']],
  ['solutionopportunity', ['HIGH', 'MEDIUM', 'LOW']],
  ['confidence', ['HIGH', 'MEDIUM', 'LOW']],
  ['disposition', ['FIX_NOW', 'ASK_USER', 'DEFER', 'DISCARD']],
]);

function hasMeaningfulProse(value) {
  const words = String(value || '').match(/[a-z0-9]+/gi) || [];
  return String(value || '').trim().length >= 8
    && words.length >= 2
    && words.some((word) => word.length >= 3);
}

function fieldMatchesShape(name, value) {
  if (!value || /^<.*>$/.test(value)) return false;
  const normalizedName = normalizeFieldName(name);
  const allowed = ENUM_FIELDS.get(normalizedName);
  if (!allowed) return hasMeaningfulProse(value);

  const match = String(value).trim().match(/^`?([A-Z_]+)`?(.*)$/i);
  if (!match || !allowed.includes(match[1].toLocaleUpperCase())) return false;
  if (normalizedName === 'disposition') return true;

  const reason = match[2].replace(/^\s*(?:—|-|:)\s*/, '').trim();
  return hasMeaningfulProse(reason);
}

function narrativePayload(name, value) {
  const normalizedName = normalizeFieldName(name);
  let payload = String(value || '').trim();
  if (ENUM_FIELDS.has(normalizedName)) {
    payload = payload.replace(/^`?[A-Z_]+`?\s*(?:—|-|:)?\s*/i, '');
  }
  return payload.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function hasDiverseFindingContent(finding, check) {
  const field = (name) => finding.fields.get(normalizeFieldName(name)) || '';
  if (!fieldMatchesShape('Evidence', field('Evidence'))) return false;

  const names = [...new Set(['Evidence', ...check.requiredFields])]
    .filter((name) => normalizeFieldName(name) !== 'disposition');
  const payloads = names
    .map((name) => narrativePayload(name, field(name)))
    .filter(Boolean);
  return new Set(payloads).size >= Math.min(3, names.length);
}

function evaluateFindingMatch(check, response) {
  const findings = parseFindings(response);
  const match = findings.find((finding) => {
    const field = (name) => finding.fields.get(normalizeFieldName(name)) || '';
    return check.severityIn.includes(finding.severity)
      && fieldHasToken(field('Class'), check.class)
      && fieldHasCanonicalReference(field('Where'), check.where)
      && fieldHasToken(field('Convergence'), check.convergence)
      && hasDiverseFindingContent(finding, check)
      && check.requiredFields.every((name) => {
        const value = field(name);
        return fieldMatchesShape(name, value);
      });
  });
  return {
    passed: Boolean(match),
    evidence: `${match ? 'PASS' : 'FAIL'} findingMatches ${check.where} ${check.class} ${check.convergence}`,
  };
}

function expectedFixtureTree(fixtureFiles) {
  const directories = new Set();
  for (const relative of Object.keys(fixtureFiles)) {
    let parent = path.posix.dirname(relative.replaceAll('\\', '/'));
    while (parent && parent !== '.') {
      directories.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  return {
    directories: [...directories].sort(),
    files: Object.keys(fixtureFiles).map((file) => file.replaceAll('\\', '/')).sort(),
  };
}

function actualFixtureTree(root) {
  const directories = [];
  const files = [];
  const contents = new Map();
  let unsafe = '';

  function walk(directory, prefix = '') {
    for (const name of fs.readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        unsafe = relative;
        return;
      }
      if (stat.isDirectory()) {
        directories.push(relative);
        walk(absolute, relative);
        if (unsafe) return;
      } else if (stat.isFile()) {
        files.push(relative);
        contents.set(relative, fs.readFileSync(absolute, 'utf8'));
      } else {
        unsafe = relative;
        return;
      }
    }
  }

  walk(root);
  return { directories, files, contents, unsafe };
}

function evaluateFixtureUnchanged(root, fixtureFiles) {
  const expected = expectedFixtureTree(fixtureFiles);
  const actual = actualFixtureTree(root);
  const shapeMatches = !actual.unsafe
    && JSON.stringify(actual.directories) === JSON.stringify(expected.directories)
    && JSON.stringify(actual.files) === JSON.stringify(expected.files);
  const contentMatches = shapeMatches && expected.files.every(
    (file) => actual.contents.get(file) === fixtureFiles[file],
  );
  const passed = shapeMatches && contentMatches;
  return {
    passed,
    evidence: `${passed ? 'PASS' : 'FAIL'} fixtureUnchanged${actual.unsafe ? ` unsafe=${actual.unsafe}` : ''}`,
  };
}

function evaluateSummaryCount(check, response) {
  const escaped = check.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(response || '').match(new RegExp(`^\\s*${escaped}:\\s*(\\d+)\\s*$`, 'im'));
  const actual = match ? Number(match[1]) : null;
  const passed = actual === check.value;
  return {
    passed,
    evidence: `${passed ? 'PASS' : 'FAIL'} summaryCount ${JSON.stringify(check.label)} expected=${check.value} actual=${actual ?? 'missing'}`,
  };
}

function evaluateCheck(check, response, root, fixtureFiles) {
  const lowerResponse = response.toLocaleLowerCase();
  if (check.type === 'responseIncludes') {
    const passed = lowerResponse.includes(check.value.toLocaleLowerCase());
    return {
      passed,
      evidence: `${passed ? 'PASS' : 'FAIL'} responseIncludes ${JSON.stringify(check.value)}`,
    };
  }
  if (check.type === 'responseExcludes') {
    const passed = !lowerResponse.includes(check.value.toLocaleLowerCase());
    return {
      passed,
      evidence: `${passed ? 'PASS' : 'FAIL'} responseExcludes ${JSON.stringify(check.value)}`,
    };
  }
  if (check.type === 'findingMatches') return evaluateFindingMatch(check, response);
  if (check.type === 'summaryCount') return evaluateSummaryCount(check, response);
  if (check.type === 'fixtureUnchanged') return evaluateFixtureUnchanged(root, fixtureFiles);

  const resolved = safeCheckTarget(root, check.path);
  if (resolved.error) {
    return { passed: false, evidence: `FAIL unsafe check path ${check.path}: ${resolved.error}` };
  }
  const { target } = resolved;

  if (check.type === 'pathExists' || check.type === 'pathAbsent') {
    const exists = resolved.exists;
    const passed = check.type === 'pathExists' ? exists : !exists;
    return {
      passed,
      evidence: `${passed ? 'PASS' : 'FAIL'} ${check.type} ${check.path}`,
    };
  }

  if (check.type === 'childDirectoriesAbsent') {
    const targetIsDirectory = resolved.exists && resolved.stat.isDirectory();
    const entries = targetIsDirectory
      ? fs.readdirSync(target, { withFileTypes: true })
      : [];
    const unsafeLinks = entries
      .filter((entry) => entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort();
    if (unsafeLinks.length) {
      return {
        passed: false,
        evidence: `FAIL unsafe symbolic child in ${check.path}: ${unsafeLinks.join(',')}`,
      };
    }
    const children = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const passed = targetIsDirectory && children.length === 0;
    return {
      passed,
      evidence: `${passed ? 'PASS' : 'FAIL'} childDirectoriesAbsent ${check.path}${!targetIsDirectory ? ' target-missing-or-not-directory' : children.length ? ` found=${children.join(',')}` : ''}`,
    };
  }

  const content = resolved.exists && resolved.stat.isFile()
    ? fs.readFileSync(target, 'utf8')
    : '';
  const contains = content.includes(check.value);
  const passed = check.type === 'fileIncludes' ? contains : !contains;
  return {
    passed,
    evidence: `${passed ? 'PASS' : 'FAIL'} ${check.type} ${check.path} ${JSON.stringify(check.value)}`,
  };
}

function readCapturedResponse(workspace) {
  const output = workspace.outputPath;
  const stat = fs.lstatSync(output);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('Codex output capture is not a safe regular file.');
  }
  const realRoot = fs.realpathSync(workspace.temporaryRoot);
  const realOutput = fs.realpathSync(output);
  const relation = path.relative(realRoot, realOutput);
  if (relation.startsWith('..') || path.isAbsolute(relation)) {
    throw new Error('Codex output capture escapes its temporary root.');
  }
  return fs.readFileSync(output, 'utf8').trim();
}

export async function runCodexCase({
  contract,
  pluginRoot,
  command = 'codex',
  execute = runCommand,
  keepTemp = false,
}) {
  const workspace = createCodexEvalWorkspace({ contract, pluginRoot });

  try {
    const args = [
      'exec',
      '--ephemeral',
      '--skip-git-repo-check',
      '--json',
      '--sandbox',
      'workspace-write',
      '--cd',
      workspace.root,
      '--output-last-message',
      workspace.outputPath,
      '-',
    ];
    let result;
    try {
      result = await Promise.resolve(execute(command, args, {
        cwd: workspace.root,
        input: workspace.prompt,
        encoding: 'utf8',
        env: evalEnvironment(),
        maxBuffer: 10 * 1024 * 1024,
      }));
    } catch (error) {
      return normalizeResult({
        host: 'codex',
        caseId: contract.id,
        passed: false,
        score: 0,
        status: 'unavailable',
        evidence: [`Codex CLI could not be executed: ${error.message}`],
      });
    }

    if (result.error) {
      const unavailable = result.error.code === 'ENOENT' || /\bENOENT\b/.test(result.error.message);
      return normalizeResult({
        host: 'codex',
        caseId: contract.id,
        passed: false,
        score: 0,
        status: unavailable ? 'unavailable' : 'failed',
        evidence: [`Codex CLI could not be executed: ${result.error.message}`],
      });
    }
    if (result.status !== 0) {
      return normalizeResult({
        host: 'codex',
        caseId: contract.id,
        passed: false,
        score: 0,
        evidence: [
          String(result.stderr || result.stdout || `Codex exec exited ${result.status}.`).trim(),
        ],
      });
    }

    let captured;
    try {
      captured = readCapturedResponse(workspace);
    } catch (error) {
      return normalizeResult({
        host: 'codex',
        caseId: contract.id,
        passed: false,
        score: 0,
        evidence: [`Unsafe Codex output capture: ${error.message}`],
      });
    }
    const response = captured || extractResponse(result.stdout);
    const checks = contract.checks.map((check) => (
      evaluateCheck(check, response, workspace.root, contract.fixture.files)
    ));
    const passedCount = checks.filter((check) => check.passed).length;
    const score = checks.length ? passedCount / checks.length : 0;

    return normalizeResult({
      host: 'codex',
      caseId: contract.id,
      passed: score === 1,
      score,
      evidence: checks.map((check) => check.evidence),
    });
  } finally {
    if (!keepTemp) workspace.cleanup();
  }
}
