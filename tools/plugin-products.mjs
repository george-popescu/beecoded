import path from 'node:path';

const PRODUCT_KINDS = new Set(['bee', 'nectar', 'skills-only']);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isSafeRelative(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
  return normalized !== '.' && normalized !== '..' && !normalized.startsWith('../');
}

function assertStringArray(value, field, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(`${field} must contain ${allowEmpty ? 'an array of' : 'at least one'} skill${allowEmpty ? ' names' : ''}`);
  }
  if (value.some((entry) => typeof entry !== 'string' || !entry)) {
    throw new Error(`${field} must contain non-empty strings`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${field} must not contain duplicates`);
}

function validateDefinition(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new Error('plugin product definition must be an object');
  }
  const { id } = definition;
  if (typeof id !== 'string' || !SLUG.test(id)) {
    throw new Error('plugin product id must be lowercase hyphen-case');
  }
  if (!PRODUCT_KINDS.has(definition.kind)) {
    throw new Error(`${id}.kind must be bee, nectar, or skills-only`);
  }
  if (definition.packageName !== `@beecoded/${id}`) {
    throw new Error(`${id}.packageName must be @beecoded/${id}`);
  }
  if (definition.packageRoot !== `plugins/${id}`) {
    throw new Error(`${id}.packageRoot must be plugins/${id}`);
  }
  if (typeof definition.managedInstaller !== 'boolean') {
    throw new Error(`${id}.managedInstaller must be boolean`);
  }

  assertStringArray(
    definition.publicSkills,
    `${id}.publicSkills`,
    { allowEmpty: definition.kind !== 'skills-only' },
  );
  for (const skill of definition.publicSkills) {
    if (!SLUG.test(skill)) throw new Error(`${id}.publicSkills contains invalid skill ${skill}`);
  }

  assertStringArray(definition.reservedSkillPrefixes, `${id}.reservedSkillPrefixes`);
  for (const prefix of definition.reservedSkillPrefixes) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*-$/.test(prefix)) {
      throw new Error(`${id}.reservedSkillPrefixes contains invalid prefix ${prefix}`);
    }
  }

  if (definition.evalContracts !== null && !isSafeRelative(definition.evalContracts)) {
    throw new Error(`${id}.evalContracts must be null or a safe relative path`);
  }

  return Object.freeze({
    ...definition,
    publicSkills: Object.freeze([...definition.publicSkills]),
    reservedSkillPrefixes: Object.freeze([...definition.reservedSkillPrefixes]),
  });
}

export function defineProductRegistry(definitions) {
  if (!Array.isArray(definitions) || definitions.length === 0) {
    throw new Error('plugin product registry must contain at least one definition');
  }

  const registry = new Map();
  const packageOwners = new Map();
  const rootOwners = new Map();
  for (const candidate of definitions) {
    const definition = validateDefinition(candidate);
    if (registry.has(definition.id)) throw new Error(`duplicate plugin product id: ${definition.id}`);
    if (packageOwners.has(definition.packageName)) {
      throw new Error(`package ${definition.packageName} is owned by both ${packageOwners.get(definition.packageName)} and ${definition.id}`);
    }
    if (rootOwners.has(definition.packageRoot)) {
      throw new Error(`package root ${definition.packageRoot} is owned by both ${rootOwners.get(definition.packageRoot)} and ${definition.id}`);
    }
    registry.set(definition.id, definition);
    packageOwners.set(definition.packageName, definition.id);
    rootOwners.set(definition.packageRoot, definition.id);
  }

  const skillOwners = new Map();
  const prefixOwners = [];
  for (const definition of registry.values()) {
    for (const prefix of definition.reservedSkillPrefixes) {
      const duplicate = prefixOwners.find((entry) => entry.prefix === prefix);
      if (duplicate) {
        throw new Error(`reserved prefix ${prefix} is owned by both ${duplicate.owner} and ${definition.id}`);
      }
      prefixOwners.push({ prefix, owner: definition.id });
    }
    for (const skill of definition.publicSkills) {
      const existing = skillOwners.get(skill);
      if (existing) {
        throw new Error(`public skill ${skill} is owned by both ${existing} and ${definition.id}`);
      }
      skillOwners.set(skill, definition.id);
    }
  }

  for (const [skill, owner] of skillOwners) {
    const collision = prefixOwners.find(({ prefix, owner: prefixOwner }) => (
      prefixOwner !== owner && skill.startsWith(prefix)
    ));
    if (collision) {
      throw new Error(`public skill ${skill} collides with ${collision.owner} reserved prefix ${collision.prefix}`);
    }
  }

  return registry;
}

const productRegistry = defineProductRegistry([
  {
    id: 'bee',
    kind: 'bee',
    packageName: '@beecoded/bee',
    packageRoot: 'plugins/bee',
    publicSkills: [],
    reservedSkillPrefixes: ['bee-'],
    managedInstaller: true,
    evalContracts: null,
  },
  {
    id: 'nectar',
    kind: 'nectar',
    packageName: '@beecoded/nectar',
    packageRoot: 'plugins/nectar',
    publicSkills: [
      'nectar-audit',
      'nectar-build',
      'nectar-capture',
      'nectar-context',
      'nectar-debug',
      'nectar-honey',
      'nectar-orient',
      'nectar-plan',
      'nectar-review',
      'nectar-shape',
    ],
    reservedSkillPrefixes: ['nectar-'],
    managedInstaller: true,
    evalContracts: 'plugins/nectar/evals/contracts',
  },
  {
    id: 'code-audit',
    kind: 'skills-only',
    packageName: '@beecoded/code-audit',
    packageRoot: 'plugins/code-audit',
    publicSkills: ['code-audit'],
    reservedSkillPrefixes: [],
    managedInstaller: true,
    evalContracts: 'plugins/code-audit/evals/contracts',
  },
  {
    id: 'ui-ux-audit',
    kind: 'skills-only',
    packageName: '@beecoded/ui-ux-audit',
    packageRoot: 'plugins/ui-ux-audit',
    publicSkills: ['ui-ux-audit'],
    reservedSkillPrefixes: [],
    managedInstaller: true,
    evalContracts: 'plugins/ui-ux-audit/evals/contracts',
  },
]);

export function getProductDefinition(id) {
  const definition = productRegistry.get(id);
  if (!definition) throw new Error(`Unknown plugin product: ${id}`);
  return definition;
}

export function listProductDefinitions() {
  return [...productRegistry.values()];
}
