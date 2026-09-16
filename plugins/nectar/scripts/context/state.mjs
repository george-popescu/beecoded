import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const DEFAULT_THRESHOLDS = Object.freeze({
  staleDays: 14,
  expiredDays: 30,
  staleFiles: 20,
  expiredFiles: 100,
});

const MANAGED_FILES = Object.freeze([
  'CONTEXT.md',
  'CONVENTIONS.md',
  'context.json',
]);
const DOCUMENT_LIMIT_BYTES = 6 * 1024;
const GIT_ROUTING_VARIABLES = new Set([
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CEILING_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CONFIG',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_SYSTEM',
  'GIT_DIR',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_INDEX_FILE',
  'GIT_NAMESPACE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_PREFIX',
  'GIT_QUARANTINE_PATH',
  'GIT_SHALLOW_FILE',
  'GIT_WORK_TREE',
]);

export function normalizeThresholds(overrides = {}) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...overrides };
  for (const [name, value] of Object.entries(thresholds)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
  }
  if (thresholds.staleDays >= thresholds.expiredDays) {
    throw new Error('staleDays must be lower than expiredDays');
  }
  if (thresholds.staleFiles >= thresholds.expiredFiles) {
    throw new Error('staleFiles must be lower than expiredFiles');
  }
  return thresholds;
}

function safeContextDirectory(projectRoot, directoryName) {
  const resolvedRoot = path.resolve(projectRoot);
  const realProjectRoot = fs.realpathSync(resolvedRoot);
  const contextRoot = path.join(resolvedRoot, directoryName);
  let contextStat;
  try {
    contextStat = fs.lstatSync(contextRoot);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (contextStat.isSymbolicLink() || !contextStat.isDirectory()) {
    throw new Error(`${directoryName} must be a non-symlink directory inside the project root`);
  }
  const realContextRoot = fs.realpathSync(contextRoot);
  if (!isInside(realProjectRoot, realContextRoot)) {
    throw new Error(`${directoryName} must stay inside the project root`);
  }
  return { root: contextRoot, realRoot: realContextRoot };
}

function hasSafeContextDocuments(directory, label) {
  if (!directory) return false;
  const documents = ['CONTEXT.md', 'CONVENTIONS.md'];
  if (!documents.every((file) => fs.existsSync(path.join(directory.root, file)))) {
    return false;
  }
  for (const file of documents) {
    const candidate = path.join(directory.root, file);
    const candidateStat = fs.lstatSync(candidate);
    if (candidateStat.isSymbolicLink() || !candidateStat.isFile()) {
      throw new Error(`${label}/${file} must be a regular non-symlink file`);
    }
    if (path.dirname(fs.realpathSync(candidate)) !== directory.realRoot) {
      throw new Error(`${label}/${file} must stay inside the project root`);
    }
  }
  return true;
}

function existingContextSource(projectRoot) {
  const nectar = safeContextDirectory(projectRoot, '.nectar');
  if (hasSafeContextDocuments(nectar, '.nectar')) {
    return { source: 'nectar', ...nectar };
  }
  const bee = safeContextDirectory(projectRoot, '.bee');
  if (hasSafeContextDocuments(bee, '.bee')) {
    return { source: 'bee', ...bee };
  }
  return null;
}

function readMetadata(active) {
  if (active?.source !== 'nectar') return null;
  const metadataPath = path.join(active.root, 'context.json');
  if (!fs.existsSync(metadataPath)) return null;
  const metadataStat = fs.lstatSync(metadataPath);
  if (metadataStat.isSymbolicLink() || !metadataStat.isFile()) {
    throw new Error('.nectar/context.json must be a regular non-symlink file');
  }
  if (path.dirname(fs.realpathSync(metadataPath)) !== active.realRoot) {
    throw new Error('.nectar/context.json must stay inside the project root');
  }
  return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
}

function gitEnvironment() {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (GIT_ROUTING_VARIABLES.has(key)
      || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key)) {
      delete environment[key];
    }
  }
  environment.GIT_OPTIONAL_LOCKS = '0';
  return environment;
}

function runGit(projectRoot, args) {
  return spawnSync('git', [
    '--no-optional-locks',
    '-c',
    'core.fsmonitor=false',
    ...args,
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: gitEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function isIgnoredDrift(relativePath) {
  return relativePath === '.nectar'
    || relativePath.startsWith('.nectar/')
    || relativePath === '.bee'
    || relativePath.startsWith('.bee/')
    || relativePath === 'docs/work'
    || relativePath.startsWith('docs/work/');
}

function isStructuralFile(relativePath) {
  const base = path.posix.basename(relativePath);
  return base === 'AGENTS.md'
    || base === 'CLAUDE.md'
    || /^package(?:-lock)?\.json$/.test(base)
    || /^(?:pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|composer\.lock|Gemfile\.lock|Cargo\.lock|go\.sum)$/.test(base)
    || /(?:^|\/)(?:routes?|routing|config|configuration)(?:\/|\.|$)/i.test(relativePath);
}

export function classifyContextImpact({ changedFiles = [], citedPaths = [] } = {}) {
  const cited = new Set(citedPaths.map((entry) => entry.split(path.sep).join('/')));
  const reasons = new Set();
  const sourcePattern = /\.(?:[cm]?[jt]sx?|php|py|rb|go|rs|java|kt|kts|swift|cs|cpp|cc|c|h)$/i;
  const volatile = (relativePath) => {
    const base = path.posix.basename(relativePath);
    return relativePath === 'docs/work'
      || relativePath.startsWith('docs/work/')
      || /^CHANGELOG(?:\..+)?$/i.test(base)
      || /(?:^|\/)(?:tests?|specs?|reports?|coverage)(?:\/|$)/i.test(relativePath)
      || /\.(?:test|spec)\.[^.]+$/i.test(base);
  };

  for (const candidate of changedFiles) {
    const relativePath = candidate.split(path.sep).join('/');
    if (cited.has(relativePath)) reasons.add('cited-evidence');
    else if (isStructuralFile(relativePath)) reasons.add('structural');
    else if (volatile(relativePath)) continue;
    else if (sourcePattern.test(relativePath)) reasons.add('source-or-module');
    else reasons.add('unknown');
  }
  if (!reasons.size) return { decision: 'skip', reasons: ['volatile-only'] };
  // Paths establish structural/citation impact, not whether ordinary code changes
  // alter facts in the project map. Let the delivery owner assess that known diff.
  const decision = reasons.has('structural') || reasons.has('cited-evidence')
    ? 'refresh'
    : 'review';
  return { decision, reasons: [...reasons].sort() };
}

function inspectGit(projectRoot, baseCommit) {
  const inside = runGit(projectRoot, ['rev-parse', '--is-inside-work-tree']);
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
    return {
      available: false,
      baseResolvable: null,
      headCommit: null,
      changedFiles: [],
      structuralChanges: [],
    };
  }

  const head = runGit(projectRoot, ['rev-parse', 'HEAD']);
  const headCommit = head.status === 0 ? head.stdout.trim() : null;
  if (!baseCommit) {
    return {
      available: true,
      baseResolvable: false,
      headCommit,
      changedFiles: [],
      structuralChanges: [],
    };
  }

  const base = runGit(projectRoot, ['cat-file', '-e', `${baseCommit}^{commit}`]);
  if (base.status !== 0) {
    return {
      available: true,
      baseResolvable: false,
      headCommit,
      changedFiles: [],
      structuralChanges: [],
    };
  }

  const diff = runGit(projectRoot, [
    'diff', '--no-ext-diff', '--no-textconv', '--name-only', '--relative', baseCommit, '--',
  ]);
  const untracked = runGit(projectRoot, ['ls-files', '--others', '--exclude-standard']);
  const changedFiles = [...new Set([
    ...(diff.status === 0 ? diff.stdout.split('\n') : []),
    ...(untracked.status === 0 ? untracked.stdout.split('\n') : []),
  ].map((entry) => entry.trim()).filter(Boolean))]
    .map((entry) => entry.split(path.sep).join('/'))
    .filter((entry) => !isIgnoredDrift(entry))
    .sort();

  return {
    available: true,
    baseResolvable: true,
    headCommit,
    changedFiles,
    structuralChanges: changedFiles.filter(isStructuralFile),
  };
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveSafeNectarRoot(projectRoot, { create = false } = {}) {
  const resolvedRoot = path.resolve(projectRoot);
  const rootStat = fs.lstatSync(resolvedRoot);
  if (!rootStat.isDirectory()) {
    throw new Error('project root must be a directory');
  }
  const realRoot = fs.realpathSync(resolvedRoot);
  const nectarRoot = path.join(resolvedRoot, '.nectar');

  if (!fs.existsSync(nectarRoot) && create) {
    fs.mkdirSync(nectarRoot);
  }
  if (!fs.existsSync(nectarRoot)) {
    throw new Error('.nectar directory does not exist');
  }

  const nectarStat = fs.lstatSync(nectarRoot);
  if (nectarStat.isSymbolicLink() || !nectarStat.isDirectory()) {
    throw new Error('.nectar must be a non-symlink directory inside the project root');
  }
  const realNectarRoot = fs.realpathSync(nectarRoot);
  if (!isInside(realRoot, realNectarRoot)) {
    throw new Error('.nectar must stay inside the project root');
  }
  return {
    resolvedRoot,
    realRoot,
    nectarRoot,
    realNectarRoot,
  };
}

function containsSymlink(projectRoot, candidate) {
  const relative = path.relative(projectRoot, candidate);
  let current = projectRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink()) return true;
  }
  return false;
}

function validateUntrustedContent(document, label) {
  const secretPatterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\bsk-[A-Za-z0-9_-]{20,}\b/,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?[^\s"']{12,}/i,
  ];
  if (secretPatterns.some((pattern) => pattern.test(document))) {
    throw new Error(`${label} contains a secret-like value`);
  }
  const promptDirectivePatterns = [
    /\bignore (?:all |any )?(?:previous|prior|above) instructions?\b/i,
    /\bdisregard (?:all |any )?(?:previous|prior|above) instructions?\b/i,
    /<(?:system|assistant|developer|tool)(?:\s|>)/i,
    /^\s*(?:system|assistant|developer|tool)\s*:\s+/im,
  ];
  if (promptDirectivePatterns.some((pattern) => pattern.test(document))) {
    throw new Error(`${label} contains an obvious prompt directive`);
  }
}

function validateEvidence(projectRoot, document, label) {
  const evidencePattern = /source:\s+([^:\n]+):(\d+)\b/g;
  for (const match of document.matchAll(evidencePattern)) {
    const relativePath = match[1].trim();
    if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes('..')) {
      throw new Error(`${label} evidence must stay inside the project root: ${relativePath}`);
    }
    const candidate = path.resolve(projectRoot, relativePath);
    if (!isInside(projectRoot, candidate)) {
      throw new Error(`${label} evidence must stay inside the project root: ${relativePath}`);
    }
    if (!fs.existsSync(candidate)) {
      throw new Error(`${label} evidence does not exist: ${relativePath}`);
    }
    if (containsSymlink(projectRoot, candidate)) {
      throw new Error(`${label} evidence must not traverse a symlink: ${relativePath}`);
    }
    const realProjectRoot = fs.realpathSync(projectRoot);
    const realCandidate = fs.realpathSync(candidate);
    if (!isInside(realProjectRoot, realCandidate)) {
      throw new Error(`${label} evidence must stay inside the project root: ${relativePath}`);
    }
    if (!fs.statSync(realCandidate).isFile()) {
      throw new Error(`${label} evidence is not a file: ${relativePath}`);
    }
    const line = Number(match[2]);
    const lineCount = fs.readFileSync(realCandidate, 'utf8').split('\n').length;
    if (line < 1 || line > lineCount) {
      throw new Error(`${label} evidence line is outside the file: ${relativePath}:${line}`);
    }
  }
}

export function validateContextDocuments(projectRoot, { context, conventions }) {
  const resolvedRoot = path.resolve(projectRoot);
  for (const [label, document] of Object.entries({ context, conventions })) {
    if (typeof document !== 'string' || !document.trim()) {
      throw new Error(`${label} document must be non-empty`);
    }
    if (Buffer.byteLength(document, 'utf8') > DOCUMENT_LIMIT_BYTES) {
      throw new Error(`${label} document exceeds the 6 KiB UTF-8 limit`);
    }
    validateUntrustedContent(document, label);
    validateEvidence(resolvedRoot, document, label);
  }
}

export function createContextStaging(projectRoot) {
  const { nectarRoot } = resolveSafeNectarRoot(projectRoot, { create: true });
  return fs.mkdtempSync(path.join(nectarRoot, '.context-stage-'));
}

function currentHead(projectRoot) {
  const git = inspectGit(projectRoot, null);
  return git.available ? git.headCommit : null;
}

export function promoteContextSnapshot(projectRoot, stagingDirectory, {
  now = new Date(),
  thresholds: thresholdOverrides,
  simulateFailureAfter = null,
} = {}) {
  const {
    resolvedRoot,
    realRoot,
    nectarRoot,
    realNectarRoot,
  } = resolveSafeNectarRoot(projectRoot);
  const resolvedStaging = path.resolve(stagingDirectory);
  if (
    !isInside(nectarRoot, resolvedStaging)
    || path.dirname(resolvedStaging) !== nectarRoot
    || !path.basename(resolvedStaging).startsWith('.context-stage-')
  ) {
    throw new Error('staging directory must be created inside .nectar');
  }
  const stagingStat = fs.lstatSync(resolvedStaging);
  if (stagingStat.isSymbolicLink() || !stagingStat.isDirectory()) {
    throw new Error('staging directory must be a non-symlink directory');
  }
  const realStaging = fs.realpathSync(resolvedStaging);
  if (
    !isInside(realRoot, realStaging)
    || path.dirname(realStaging) !== realNectarRoot
  ) {
    throw new Error('staging directory must stay inside .nectar');
  }

  for (const file of ['CONTEXT.md', 'CONVENTIONS.md']) {
    const stagedFile = path.join(resolvedStaging, file);
    const stagedStat = fs.lstatSync(stagedFile);
    if (stagedStat.isSymbolicLink() || !stagedStat.isFile()) {
      throw new Error(`${file} must be a regular non-symlink staging file`);
    }
    const realStagedFile = fs.realpathSync(stagedFile);
    if (path.dirname(realStagedFile) !== realStaging) {
      throw new Error(`${file} must stay inside the staging directory`);
    }
  }

  const context = fs.readFileSync(path.join(resolvedStaging, 'CONTEXT.md'), 'utf8');
  const conventions = fs.readFileSync(path.join(resolvedStaging, 'CONVENTIONS.md'), 'utf8');
  validateContextDocuments(resolvedRoot, { context, conventions });
  const existingMetadata = readMetadata(existingContextSource(resolvedRoot));
  const thresholds = normalizeThresholds(thresholdOverrides ?? existingMetadata?.thresholds);
  const metadata = {
    schema: 1,
    source: 'nectar',
    generatedAt: now.toISOString(),
    baseCommit: currentHead(resolvedRoot),
    fingerprint: fingerprintDocuments(context, conventions),
    thresholds,
  };
  const stagedMetadata = path.join(resolvedStaging, 'context.json');
  fs.writeFileSync(stagedMetadata, `${JSON.stringify(metadata, null, 2)}\n`, {
    flag: 'wx',
  });
  const stagedMetadataStat = fs.lstatSync(stagedMetadata);
  if (
    stagedMetadataStat.isSymbolicLink()
    || !stagedMetadataStat.isFile()
    || path.dirname(fs.realpathSync(stagedMetadata)) !== realStaging
  ) {
    throw new Error('context.json must be a regular non-symlink staging file');
  }

  const backup = fs.mkdtempSync(path.join(nectarRoot, '.context-backup-'));
  const promoted = [];
  try {
    for (const file of MANAGED_FILES) {
      const active = path.join(nectarRoot, file);
      if (fs.existsSync(active)) fs.renameSync(active, path.join(backup, file));
    }
    for (const file of MANAGED_FILES) {
      fs.renameSync(path.join(resolvedStaging, file), path.join(nectarRoot, file));
      promoted.push(file);
      if (simulateFailureAfter === promoted.length) {
        throw new Error('simulated context promotion failure');
      }
    }
    fs.rmSync(backup, { recursive: true, force: true });
    fs.rmSync(resolvedStaging, { recursive: true, force: true });
    return metadata;
  } catch (error) {
    for (const file of promoted) {
      fs.rmSync(path.join(nectarRoot, file), { force: true });
    }
    for (const file of MANAGED_FILES) {
      const saved = path.join(backup, file);
      if (fs.existsSync(saved)) fs.renameSync(saved, path.join(nectarRoot, file));
    }
    fs.rmSync(backup, { recursive: true, force: true });
    throw error;
  }
}

export function inspectContext(projectRoot, { now = new Date() } = {}) {
  const resolvedRoot = path.resolve(projectRoot);
  const active = existingContextSource(resolvedRoot);
  if (!active) {
    return {
      source: null,
      state: 'missing',
      ageDays: null,
      baseCommit: null,
      changedFiles: [],
      fingerprint: null,
      structuralChanges: [],
      thresholds: DEFAULT_THRESHOLDS,
      git: inspectGit(resolvedRoot, null),
    };
  }

  const metadata = readMetadata(active);
  const fingerprintActual = fingerprintDocuments(
    fs.readFileSync(path.join(active.root, 'CONTEXT.md'), 'utf8'),
    fs.readFileSync(path.join(active.root, 'CONVENTIONS.md'), 'utf8'),
  );
  const fingerprintExpected = typeof metadata?.fingerprint === 'string'
    ? metadata.fingerprint
    : null;
  const fingerprintValid = /^[a-f0-9]{64}$/.test(fingerprintExpected || '');
  const fingerprint = {
    actual: fingerprintActual,
    expected: fingerprintExpected,
    matches: fingerprintValid && fingerprintExpected === fingerprintActual,
    valid: fingerprintValid,
  };
  const thresholds = normalizeThresholds(metadata?.thresholds);
  const generatedAt = metadata?.generatedAt
    ? new Date(metadata.generatedAt)
    : new Date(Math.max(
      fs.statSync(path.join(active.root, 'CONTEXT.md')).mtimeMs,
      fs.statSync(path.join(active.root, 'CONVENTIONS.md')).mtimeMs,
    ));
  const ageDays = Math.max(0, (now.getTime() - generatedAt.getTime()) / 86_400_000);
  const git = inspectGit(resolvedRoot, metadata?.baseCommit ?? null);
  const state = ageDays >= thresholds.expiredDays
    || (git.available && !git.baseResolvable)
    || git.changedFiles.length >= thresholds.expiredFiles
    ? 'expired'
    : ageDays >= thresholds.staleDays
      || git.changedFiles.length >= thresholds.staleFiles
      || git.structuralChanges.length > 0
      || !fingerprint.matches
      || !metadata
      ? 'stale'
      : 'fresh';

  return {
    source: active.source,
    state,
    ageDays,
    generatedAt: generatedAt.toISOString(),
    baseCommit: metadata?.baseCommit ?? null,
    changedFiles: git.changedFiles,
    fingerprint,
    structuralChanges: git.structuralChanges,
    thresholds,
    git,
  };
}

export function fingerprintDocuments(context, conventions) {
  return crypto.createHash('sha256')
    .update(context)
    .update('\0')
    .update(conventions)
    .digest('hex');
}

export {
  DOCUMENT_LIMIT_BYTES,
  MANAGED_FILES,
};
