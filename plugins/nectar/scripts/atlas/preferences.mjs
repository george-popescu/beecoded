import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveRepositoryIdentity } from './paths.mjs';

const MODES = new Set(['auto', 'on', 'off']);
const DECISIONS = new Set(['unasked', 'enabled', 'not-now', 'never']);

function preferencesPath(options = {}) {
  const home = path.resolve(
    options.beecodedHome
      || process.env.BEECODED_HOME
      || path.join(os.homedir(), '.beecoded'),
  );
  return path.join(home, 'atlas', 'preferences.json');
}

function readPreferences(file) {
  if (!fs.existsSync(file)) return { version: 1, projects: {} };
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value?.version !== 1 || !value.projects || typeof value.projects !== 'object') {
    throw new Error('Atlas preferences are invalid');
  }
  return value;
}

function writePreferences(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(file), 0o700);
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

export function getAtlasPreference(projectRoot, options = {}) {
  const repository = options.repository || resolveRepositoryIdentity(projectRoot, {
    cacheRoot: options.cacheRoot,
  });
  if (repository.state !== 'ready') {
    return { state: 'fallback', reason: repository.reason, repository };
  }
  const stored = readPreferences(preferencesPath(options)).projects[repository.worktreeId];
  const preference = stored || { mode: 'auto', decision: 'unasked' };
  return {
    state: 'ready',
    repository,
    mode: preference.mode,
    decision: preference.decision,
    effective: preference.mode === 'on' ? 'enabled' : 'disabled',
    shouldPrompt: preference.mode === 'auto' && preference.decision === 'unasked',
    updatedAt: preference.updatedAt || null,
  };
}

export function setAtlasPreference(projectRoot, value, options = {}) {
  if (!MODES.has(value.mode) || !DECISIONS.has(value.decision)) {
    throw new TypeError('Invalid Atlas preference');
  }
  const current = getAtlasPreference(projectRoot, options);
  if (current.state !== 'ready') return current;
  const file = preferencesPath(options);
  const preferences = readPreferences(file);
  preferences.projects[current.repository.worktreeId] = {
    mode: value.mode,
    decision: value.decision,
    updatedAt: new Date().toISOString(),
  };
  writePreferences(file, preferences);
  return getAtlasPreference(projectRoot, {
    ...options,
    repository: current.repository,
  });
}

export function applyAtlasChoice(projectRoot, choice, options = {}) {
  const values = {
    enable: { mode: 'on', decision: 'enabled' },
    disable: { mode: 'off', decision: 'enabled' },
    auto: { mode: 'auto', decision: 'unasked' },
    'not-now': { mode: 'auto', decision: 'not-now' },
    never: { mode: 'off', decision: 'never' },
  };
  if (!values[choice]) throw new TypeError(`Unknown Atlas choice: ${choice}`);
  return setAtlasPreference(projectRoot, values[choice], options);
}
