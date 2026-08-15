import fs from 'node:fs';
import path from 'node:path';

const VALID_CHECKS = new Set([
  'responseIncludes',
  'responseExcludes',
  'fixtureUnchanged',
  'pathExists',
  'pathAbsent',
  'childDirectoriesAbsent',
  'fileIncludes',
  'fileExcludes',
  'findingMatches',
  'summaryCount',
  'workspaceChangesOnly',
]);
const FINDING_CLASSES = new Set([
  'CODE_DEFECT',
  'TEST_OR_COVERAGE_GAP',
  'TEST_DEFECT',
  'DOCUMENTATION_GAP',
  'MAINTAINABILITY',
  'STYLISTIC',
  'HARDENING_IDEA',
  'PLAN_CORRECTNESS_DEFECT',
  'PLAN_COVERAGE_GAP',
  'PLAN_DEPENDENCY_DEFECT',
  'PLAN_VERIFICATION_GAP',
  'PLAN_SCOPE_DEFECT',
  'PLAN_QUALITY_IMPROVEMENT',
  'PLAN_STYLE',
]);
const SEVERITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const CONVERGENCE = new Set(['BLOCKING', 'NON_BLOCKING']);

export function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
  return normalized !== '.' && normalized !== '..' && !normalized.startsWith('../');
}

function validateCheck(check, index, source, failures) {
  const prefix = `${source}.checks[${index}]`;
  if (!check || typeof check !== 'object' || Array.isArray(check)) {
    failures.push(`${prefix} must be an object`);
    return;
  }
  if (!VALID_CHECKS.has(check.type)) {
    failures.push(`${prefix}.type must name a supported deterministic check`);
    return;
  }
  if (check.type.startsWith('response')) {
    if (typeof check.value !== 'string' || !check.value) failures.push(`${prefix}.value must be a non-empty string`);
    return;
  }
  if (check.type === 'fixtureUnchanged') return;
  if (check.type === 'findingMatches') {
    if (typeof check.where !== 'string' || !check.where) failures.push(`${prefix}.where must be a non-empty string`);
    if (!FINDING_CLASSES.has(check.class)) failures.push(`${prefix}.class must name a supported finding class`);
    if (!Array.isArray(check.severityIn) || !check.severityIn.length
      || check.severityIn.some((value) => !SEVERITIES.has(value))) {
      failures.push(`${prefix}.severityIn must contain supported severities`);
    }
    if (!CONVERGENCE.has(check.convergence)) failures.push(`${prefix}.convergence must be BLOCKING or NON_BLOCKING`);
    if (!Array.isArray(check.requiredFields) || !check.requiredFields.length
      || check.requiredFields.some((value) => typeof value !== 'string' || !value)) {
      failures.push(`${prefix}.requiredFields must contain non-empty names`);
    }
    return;
  }
  if (check.type === 'summaryCount') {
    if (typeof check.label !== 'string' || !check.label) failures.push(`${prefix}.label must be a non-empty string`);
    if (!Number.isInteger(check.value) || check.value < 0) failures.push(`${prefix}.value must be a non-negative integer`);
    return;
  }
  if (check.type === 'workspaceChangesOnly') {
    if (!Array.isArray(check.paths) || check.paths.length === 0
      || check.paths.some((entry) => !safeRelativePath(entry))) {
      failures.push(`${prefix}.paths must contain safe relative paths`);
    } else if (new Set(check.paths).size !== check.paths.length) {
      failures.push(`${prefix}.paths must not contain duplicates`);
    }
    return;
  }
  if (!safeRelativePath(check.path)) failures.push(`${prefix}.path must be a safe relative path`);
  if (check.type.startsWith('file') && (typeof check.value !== 'string' || !check.value)) {
    failures.push(`${prefix}.value must be a non-empty string`);
  }
}

export function validateContract(contract, { allowedSkills, source = 'contract' } = {}) {
  const failures = [];
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    throw new Error(`${source} must be an object`);
  }
  if (typeof contract.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(contract.id)) {
    failures.push(`${source}.id must be lowercase hyphen-case`);
  }
  if (!Array.isArray(allowedSkills) || !allowedSkills.includes(contract.skill)) {
    failures.push(`${source}.skill must name one of the selected product skills`);
  }
  if (typeof contract.prompt !== 'string' || !contract.prompt.trim()) {
    failures.push(`${source}.prompt must be a non-empty string`);
  }

  const files = contract.fixture?.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    failures.push(`${source}.fixture.files must be an object`);
  } else {
    for (const [file, content] of Object.entries(files)) {
      if (!safeRelativePath(file)) failures.push(`${source}.fixture.files.${file} must use a safe relative path`);
      if (typeof content !== 'string') failures.push(`${source}.fixture.files.${file} must contain a string`);
    }
  }

  if (!Array.isArray(contract.checks) || contract.checks.length === 0) {
    failures.push(`${source}.checks must be a non-empty array`);
  } else {
    contract.checks.forEach((check, index) => validateCheck(check, index, source, failures));
  }
  if (!Array.isArray(contract.graderCriteria) || contract.graderCriteria.length === 0
    || contract.graderCriteria.some((value) => typeof value !== 'string' || !value.trim())) {
    failures.push(`${source}.graderCriteria must contain non-empty strings`);
  }
  if (contract.tags !== undefined && (!Array.isArray(contract.tags)
    || contract.tags.some((value) => typeof value !== 'string' || !value))) {
    failures.push(`${source}.tags must contain non-empty strings`);
  }
  if (failures.length) throw new Error(failures.join('\n'));
  return contract;
}

function ensureNormalDirectory(directory) {
  if (!fs.existsSync(directory)) fs.mkdirSync(directory);
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`fixture path must be a normal directory: ${directory}`);
  }
}

function safeTarget(root, relative) {
  if (!safeRelativePath(relative)) throw new Error(`fixture path must be a safe relative path: ${relative}`);
  const target = path.resolve(root, relative);
  const relation = path.relative(root, target);
  if (relation.startsWith('..') || path.isAbsolute(relation)) {
    throw new Error(`fixture path escapes workspace: ${relative}`);
  }
  return { target, relation };
}

export function writeFixture(root, contract) {
  fs.mkdirSync(root, { recursive: true });
  ensureNormalDirectory(root);
  for (const [relative, content] of Object.entries(contract.fixture.files).sort()) {
    const { target, relation } = safeTarget(root, relative);
    const parts = relation.split(path.sep);
    let current = root;
    for (const part of parts.slice(0, -1)) {
      current = path.join(current, part);
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
        throw new Error(`symbolic links are not allowed in fixture paths: ${relative}`);
      }
      ensureNormalDirectory(current);
    }
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
      throw new Error(`symbolic links are not allowed in fixture paths: ${relative}`);
    }
    fs.writeFileSync(target, content);
  }
}

export function snapshotFixture(root) {
  const snapshot = {};
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (stat.isSymbolicLink()) throw new Error(`symbolic links are not allowed in eval fixtures: ${relative}`);
      if (stat.isDirectory()) walk(absolute);
      else if (stat.isFile()) snapshot[relative] = fs.readFileSync(absolute, 'utf8');
      else throw new Error(`unsupported eval fixture entry: ${relative}`);
    }
  }
  if (fs.existsSync(root)) walk(root);
  return snapshot;
}

export function loadContracts(directory, options) {
  if (!fs.existsSync(directory)) throw new Error(`${directory}: contract directory does not exist`);
  return fs.readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const absolute = path.join(directory, file);
      let contract;
      try {
        contract = JSON.parse(fs.readFileSync(absolute, 'utf8'));
      } catch (error) {
        throw new Error(`${file}: invalid JSON (${error.message})`);
      }
      return validateContract(contract, { ...options, source: file });
    });
}

export function selectContracts(contracts, patterns = []) {
  if (!patterns.length) return contracts;
  const expressions = patterns.map((pattern) => new RegExp(`^${pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replaceAll('*', '.*')}$`));
  return contracts.filter(({ id }) => expressions.some((expression) => expression.test(id)));
}
