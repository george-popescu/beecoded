import fs from 'node:fs';
import path from 'node:path';

import { safeRelativePath, snapshotFixture } from './contracts.mjs';

function safeCheckTarget(root, checkPath) {
  if (!safeRelativePath(checkPath)) return { error: `path must be a safe relative path: ${checkPath}` };
  const target = path.resolve(root, checkPath);
  const relation = path.relative(root, target);
  if (relation.startsWith('..') || path.isAbsolute(relation)) return { error: `path escapes eval workspace: ${checkPath}` };

  let current = root;
  for (const part of relation.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) return { target, exists: false, stat: null };
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) return { error: `symbolic links are not allowed in eval check paths: ${checkPath}` };
  }
  return { target, exists: fs.existsSync(target), stat: fs.existsSync(target) ? fs.lstatSync(target) : null };
}

function normalizeField(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function fieldHasCanonicalReference(value, expected) {
  const source = String(value || '').toLowerCase();
  const target = String(expected || '').toLowerCase();
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

function parseFindings(response) {
  const findings = [];
  let current = null;
  for (const line of String(response).split('\n')) {
    const heading = line.match(/^\s*###\s+\[(CRITICAL|HIGH|MEDIUM|LOW)\]\s+(.+)$/i);
    if (heading) {
      current = { severity: heading[1].toUpperCase(), title: heading[2].trim(), fields: new Map() };
      findings.push(current);
      continue;
    }
    if (!current) continue;
    const field = line.match(/^\s*-\s+\*\*([^*]+):\*\*\s*(.*?)\s*$/);
    if (field) current.fields.set(normalizeField(field[1]), field[2]);
  }
  return findings;
}

function result(check, passed, evidence) {
  return { check, passed, evidence };
}

function compareSnapshots(initial, current) {
  const paths = [...new Set([...Object.keys(initial), ...Object.keys(current)])].sort();
  const changed = paths.filter((file) => initial[file] !== current[file]);
  return changed;
}

function evaluateOne({ check, response, root, initialSnapshot, findings }) {
  if (check.type === 'responseIncludes') {
    const passed = response.includes(check.value);
    return result(check, passed, passed ? `response includes ${check.value}` : `response missing ${check.value}`);
  }
  if (check.type === 'responseExcludes') {
    const passed = !response.includes(check.value);
    return result(check, passed, passed ? `response excludes ${check.value}` : `response unexpectedly includes ${check.value}`);
  }
  if (check.type === 'fixtureUnchanged') {
    try {
      const changed = compareSnapshots(initialSnapshot, snapshotFixture(root));
      return result(check, changed.length === 0, changed.length ? `fixture changed: ${changed.join(', ')}` : 'fixture unchanged');
    } catch (error) {
      return result(check, false, error.message);
    }
  }
  if (check.type === 'findingMatches') {
    const expectedFields = check.requiredFields.map(normalizeField);
    const match = findings.find((finding) => (
      check.severityIn.includes(finding.severity)
      && fieldHasCanonicalReference(finding.fields.get('where'), check.where)
      && normalizeField(finding.fields.get('class')) === normalizeField(check.class)
      && normalizeField(finding.fields.get('convergence')) === normalizeField(check.convergence)
      && expectedFields.every((field) => finding.fields.has(field))
    ));
    return result(check, Boolean(match), match ? `matched finding ${match.title}` : `no finding matched ${check.where}`);
  }
  if (check.type === 'summaryCount') {
    const escaped = check.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = response.match(new RegExp(`^\\s*${escaped}:\\s*(\\d+)\\s*$`, 'im'));
    const actual = match ? Number(match[1]) : null;
    return result(check, actual === check.value, actual === null
      ? `summary label missing: ${check.label}`
      : `${check.label} expected ${check.value}, found ${actual}`);
  }
  if (check.type === 'workspaceChangesOnly') {
    try {
      const changed = compareSnapshots(initialSnapshot, snapshotFixture(root));
      const allowed = new Set(check.paths);
      const unexpected = changed.filter((file) => !allowed.has(file));
      return result(
        check,
        unexpected.length === 0,
        unexpected.length
          ? `workspace changed outside allowlist: ${unexpected.join(', ')}`
          : `workspace changes limited to: ${changed.join(', ') || 'none'}`,
      );
    } catch (error) {
      return result(check, false, error.message);
    }
  }

  const target = safeCheckTarget(root, check.path);
  if (target.error) return result(check, false, target.error);
  if (check.type === 'pathExists') {
    return result(check, target.exists, target.exists ? `path exists: ${check.path}` : `path missing: ${check.path}`);
  }
  if (check.type === 'pathAbsent') {
    return result(check, !target.exists, !target.exists ? `path absent: ${check.path}` : `path unexpectedly exists: ${check.path}`);
  }
  if (check.type === 'childDirectoriesAbsent') {
    if (!target.exists) return result(check, false, `protected parent missing: ${check.path}`);
    if (!target.stat.isDirectory()) return result(check, false, `path is not a directory: ${check.path}`);
    const entries = fs.readdirSync(target.target, { withFileTypes: true });
    const symbolicChildren = entries.filter((entry) => entry.isSymbolicLink());
    if (symbolicChildren.length) {
      return result(
        check,
        false,
        `symbolic children present: ${symbolicChildren.map(({ name }) => name).sort().join(', ')}`,
      );
    }
    const children = entries.filter((entry) => entry.isDirectory());
    return result(check, children.length === 0, children.length
      ? `child directories present: ${children.map(({ name }) => name).join(', ')}`
      : `no child directories under ${check.path}`);
  }
  if (!target.exists || !target.stat.isFile()) {
    return result(check, false, `file missing: ${check.path}`);
  }
  const content = fs.readFileSync(target.target, 'utf8');
  if (check.type === 'fileIncludes') {
    const passed = content.includes(check.value);
    return result(check, passed, passed ? `file includes ${check.value}` : `file missing ${check.value}`);
  }
  const passed = !content.includes(check.value);
  return result(check, passed, passed ? `file excludes ${check.value}` : `file unexpectedly includes ${check.value}`);
}

export function evaluateChecks({ contract, response, root, initialSnapshot }) {
  const findings = parseFindings(response);
  const results = contract.checks.map((check) => evaluateOne({
    check,
    response: String(response || ''),
    root,
    initialSnapshot,
    findings,
  }));
  return {
    passed: results.every(({ passed }) => passed),
    results,
    evidence: results.map(({ evidence }) => evidence),
  };
}
