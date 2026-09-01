#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const fatalUtf8 = new TextDecoder('utf-8', { fatal: true });
const noFollow = fs.constants.O_NOFOLLOW ?? 0;
const TOKEN_DOMAIN = Buffer.from('NECTAR_DEBUG_PROMOTION_TOKEN_V1\0', 'utf8');
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_TOKEN_LENGTH = 16_384;
const SOURCE_PATTERN = /^docs\/work\/debug\/[a-z0-9][a-z0-9-]*\.md$/;
const DESTINATION_PATTERN = /^docs\/work\/\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$/;
const DESIGN_STAGE_PREFIX = 'nectar-debug-design-stage-';
const DESIGN_STAGE_MARKER = '.nectar-debug-design-stage.json';
const DESIGN_FILENAME = 'design.md';
const SECRET_LIKE_PATTERNS = Object.freeze([
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?[^\s"']{12,}/i,
]);

function identity(stat) {
  return { dev: String(stat.dev), ino: String(stat.ino), mode: String(stat.mode) };
}

function sameIdentity(left, right) {
  return Boolean(left && right)
    && left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode;
}

function validIdentity(value) {
  return Boolean(value)
    && /^\d+$/.test(value.dev || '')
    && /^\d+$/.test(value.ino || '')
    && /^\d+$/.test(value.mode || '');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function encodeOpaqueToken(kind, payload) {
  const body = stableJson({ kind, payload, version: 1 });
  const checksum = crypto.createHash('sha256').update(TOKEN_DOMAIN).update(body).digest('hex');
  return Buffer.from(stableJson({ body, checksum }), 'utf8').toString('base64url');
}

function decodeOpaqueToken(token, expectedKind) {
  if (typeof token !== 'string'
    || token.length < 8
    || token.length > MAX_TOKEN_LENGTH
    || !TOKEN_PATTERN.test(token)) {
    throw new Error('token must be bounded canonical base64url');
  }
  const decoded = Buffer.from(token, 'base64url');
  if (decoded.toString('base64url') !== token) throw new Error('token is not canonical base64url');
  const wrapperText = decodeUtf8(decoded, 'token');
  let wrapper;
  try {
    wrapper = JSON.parse(wrapperText);
  } catch {
    throw new Error('token JSON is invalid');
  }
  if (stableJson(wrapper) !== wrapperText
    || typeof wrapper?.body !== 'string'
    || !/^[a-f0-9]{64}$/.test(wrapper?.checksum || '')) {
    throw new Error('token wrapper is not canonical');
  }
  const checksum = crypto.createHash('sha256').update(TOKEN_DOMAIN).update(wrapper.body).digest('hex');
  if (checksum !== wrapper.checksum) throw new Error('token checksum mismatch');
  let body;
  try {
    body = JSON.parse(wrapper.body);
  } catch {
    throw new Error('token body is invalid');
  }
  if (stableJson(body) !== wrapper.body || body.version !== 1 || body.kind !== expectedKind) {
    throw new Error(`token kind/version mismatch: expected ${expectedKind}`);
  }
  return body.payload;
}

function statIdentity(target, { file = false, directory = false } = {}) {
  const stat = fs.lstatSync(target, { bigint: true });
  if (stat.isSymbolicLink()) throw new Error(`symbolic link is not allowed: ${target}`);
  if (file && !stat.isFile()) throw new Error(`normal file required: ${target}`);
  if (directory && !stat.isDirectory()) throw new Error(`normal directory required: ${target}`);
  return identity(stat);
}

function identityAt(target, expected = {}) {
  try {
    return statIdentity(target, expected);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function identityMatchesAt(target, expectedIdentity, expected = {}) {
  try {
    return sameIdentity(statIdentity(target, expected), expectedIdentity);
  } catch {
    return false;
  }
}

function captureNormalChain(root, relative, { leaf = 'directory' } = {}) {
  const records = [{
    path: root,
    identity: statIdentity(root, { directory: true }),
    directory: true,
    file: false,
  }];
  const parts = relative.split('/');
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const isLeaf = index === parts.length - 1;
    const record = {
      path: current,
      directory: !isLeaf || leaf === 'directory',
      file: isLeaf && leaf === 'file',
    };
    record.identity = statIdentity(current, record);
    records.push(record);
  }
  return records;
}

function assertChain(records, label) {
  for (const record of records) {
    const current = statIdentity(record.path, record);
    if (!sameIdentity(current, record.identity)) {
      throw new Error(`${label} ancestor identity changed: ${record.path}`);
    }
  }
}

function validateRelative(relative, pattern, label) {
  if (typeof relative !== 'string' || !pattern.test(relative) || path.isAbsolute(relative)) {
    throw new Error(`invalid ${label}: ${relative}`);
  }
  return relative;
}

function decodeUtf8(bytes, label) {
  try {
    return fatalUtf8.decode(bytes);
  } catch {
    throw new Error(`${label} must contain valid UTF-8`);
  }
}

function encodeUtf8(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be UTF-8 text`);
  const bytes = Buffer.from(value, 'utf8');
  if (decodeUtf8(bytes, label) !== value) throw new Error(`${label} must contain valid UTF-8`);
  return bytes;
}

function assertNoSecretLike(value, label) {
  if (SECRET_LIKE_PATTERNS.some((pattern) => pattern.test(value))) {
    throw new Error(`${label} contains a secret-like value; redact it before Debug promotion`);
  }
}

function openNormalFile(target, label) {
  const descriptor = fs.openSync(target, fs.constants.O_RDONLY | noFollow);
  try {
    const descriptorStat = fs.fstatSync(descriptor, { bigint: true });
    if (!descriptorStat.isFile()) throw new Error(`${label} must be a normal file`);
    const descriptorIdentity = identity(descriptorStat);
    const pathIdentity = statIdentity(target, { file: true });
    if (!sameIdentity(descriptorIdentity, pathIdentity)) {
      throw new Error(`${label} identity changed while opening`);
    }
    return { descriptor, identity: descriptorIdentity };
  } catch (error) {
    fs.closeSync(descriptor);
    throw error;
  }
}

function readStrictFile(target, label) {
  const opened = openNormalFile(target, label);
  try {
    const bytes = fs.readFileSync(opened.descriptor);
    return { bytes, text: decodeUtf8(bytes, label), identity: opened.identity };
  } finally {
    fs.closeSync(opened.descriptor);
  }
}

function normalProjectRoot(root) {
  const requested = path.resolve(root);
  const requestedIdentity = statIdentity(requested, { directory: true });
  const resolved = fs.realpathSync(requested);
  if (!sameIdentity(requestedIdentity, statIdentity(resolved, { directory: true }))) {
    throw new Error('project root must be a normal directory without identity drift');
  }
  return resolved;
}

function rootBinding(root) {
  const resolved = normalProjectRoot(root);
  return { identity: statIdentity(resolved, { directory: true }), path: resolved };
}

function assertRootBinding(projectRoot, binding) {
  const current = rootBinding(projectRoot);
  if (binding?.path !== current.path || !sameIdentity(binding?.identity, current.identity)) {
    throw new Error('token root replay or identity mismatch');
  }
  return current.path;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function normalDirectoryEntries(target) {
  return fs.readdirSync(target, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function sourceRelativePath(relative) {
  const safe = validateRelative(relative, SOURCE_PATTERN, 'topicless debug source');
  if (path.posix.basename(safe).startsWith('recovery-')) {
    throw new Error('debug recovery claims are not promotable sources');
  }
  return safe;
}

function sourceSnapshot(projectRoot, sourceRelative) {
  const relative = sourceRelativePath(sourceRelative);
  const chain = captureNormalChain(projectRoot, relative, { leaf: 'file' });
  const opened = readStrictFile(path.join(projectRoot, relative), 'source evidence');
  assertNoSecretLike(opened.text, 'source evidence');
  assertChain(chain, 'source');
  return {
    bytes: opened.bytes,
    identity: opened.identity,
    relative,
    sha256: sha256(opened.bytes),
    size: String(opened.bytes.length),
    text: opened.text,
  };
}

function sourceSelectionToken(projectRoot, source) {
  return encodeOpaqueToken('debug-source', {
    root: rootBinding(projectRoot),
    source: {
      identity: source.identity,
      relative: source.relative,
      sha256: source.sha256,
      size: source.size,
    },
  });
}

export function discoverDebugInvestigations({ projectRoot = process.cwd() } = {}) {
  const root = normalProjectRoot(projectRoot);
  const debugRelative = 'docs/work/debug';
  const debugPath = path.join(root, debugRelative);
  const entries = [];
  const discrepancies = [];

  try {
    captureNormalChain(root, debugRelative);
  } catch (error) {
    if (error.code === 'ENOENT') return { entries, discrepancies };
    return {
      entries,
      discrepancies: [{ displayPath: debugRelative, error: error.message }],
    };
  }

  for (const entry of normalDirectoryEntries(debugPath)) {
    const relative = `${debugRelative}/${entry.name}`;
    if (/^recovery-[a-z0-9-]+\.md$/.test(entry.name)) continue;
    if (!SOURCE_PATTERN.test(relative)) {
      if (entry.name.endsWith('.md')) {
        discrepancies.push({ displayPath: relative, error: 'invalid topicless debug source name' });
      }
      continue;
    }
    if (entry.isSymbolicLink() || !entry.isFile()) {
      discrepancies.push({ displayPath: relative, error: 'debug source must be a normal file' });
      continue;
    }
    try {
      const source = sourceSnapshot(root, relative);
      entries.push({ displayPath: relative, token: sourceSelectionToken(root, source) });
    } catch (error) {
      discrepancies.push({ displayPath: relative, error: error.message });
    }
  }

  entries.sort((left, right) => left.displayPath.localeCompare(right.displayPath));
  discrepancies.sort((left, right) => left.displayPath.localeCompare(right.displayPath));
  return { entries, discrepancies };
}

function sourceFromSelectionToken(projectRoot, token) {
  const payload = decodeOpaqueToken(token, 'debug-source');
  const root = assertRootBinding(projectRoot, payload?.root);
  const relative = sourceRelativePath(payload?.source?.relative);
  const discovered = discoverDebugInvestigations({ projectRoot: root });
  const current = discovered.entries.find((entry) => entry.token === token);
  if (!current || current.displayPath !== relative) {
    throw new Error('source selection token is not a current discovery membership');
  }
  return { root, source: sourceSnapshot(root, relative) };
}

function localDate(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('stage date must be valid');
  return [
    String(now.getFullYear()).padStart(4, '0'),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

function destinationForSource(sourceRelative, now) {
  const slug = path.posix.basename(sourceRelative, '.md');
  return `docs/work/${localDate(now)}-${slug}`;
}

function retainedObjectError(error, visiblePath) {
  const wrapped = new Error(
    `${error.message} Owned object retained at ${visiblePath}.`,
    { cause: error },
  );
  wrapped.retainedPath = visiblePath;
  return wrapped;
}

function cleanupCreatedFile(target, createdIdentity, visiblePath, originalError) {
  if (!identityMatchesAt(target, createdIdentity, { file: true })) {
    try {
      if (identityAt(target) === null) return;
    } catch {}
    throw retainedObjectError(originalError, visiblePath);
  }
  try {
    fs.unlinkSync(target);
  } catch (cleanupError) {
    throw retainedObjectError(cleanupError, visiblePath);
  }
  try {
    fsyncDirectory(path.dirname(target));
  } catch (cleanupError) {
    throw new Error(
      `${originalError.message} Cleanup directory sync failed for ${visiblePath}: ${cleanupError.message}`,
      { cause: originalError },
    );
  }
}

function writeExclusive(target, bytes, mode, label, visiblePath = target) {
  let descriptor;
  let createdIdentity = null;
  try {
    descriptor = fs.openSync(
      target,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
      mode,
    );
    createdIdentity = identity(fs.fstatSync(descriptor, { bigint: true }));
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    if (!identityMatchesAt(target, createdIdentity, { file: true })) {
      throw new Error(`${label} identity changed after exclusive creation`);
    }
    if (!fs.readFileSync(target).equals(bytes)) throw new Error(`${label} byte verification failed`);
    return createdIdentity;
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
    }
    if (createdIdentity !== null) {
      cleanupCreatedFile(target, createdIdentity, visiblePath, error);
    }
    throw error;
  }
}

function ownedFileMatches(target, ownedIdentity, expectedBytes = null) {
  try {
    if (!identityMatchesAt(target, ownedIdentity, { file: true })) return false;
    return expectedBytes === null || fs.readFileSync(target).equals(expectedBytes);
  } catch {
    return false;
  }
}

function unlinkOwned(target, ownedIdentity, expectedBytes = null) {
  if (!ownedFileMatches(target, ownedIdentity, expectedBytes)) return false;
  fs.unlinkSync(target);
  return true;
}

function fsyncDirectory(target) {
  const descriptor = fs.openSync(target, fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function injectFailure(actual, expected) {
  if (actual === expected) throw new Error(`injected failure: ${expected}`);
}

function runHook(hooks, name, payload) {
  const hook = hooks?.[name];
  if (hook !== undefined) {
    if (typeof hook !== 'function') throw new Error(`invalid ${name} hook`);
    hook(payload);
  }
}

function recoveryName(sourceRelative) {
  const slug = path.posix.basename(sourceRelative, '.md');
  return `docs/work/debug/recovery-${slug}-${crypto.randomBytes(12).toString('hex')}.md`;
}

function claimRecovery(
  projectRoot,
  debugChain,
  sourceRelative,
  sourcePath,
  sourceIdentity,
  evidenceBytes,
) {
  assertChain(debugChain, 'debug');
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const relative = recoveryName(sourceRelative);
    const absolute = path.join(projectRoot, relative);
    let created = false;
    let recoveryIdentity = null;
    try {
      fs.linkSync(sourcePath, absolute);
      created = true;
      recoveryIdentity = statIdentity(absolute, { file: true });
      if (!sameIdentity(recoveryIdentity, sourceIdentity)
        || !fs.readFileSync(absolute).equals(evidenceBytes)) {
        throw new Error('source identity or bytes changed during recovery claim');
      }
      fsyncDirectory(path.dirname(absolute));
      return { relative, absolute, identity: recoveryIdentity };
    } catch (error) {
      if (!created && error.code === 'EEXIST') continue;
      if (created && recoveryIdentity !== null) {
        cleanupCreatedFile(absolute, recoveryIdentity, relative, error);
        throw error;
      }
      if (created) throw retainedObjectError(error, relative);
      throw error;
    }
  }
  throw new Error('could not atomically claim an exclusive debug recovery path');
}

function createRecoveryCopy(projectRoot, debugChain, sourceRelative, evidenceBytes) {
  assertChain(debugChain, 'debug');
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const relative = recoveryName(sourceRelative);
    const absolute = path.join(projectRoot, relative);
    try {
      const recoveryIdentity = writeExclusive(
        absolute,
        evidenceBytes,
        0o600,
        'recovery claim',
        relative,
      );
      fsyncDirectory(path.dirname(absolute));
      return { relative, absolute, identity: recoveryIdentity };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('could not create an exclusive debug recovery claim');
}

function inspectSource(sourcePath, sourceIdentity, evidenceBytes) {
  try {
    const opened = openNormalFile(sourcePath, 'source evidence');
    try {
      const bytes = fs.readFileSync(opened.descriptor);
      return {
        exists: true,
        exact: sameIdentity(opened.identity, sourceIdentity) && bytes.equals(evidenceBytes),
      };
    } finally {
      fs.closeSync(opened.descriptor);
    }
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, exact: false };
    return { exists: true, exact: false };
  }
}

function appendRecovery(error, recoveryRelative) {
  const wrapped = new Error(
    `${error.message} Original evidence preserved at ${recoveryRelative}.`,
    { cause: error },
  );
  wrapped.recoveryPath = recoveryRelative;
  return wrapped;
}

function assertDesignContent(designContent, evidence, evidenceBytes) {
  assertNoSecretLike(evidence, 'source evidence');
  assertNoSecretLike(designContent, 'design content');
  const evidenceDigest = sha256(evidenceBytes);
  if (!designContent.includes(evidence)
    || !designContent.includes(`Investigation evidence SHA-256: ${evidenceDigest}`)) {
    throw new Error('design must embed the complete debug evidence and its raw SHA-256');
  }
  for (const required of [
    '## Investigation and fit',
    '**Investigation scope:**',
    '**Confirmed current behavior:**',
    '**Selected candidate:**',
    '**Evidence:**',
    '**Solution fit:** FIT',
    '**Remaining uncertainty:**',
  ]) {
    if (!designContent.includes(required)) throw new Error(`design is missing ${required}`);
  }
  return evidenceDigest;
}

function stageMarkerState(root) {
  const markerPath = path.join(root, DESIGN_STAGE_MARKER);
  const opened = readStrictFile(markerPath, 'design stage marker');
  const markerText = opened.text;
  let marker;
  try {
    marker = JSON.parse(markerText);
  } catch {
    throw new Error('design stage marker JSON is invalid');
  }
  const sourceTokenValid = typeof marker?.sourceToken === 'string'
    && marker.sourceToken.length >= 8
    && marker.sourceToken.length <= MAX_TOKEN_LENGTH
    && TOKEN_PATTERN.test(marker.sourceToken);
  const designValid = marker?.design === null || (
    marker?.design
    && typeof marker.design === 'object'
    && validIdentity(marker.design.identity)
    && /^[a-f0-9]{64}$/.test(marker.design.sha256 || '')
    && /^\d+$/.test(marker.design.size || '')
  );
  if (stableJson(marker) !== markerText
    || marker?.version !== 1
    || typeof marker?.nonce !== 'string'
    || !/^[a-f0-9]{48}$/.test(marker.nonce)
    || typeof marker?.sealed !== 'boolean'
    || !sourceTokenValid
    || !/^[a-f0-9]{64}$/.test(marker?.sourceTokenHash || '')
    || !DESTINATION_PATTERN.test(marker?.destinationRelative || '')
    || typeof marker?.projectRoot?.path !== 'string'
    || !validIdentity(marker?.projectRoot?.identity)
    || !designValid
    || (marker.sealed && marker.design === null)
    || (!marker.sealed && marker.design !== null)) {
    throw new Error('design stage marker is not canonical');
  }
  return {
    marker,
    markerHash: sha256(opened.bytes),
    markerIdentity: opened.identity,
    markerPath,
  };
}

function writeExclusiveStageMarker(root, marker) {
  const target = path.join(root, DESIGN_STAGE_MARKER);
  const bytes = Buffer.from(stableJson(marker), 'utf8');
  return writeExclusive(target, bytes, 0o600, 'design stage marker');
}

function writeStageMarkerAtomic(root, previous, marker) {
  const target = path.join(root, DESIGN_STAGE_MARKER);
  const temporary = path.join(
    root,
    `.${DESIGN_STAGE_MARKER}.${process.pid}-${crypto.randomBytes(8).toString('hex')}`,
  );
  const bytes = Buffer.from(stableJson(marker), 'utf8');
  let temporaryIdentity = null;
  try {
    temporaryIdentity = writeExclusive(temporary, bytes, 0o600, 'sealed design stage marker');
    if (!identityMatchesAt(target, previous.markerIdentity, { file: true })) {
      throw new Error('design stage marker identity changed before sealing');
    }
    fs.renameSync(temporary, target);
    temporaryIdentity = null;
    fsyncDirectory(root);
  } catch (error) {
    if (temporaryIdentity !== null) {
      try { unlinkOwned(temporary, temporaryIdentity, bytes); } catch {}
    }
    throw error;
  }
}

function stageTokenFor(root) {
  const state = stageMarkerState(root);
  return encodeOpaqueToken('debug-design-stage', {
    markerHash: state.markerHash,
    markerIdentity: state.markerIdentity,
    nonce: state.marker.nonce,
    root: rootBinding(root),
    sealed: state.marker.sealed,
  });
}

function designStageRecord(root) {
  const entries = normalDirectoryEntries(root);
  const expected = [DESIGN_STAGE_MARKER, DESIGN_FILENAME].sort((left, right) => left.localeCompare(right));
  const actual = entries.map((entry) => entry.name).sort((left, right) => left.localeCompare(right));
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw new Error(`design stage must contain exactly marker and ${DESIGN_FILENAME}`);
  }
  const designPath = path.join(root, DESIGN_FILENAME);
  const design = readStrictFile(designPath, 'design file');
  return {
    bytes: design.bytes,
    path: designPath,
    record: {
      identity: design.identity,
      sha256: sha256(design.bytes),
      size: String(design.bytes.length),
    },
    text: design.text,
  };
}

function assertSealedStageDesign(root, expected) {
  const current = designStageRecord(root);
  if (stableJson(current.record) !== stableJson(expected)) {
    throw new Error(`design stage manifest changed; retained design stage path: ${root}`);
  }
  return current;
}

function validateDesignStageToken(token, { sealed = null, manifest = false } = {}) {
  const payload = decodeOpaqueToken(token, 'debug-design-stage');
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const root = assertRootBinding(payload?.root?.path, payload?.root);
  const relative = path.relative(temporaryRoot, root);
  if (!relative
    || relative.startsWith('..')
    || path.isAbsolute(relative)
    || relative.includes(path.sep)
    || !path.basename(root).startsWith(DESIGN_STAGE_PREFIX)) {
    throw new Error('design stage root is outside the helper-owned temporary namespace');
  }
  const state = stageMarkerState(root);
  if (!sameIdentity(payload?.markerIdentity, state.markerIdentity)
    || payload?.markerHash !== state.markerHash
    || payload?.nonce !== state.marker.nonce
    || payload?.sealed !== state.marker.sealed) {
    throw new Error('design stage token marker identity or content mismatch');
  }
  if (sealed !== null && state.marker.sealed !== sealed) {
    throw new Error(sealed ? 'design stage must be sealed' : 'design stage is already sealed');
  }
  const design = manifest ? assertSealedStageDesign(root, state.marker.design) : null;
  return { design, root, state };
}

export function createDebugDesignStage({
  projectRoot = process.cwd(),
  sourceToken,
  now = new Date(),
} = {}) {
  const { root, source } = sourceFromSelectionToken(projectRoot, sourceToken);
  const destinationRelative = destinationForSource(source.relative, now);
  const destinationPath = path.join(root, destinationRelative);
  if (identityAt(destinationPath) !== null) {
    throw new Error(`destination already exists: ${destinationRelative}`);
  }

  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const stageRoot = fs.mkdtempSync(path.join(temporaryRoot, DESIGN_STAGE_PREFIX));
  fs.chmodSync(stageRoot, 0o700);
  try {
    writeExclusiveStageMarker(stageRoot, {
      design: null,
      destinationRelative,
      nonce: crypto.randomBytes(24).toString('hex'),
      projectRoot: rootBinding(root),
      sealed: false,
      sourceToken,
      sourceTokenHash: sha256(Buffer.from(sourceToken, 'utf8')),
      version: 1,
    });
    fsyncDirectory(stageRoot);
  } catch (error) {
    try { fs.unlinkSync(path.join(stageRoot, DESIGN_STAGE_MARKER)); } catch {}
    try { fs.rmdirSync(stageRoot); } catch {}
    throw error;
  }

  return {
    designDisplayPath: path.join(stageRoot, DESIGN_FILENAME),
    destinationDisplayPath: destinationRelative,
    stageDisplayPath: stageRoot,
    stageToken: stageTokenFor(stageRoot),
  };
}

export function sealDebugDesignStage({ stageToken } = {}) {
  const { root, state } = validateDesignStageToken(stageToken, { sealed: false });
  const projectRoot = assertRootBinding(state.marker.projectRoot.path, state.marker.projectRoot);
  if (sha256(Buffer.from(state.marker.sourceToken, 'utf8')) !== state.marker.sourceTokenHash) {
    throw new Error('design stage source token hash mismatch');
  }
  const selected = sourceFromSelectionToken(projectRoot, state.marker.sourceToken);
  const design = designStageRecord(root);
  assertDesignContent(design.text, selected.source.text, selected.source.bytes);
  if (identityAt(path.join(projectRoot, state.marker.destinationRelative)) !== null) {
    throw new Error(`destination already exists: ${state.marker.destinationRelative}`);
  }
  writeStageMarkerAtomic(root, state, {
    ...state.marker,
    design: design.record,
    sealed: true,
  });
  return {
    designSha256: design.record.sha256,
    destinationDisplayPath: state.marker.destinationRelative,
    stageDisplayPath: root,
    stageToken: stageTokenFor(root),
  };
}

function retainedDesignStageError(error, root) {
  const wrapped = new Error(`${error.message} Design stage retained at ${root}.`, { cause: error });
  wrapped.stagePath = root;
  if (error.recoveryPath) wrapped.recoveryPath = error.recoveryPath;
  return wrapped;
}

export function disposeDebugDesignStage({ stageToken } = {}) {
  let validated;
  try {
    validated = validateDesignStageToken(stageToken, { sealed: true, manifest: true });
  } catch (error) {
    let root = null;
    try {
      const payload = decodeOpaqueToken(stageToken, 'debug-design-stage');
      root = payload?.root?.path || null;
    } catch {}
    if (root) throw retainedDesignStageError(error, root);
    throw error;
  }
  const { design, root, state } = validated;
  try {
    const currentDesign = assertSealedStageDesign(root, state.marker.design);
    fs.unlinkSync(currentDesign.path);
    const marker = stageMarkerState(root);
    if (!sameIdentity(marker.markerIdentity, state.markerIdentity)
      || marker.markerHash !== state.markerHash) {
      throw new Error('design stage marker changed during disposal');
    }
    fs.unlinkSync(marker.markerPath);
    fs.rmdirSync(root);
    return { disposed: true };
  } catch (error) {
    throw retainedDesignStageError(error, root);
  }
}

export function promoteDebugInvestigationFromTokens({
  projectRoot = process.cwd(),
  sourceToken,
  stageToken,
} = {}) {
  const selected = sourceFromSelectionToken(projectRoot, sourceToken);
  const stage = validateDesignStageToken(stageToken, { sealed: true, manifest: true });
  const stageProjectRoot = assertRootBinding(
    stage.state.marker.projectRoot.path,
    stage.state.marker.projectRoot,
  );
  if (stageProjectRoot !== selected.root
    || stage.state.marker.sourceToken !== sourceToken
    || stage.state.marker.sourceTokenHash !== sha256(Buffer.from(sourceToken, 'utf8'))) {
    throw new Error('design stage source pairing mismatch');
  }

  let promoted;
  try {
    promoted = promoteDebugInvestigation({
      root: selected.root,
      sourceRelative: selected.source.relative,
      destinationRelative: stage.state.marker.destinationRelative,
      designContent: stage.design.text,
    });
  } catch (error) {
    throw retainedDesignStageError(error, stage.root);
  }

  let stageCleanup;
  try {
    stageCleanup = disposeDebugDesignStage({ stageToken });
  } catch (error) {
    stageCleanup = {
      disposed: false,
      retainedPath: stage.root,
      warning: error.cause?.message || error.message,
    };
  }
  return {
    ...promoted,
    committed: true,
    destinationRelative: stage.state.marker.destinationRelative,
    stageCleanup,
  };
}

export function promoteDebugInvestigation({
  root,
  sourceRelative,
  destinationRelative,
  designContent,
  failAt = null,
  hooks = null,
}) {
  const projectRoot = normalProjectRoot(root);

  const sourcePathRelative = validateRelative(
    sourceRelative,
    /^docs\/work\/debug\/[a-z0-9][a-z0-9-]*\.md$/,
    'topicless debug source',
  );
  const destinationPathRelative = validateRelative(
    destinationRelative,
    /^docs\/work\/\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$/,
    'dated topic destination',
  );
  const sourcePath = path.join(projectRoot, sourcePathRelative);
  const destinationPath = path.join(projectRoot, destinationPathRelative);
  const sourceChain = captureNormalChain(projectRoot, sourcePathRelative, { leaf: 'file' });
  const debugChain = sourceChain.slice(0, -1);
  const destinationParentChain = captureNormalChain(
    projectRoot,
    path.posix.dirname(destinationPathRelative),
  );
  if (identityAt(destinationPath) !== null) {
    throw new Error(`destination already exists: ${destinationPathRelative}`);
  }

  const source = readStrictFile(sourcePath, 'source evidence');
  const sourceIdentity = source.identity;
  const evidenceBytes = source.bytes;
  const evidence = source.text;
  const designBytes = encodeUtf8(designContent, 'design content');
  const evidenceDigest = assertDesignContent(designContent, evidence, evidenceBytes);

  const payload = { sourcePath, destinationPath, sourceRelative: sourcePathRelative };
  let recovery = null;
  let sourceWasClaimed = false;
  let destinationIdentity = null;
  const ownedFiles = [];

  try {
    runHook(hooks, 'afterSourceRead', payload);
    assertChain(sourceChain, 'source');
    recovery = claimRecovery(
      projectRoot,
      debugChain,
      sourcePathRelative,
      sourcePath,
      sourceIdentity,
      evidenceBytes,
    );
    runHook(hooks, 'afterRecoveryClaim', { ...payload, recoveryPath: recovery.absolute });

    assertChain(debugChain, 'debug');
    const beforeClaim = inspectSource(sourcePath, sourceIdentity, evidenceBytes);
    if (!beforeClaim.exact) throw new Error('source evidence identity or bytes changed before claim');
    if (!ownedFileMatches(recovery.absolute, recovery.identity, evidenceBytes)) {
      throw new Error('recovery claim identity or bytes changed');
    }
    injectFailure(failAt, 'before-source-remove');

    fs.unlinkSync(sourcePath);
    sourceWasClaimed = true;
    fsyncDirectory(path.dirname(sourcePath));
    runHook(hooks, 'afterSourceClaim', { ...payload, recoveryPath: recovery.absolute });

    if (identityAt(sourcePath) !== null) throw new Error('source path reappeared after claim');
    if (!ownedFileMatches(recovery.absolute, recovery.identity, evidenceBytes)) {
      throw new Error('claimed recovery identity or bytes changed');
    }

    assertChain(destinationParentChain, 'destination');
    runHook(hooks, 'beforeDestinationCreate', payload);
    assertChain(destinationParentChain, 'destination');
    fs.mkdirSync(destinationPath, { mode: 0o700 });
    destinationIdentity = statIdentity(destinationPath, { directory: true });
    runHook(hooks, 'afterDestinationCreate', payload);
    if (!identityMatchesAt(destinationPath, destinationIdentity, { directory: true })) {
      throw new Error('destination identity changed after exclusive creation');
    }
    assertChain(destinationParentChain, 'destination');
    injectFailure(failAt, 'after-directory');

    const evidencePath = path.join(destinationPath, 'investigation-evidence.md');
    const evidenceIdentity = writeExclusive(
      evidencePath,
      evidenceBytes,
      0o600,
      'investigation evidence',
      `${destinationPathRelative}/investigation-evidence.md`,
    );
    ownedFiles.push({ path: evidencePath, identity: evidenceIdentity, bytes: evidenceBytes });
    const designPath = path.join(destinationPath, 'design.md');
    const designIdentity = writeExclusive(
      designPath,
      designBytes,
      0o600,
      'dated design',
      `${destinationPathRelative}/design.md`,
    );
    ownedFiles.push({ path: designPath, identity: designIdentity, bytes: designBytes });
    injectFailure(failAt, 'after-write');
    injectFailure(failAt, 'after-rename');
    runHook(hooks, 'beforeCommit', { ...payload, designPath, evidencePath });

    if (!identityMatchesAt(destinationPath, destinationIdentity, { directory: true })) {
      throw new Error('destination identity changed before commit');
    }
    for (const owned of ownedFiles) {
      if (!ownedFileMatches(owned.path, owned.identity, owned.bytes)) {
        throw new Error(`owned destination object identity changed: ${owned.path}`);
      }
    }
    if (!ownedFileMatches(recovery.absolute, recovery.identity, evidenceBytes)) {
      throw new Error('recovery claim changed before commit');
    }
    if (identityAt(sourcePath) !== null) throw new Error('source path reappeared before commit');

    fsyncDirectory(destinationPath);
    fsyncDirectory(path.dirname(destinationPath));
    if (!unlinkOwned(recovery.absolute, recovery.identity, evidenceBytes)) {
      throw new Error('recovery claim identity changed before retirement');
    }
    fsyncDirectory(path.dirname(recovery.absolute));
    return { designPath, evidencePath, evidenceDigest };
  } catch (caught) {
    if (destinationIdentity !== null
      && identityMatchesAt(destinationPath, destinationIdentity, { directory: true })) {
      for (const owned of [...ownedFiles].reverse()) {
        try { unlinkOwned(owned.path, owned.identity, owned.bytes); } catch {}
      }
      try { fs.rmdirSync(destinationPath); } catch {}
    }

    if (recovery !== null) {
      let recoveryExact = ownedFileMatches(recovery.absolute, recovery.identity, evidenceBytes);
      if (!recoveryExact) {
        try {
          recovery = createRecoveryCopy(projectRoot, debugChain, sourcePathRelative, evidenceBytes);
          recoveryExact = true;
        } catch {}
      }

      const sourceState = inspectSource(sourcePath, sourceIdentity, evidenceBytes);
      if (recoveryExact && !sourceState.exists) {
        try {
          assertChain(debugChain, 'debug');
          fs.linkSync(recovery.absolute, sourcePath);
          if (!identityMatchesAt(sourcePath, recovery.identity, { file: true })
            || !fs.readFileSync(sourcePath).equals(evidenceBytes)) {
            throw new Error('restored source verification failed');
          }
          fsyncDirectory(path.dirname(sourcePath));
          unlinkOwned(recovery.absolute, recovery.identity, evidenceBytes);
          fsyncDirectory(path.dirname(recovery.absolute));
          recovery = null;
        } catch {}
      } else if (recoveryExact && sourceState.exact && !sourceWasClaimed) {
        try {
          unlinkOwned(recovery.absolute, recovery.identity, evidenceBytes);
          fsyncDirectory(path.dirname(recovery.absolute));
          recovery = null;
        } catch {}
      }
    }

    if (recovery !== null && ownedFileMatches(recovery.absolute, recovery.identity, evidenceBytes)) {
      throw appendRecovery(caught, recovery.relative);
    }
    throw caught;
  }
}

function requireCliArgs(args, count, usage) {
  if (args.length !== count) throw new Error(`usage: debug-promotion.mjs ${usage}`);
}

function runCli(argv) {
  const [command, ...args] = argv;
  if (command === 'discover') {
    requireCliArgs(args, 0, 'discover');
    return discoverDebugInvestigations();
  }
  if (command === 'create-design-stage') {
    requireCliArgs(args, 1, 'create-design-stage <source-token>');
    return createDebugDesignStage({ sourceToken: args[0] });
  }
  if (command === 'seal-design-stage') {
    requireCliArgs(args, 1, 'seal-design-stage <stage-token>');
    return sealDebugDesignStage({ stageToken: args[0] });
  }
  if (command === 'promote-token') {
    requireCliArgs(args, 2, 'promote-token <source-token> <sealed-stage-token>');
    return promoteDebugInvestigationFromTokens({ sourceToken: args[0], stageToken: args[1] });
  }
  if (command === 'dispose-design-stage') {
    requireCliArgs(args, 1, 'dispose-design-stage <sealed-stage-token>');
    return disposeDebugDesignStage({ stageToken: args[0] });
  }
  throw new Error('raw path debug promotion CLI is disabled; use discover');
}

if (process.argv[1]
  && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.stdout.write(`${JSON.stringify(runCli(process.argv.slice(2)))}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
