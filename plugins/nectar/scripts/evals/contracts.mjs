import fs from 'node:fs';
import path from 'node:path';

const VALID_SKILLS = new Set([
  'nectar-audit',
  'nectar-build',
  'nectar-capture',
  'nectar-debug',
  'nectar-honey',
  'nectar-orient',
  'nectar-plan',
  'nectar-review',
  'nectar-shape',
]);

const VALID_CHECKS = new Set([
  'responseIncludes',
  'responseExcludes',
  'findingMatches',
  'summaryCount',
  'fixtureUnchanged',
  'pathExists',
  'pathAbsent',
  'childDirectoriesAbsent',
  'fileIncludes',
  'fileExcludes',
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
const CONVERGENCE_VALUES = new Set(['BLOCKING', 'NON_BLOCKING']);

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
  return normalized !== '..'
    && !normalized.startsWith('../')
    && normalized !== '.'
    && !normalized.startsWith('/');
}

function checkPathField(check, source, index, failures) {
  const field = `${source}.checks[${index}].path`;
  if (!safeRelativePath(check.path)) failures.push(`${field} must be a safe relative path`);
}

export function validateContract(contract, source = 'contract') {
  const failures = [];
  const isObject = contract && typeof contract === 'object' && !Array.isArray(contract);

  if (!isObject) {
    throw new Error(`${source} must be an object`);
  }

  if (typeof contract.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(contract.id)) {
    failures.push(`${source}.id must be lowercase hyphen-case`);
  }
  if (!VALID_SKILLS.has(contract.skill)) {
    failures.push(`${source}.skill must name a shipped Nectar skill`);
  }
  if (typeof contract.prompt !== 'string' || !contract.prompt.trim()) {
    failures.push(`${source}.prompt must be a non-empty string`);
  }

  const files = contract.fixture?.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    failures.push(`${source}.fixture.files must be an object of relative paths to string contents`);
  } else {
    for (const [file, content] of Object.entries(files)) {
      if (!safeRelativePath(file)) {
        failures.push(`${source}.fixture.files.${file} must be a safe relative path`);
      }
      if (typeof content !== 'string') {
        failures.push(`${source}.fixture.files.${file} must contain a string`);
      }
    }
  }

  if (!Array.isArray(contract.checks) || contract.checks.length === 0) {
    failures.push(`${source}.checks must be a non-empty array`);
  } else {
    contract.checks.forEach((check, index) => {
      if (!check || typeof check !== 'object' || Array.isArray(check)) {
        failures.push(`${source}.checks[${index}] must be an object`);
        return;
      }
      if (!VALID_CHECKS.has(check.type)) {
        failures.push(`${source}.checks[${index}].type must be one of ${[...VALID_CHECKS].join(', ')}`);
        return;
      }
      if (check.type === 'fixtureUnchanged') {
        // The fixture itself supplies the complete expected tree and contents.
      } else if (check.type === 'findingMatches') {
        const prefix = `${source}.checks[${index}]`;
        if (typeof check.where !== 'string' || !check.where.trim()) {
          failures.push(`${prefix}.where must be a non-empty string`);
        }
        if (!FINDING_CLASSES.has(check.class)) {
          failures.push(`${prefix}.class must name a supported finding class`);
        }
        if (!Array.isArray(check.severityIn)
          || check.severityIn.length === 0
          || check.severityIn.some((severity) => !SEVERITIES.has(severity))) {
          failures.push(`${prefix}.severityIn must contain supported severities`);
        }
        if (!CONVERGENCE_VALUES.has(check.convergence)) {
          failures.push(`${prefix}.convergence must be BLOCKING or NON_BLOCKING`);
        }
        if (!Array.isArray(check.requiredFields)
          || check.requiredFields.length === 0
          || check.requiredFields.some((field) => typeof field !== 'string' || !field.trim())) {
          failures.push(`${prefix}.requiredFields must contain non-empty field names`);
        }
      } else if (check.type === 'summaryCount') {
        const prefix = `${source}.checks[${index}]`;
        if (typeof check.label !== 'string' || !check.label.trim()) {
          failures.push(`${prefix}.label must be a non-empty string`);
        }
        if (!Number.isInteger(check.value) || check.value < 0) {
          failures.push(`${prefix}.value must be a non-negative integer`);
        }
      } else if (check.type.startsWith('response')) {
        if (typeof check.value !== 'string' || !check.value) {
          failures.push(`${source}.checks[${index}].value must be a non-empty string`);
        }
      } else {
        checkPathField(check, source, index, failures);
        if (check.type.startsWith('file') && (typeof check.value !== 'string' || !check.value)) {
          failures.push(`${source}.checks[${index}].value must be a non-empty string`);
        }
      }
    });
  }

  if (!Array.isArray(contract.graderCriteria) || contract.graderCriteria.length === 0) {
    failures.push(`${source}.graderCriteria must be a non-empty array`);
  } else if (contract.graderCriteria.some((criterion) => typeof criterion !== 'string' || !criterion.trim())) {
    failures.push(`${source}.graderCriteria entries must be non-empty strings`);
  }

  if (contract.tags !== undefined
    && (!Array.isArray(contract.tags) || contract.tags.some((tag) => typeof tag !== 'string' || !tag))) {
    failures.push(`${source}.tags must be an array of non-empty strings`);
  }

  if (failures.length) throw new Error(failures.join('\n'));
  return contract;
}

export function loadContracts(directory) {
  if (!fs.existsSync(directory)) throw new Error(`${directory}: contract directory does not exist`);

  return fs.readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const absolute = path.join(directory, file);
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(absolute, 'utf8'));
      } catch (error) {
        throw new Error(`${file}: invalid JSON (${error.message})`);
      }
      return validateContract(parsed, file);
    });
}

export function selectContracts(contracts, casePatterns = []) {
  if (!casePatterns.length) return contracts;
  const patterns = casePatterns.map((pattern) => {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replaceAll('*', '.*')
      .replaceAll('?', '.');
    return new RegExp(`^${escaped}$`);
  });
  return contracts.filter((contract) => patterns.some((pattern) => pattern.test(contract.id)));
}

export function writeFixture(root, contract) {
  for (const [relative, content] of Object.entries(contract.fixture.files)) {
    const target = path.resolve(root, relative);
    const relation = path.relative(root, target);
    if (relation.startsWith('..') || path.isAbsolute(relation)) {
      throw new Error(`${contract.id}: fixture path escapes workspace: ${relative}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}
