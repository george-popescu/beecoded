#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const DOMAIN = Buffer.from('NECTAR_APPROVAL_RECEIPT_V1\0', 'utf8');
const TOKEN_DOMAIN = Buffer.from('NECTAR_APPROVAL_TOKEN_V1\0', 'utf8');
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_TOKEN_LENGTH = 16_384;
const STAGE_MARKER = '.nectar-approval-stage.json';
const STAGE_PREFIX = 'nectar-approval-stage-';
const fatalUtf8 = new TextDecoder('utf-8', { fatal: true });

function normalRoot(root) {
  const requested = path.resolve(root);
  const stat = fs.lstatSync(requested);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('project root must be a normal directory');
  return fs.realpathSync(requested);
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

function strictDecode(bytes, label) {
  try {
    return fatalUtf8.decode(bytes);
  } catch {
    throw new Error(`${label} must contain valid UTF-8`);
  }
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
  let decoded;
  try {
    decoded = Buffer.from(token, 'base64url');
  } catch {
    throw new Error('token is not valid base64url');
  }
  if (decoded.toString('base64url') !== token) throw new Error('token is not canonical base64url');
  const wrapperText = strictDecode(decoded, 'token');
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
  const expectedChecksum = crypto.createHash('sha256')
    .update(TOKEN_DOMAIN)
    .update(wrapper.body)
    .digest('hex');
  if (wrapper.checksum !== expectedChecksum) throw new Error('token checksum mismatch');
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

function filesystemIdentity(target, expected = null) {
  const stat = fs.lstatSync(target, { bigint: true });
  if (stat.isSymbolicLink()) throw new Error(`symbolic link is not allowed: ${target}`);
  if (expected === 'file' && !stat.isFile()) throw new Error(`normal file required: ${target}`);
  if (expected === 'directory' && !stat.isDirectory()) throw new Error(`normal directory required: ${target}`);
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    mode: String(stat.mode),
  };
}

function rootBinding(projectRoot) {
  const root = normalRoot(projectRoot);
  return { identity: filesystemIdentity(root, 'directory'), path: root };
}

function sameFilesystemIdentity(left, right) {
  return Boolean(left && right)
    && left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode;
}

function assertRootBinding(projectRoot, binding) {
  const current = rootBinding(projectRoot);
  if (binding?.path !== current.path
    || !sameFilesystemIdentity(binding?.identity, current.identity)) {
    throw new Error('token root replay or identity mismatch');
  }
  return current.path;
}

function safeRelative(relative, label) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) throw new Error(`${label} must be relative`);
  const posix = relative.split(path.sep).join('/').replace(/\/$/, '');
  if (!posix.startsWith('docs/work/') || posix.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`${label} must stay inside docs/work`);
  }
  return posix;
}

function lstatNoFollow(root, relative, expected) {
  let current = root;
  const parts = relative.split('/');
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`symbolic link is not allowed: ${relative}`);
    if (index < parts.length - 1 && !stat.isDirectory()) throw new Error(`non-directory ancestor: ${relative}`);
    if (index === parts.length - 1 && expected === 'file' && !stat.isFile()) throw new Error(`not a normal file: ${relative}`);
    if (index === parts.length - 1 && expected === 'directory' && !stat.isDirectory()) throw new Error(`not a normal directory: ${relative}`);
  }
  return current;
}

function readNormal(root, relative) {
  const bytes = fs.readFileSync(lstatNoFollow(root, relative, 'file'));
  return strictDecode(bytes, relative);
}

function exactSingle(content, pattern, label) {
  const matches = [...content.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`expected exactly one ${label}`);
  return matches[0];
}

function reviewStateFields(content) {
  const lines = content.split('\n');
  const counts = [];
  const maximums = [];
  let decisionsSection = 0;
  let activeSection = null;
  let fence = null;

  for (let index = 0; index < lines.length; index += 1) {
    const clean = lines[index].replace(/\r$/, '');
    if (/^##\s+/.test(clean)) {
      fence = null;
      if (clean === '## Decisions') {
        decisionsSection += 1;
        activeSection = decisionsSection;
      } else {
        activeSection = null;
      }
      continue;
    }
    if (activeSection === null) continue;

    const fenceMatch = clean.trimStart().match(/^(```|~~~)/);
    if (fenceMatch) {
      fence = fence === null ? fenceMatch[1] : (fence === fenceMatch[1] ? null : fence);
      continue;
    }
    if (fence !== null) continue;

    const count = lines[index].match(/^(\s*(?:-\s*)?completed review-pass count:\s*)(\d+)([ \t]*\r?)$/i);
    const maximum = lines[index].match(/^(\s*(?:-\s*)?review-pass maximum:\s*)(\d+)([ \t]*\r?)$/i);
    if (count) counts.push({ index, section: activeSection, prefix: count[1], raw: count[2], suffix: count[3] });
    if (maximum) maximums.push({ index, section: activeSection, raw: maximum[2] });
  }
  return { lines, counts, maximums };
}

function parseSafeInteger(raw, label) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
  return value;
}

function canonicalDesign(content, { allowReviewState = false } = {}) {
  if (!allowReviewState) {
    return { canonical: content, completedReviewPasses: 0, reviewPassMaximum: null };
  }

  const fields = reviewStateFields(content);
  if (!fields.counts.length && !fields.maximums.length) {
    return { canonical: content, completedReviewPasses: 0, reviewPassMaximum: null };
  }
  if (fields.counts.length !== 1 || fields.maximums.length !== 1) {
    throw new Error('malformed or partial canonical review progress state');
  }
  const countField = fields.counts[0];
  const maximumField = fields.maximums[0];
  if (countField.section !== maximumField.section) {
    throw new Error('canonical review progress fields must share one Decisions section');
  }

  const completedReviewPasses = parseSafeInteger(countField.raw, 'completed review-pass count');
  const reviewPassMaximum = parseSafeInteger(maximumField.raw, 'review-pass maximum');
  if (reviewPassMaximum <= 0) throw new Error('review-pass maximum must be positive');
  if (completedReviewPasses > reviewPassMaximum) {
    throw new Error('completed review-pass count exceeds review-pass maximum');
  }

  const canonicalLines = [...fields.lines];
  canonicalLines[countField.index] = `${countField.prefix}<COUNT>${countField.suffix}`;
  return {
    canonical: canonicalLines.join('\n'),
    completedReviewPasses,
    reviewPassMaximum,
    countField,
  };
}

function canonicalPlan(content) {
  const approval = exactSingle(
    content,
    /^- Plan approval:\s*(PENDING|APPROVED \d{4}-\d{2}-\d{2})\s*$/gim,
    'Plan approval',
  );
  const revision = exactSingle(content, /^- Plan revision:\s*(\d+)\s*$/gim, 'Plan revision');
  exactSingle(content, /^- Solution fit:\s*FIT\s*$/gim, 'Solution fit: FIT');

  let wave = null;
  const tasks = [];
  const seen = new Set();
  for (const line of content.split('\n')) {
    const waveMatch = line.match(/^## Wave (\d+)/);
    if (waveMatch) wave = Number.parseInt(waveMatch[1], 10);
    const ordinary = line.match(/^- \[([ x])\] (T(\d+)):/);
    const struck = line.match(/^- \[x\] ~~(T(\d+)):.*~~ struck:/);
    const task = ordinary || struck;
    if (!task) continue;
    if (wave === null) throw new Error('task appears before a wave');
    const id = ordinary ? ordinary[2] : struck[1];
    if (seen.has(id)) throw new Error(`duplicate task id: ${id}`);
    seen.add(id);
    tasks.push({
      id,
      number: Number.parseInt(ordinary ? ordinary[3] : struck[2], 10),
      wave,
      completed: struck ? true : ordinary[1] === 'x',
      struck: Boolean(struck),
    });
  }
  if (!tasks.length) throw new Error('plan has no tasks');
  for (let index = 0; index < tasks.length; index += 1) {
    if (tasks[index].number !== index + 1) throw new Error('task ids must be contiguous');
  }

  const ordinaryWaves = new Map();
  for (const task of tasks) {
    if (task.struck) continue;
    if (!ordinaryWaves.has(task.wave)) ordinaryWaves.set(task.wave, []);
    ordinaryWaves.get(task.wave).push(task.completed);
  }
  let pendingWaveSeen = false;
  for (const [waveNumber, completion] of ordinaryWaves) {
    const complete = completion.every(Boolean);
    const pending = completion.every((value) => !value);
    if (!complete && !pending) {
      throw new Error(`partial ordinary wave progress: wave ${waveNumber} must be uniformly complete or pending`);
    }
    if (complete && pendingWaveSeen) {
      throw new Error('future-wave ordinary progress: completed ordinary waves must form one prefix');
    }
    if (pending) pendingWaveSeen = true;
  }

  const canonical = content
    .replace(approval[0], '- Plan approval: <APPROVAL>')
    .split('\n')
    .map((line) => line.replace(/^- \[[ x]\] (T\d+:)/, '- [ ] $1'))
    .join('\n');

  return {
    canonical,
    revision: Number.parseInt(revision[1], 10),
    tasks,
  };
}

function parseTopics(parentDesign) {
  const marker = parentDesign.match(/^## Topics\s*$/m);
  if (!marker) throw new Error('nested parent has no Topics section');
  const tail = parentDesign.slice(marker.index + marker[0].length);
  const body = tail.split(/^## /m)[0];
  const entries = [];
  for (const line of body.split('\n')) {
    if (!/^\d+\./.test(line)) continue;
    const match = line.match(/^(\d+)\. `([^`]+)\/` — .+; depends on: (.+)$/);
    if (!match) throw new Error(`invalid Topics entry: ${line}`);
    const dependencies = match[3] === 'none'
      ? []
      : [...match[3].matchAll(/`([^`]+)\/`/g)].map((item) => item[1]);
    if (match[3] !== 'none' && !dependencies.length) throw new Error(`invalid dependency syntax: ${line}`);
    entries.push({ index: Number.parseInt(match[1], 10), name: match[2], dependencies });
  }
  if (!entries.length) throw new Error('Topics section is empty');
  return entries;
}

function validateNestedHierarchy(root, parentRelative, leafName, parentDesign) {
  const entries = parseTopics(parentDesign);
  const names = new Set(entries.map((entry) => entry.name));
  if (names.size !== entries.length) throw new Error('duplicate Topics path');
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const expected = index + 1;
    if (entry.index !== expected || !entry.name.startsWith(`${String(expected).padStart(2, '0')}-`)) {
      throw new Error('Topics numbering must be contiguous');
    }
    for (const dependency of entry.dependencies) {
      const dependencyIndex = entries.findIndex((candidate) => candidate.name === dependency);
      if (dependencyIndex < 0 || dependencyIndex >= index) throw new Error('dependency must target an earlier sibling');
    }
  }
  if (entries.filter((entry) => entry.name === leafName).length !== 1) {
    throw new Error('leaf must appear exactly once in parent Topics');
  }

  const parentPath = lstatNoFollow(root, parentRelative, 'directory');
  const children = fs.readdirSync(parentPath, { withFileTypes: true })
    .filter((entry) => /^\d{2}-/.test(entry.name))
    .map((entry) => {
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('topic child must be a normal directory');
      return entry.name;
    })
    .sort();
  assertArrayEqual(children, entries.map((entry) => entry.name), 'parent Topics and directories differ');
}

function assertArrayEqual(actual, expected, message) {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(message);
  }
}

function deriveArtifacts(root, topic) {
  const topicRelative = safeRelative(topic, 'topic');
  lstatNoFollow(root, topicRelative, 'directory');
  const topicParts = topicRelative.split('/').slice(2);
  if (topicParts.length < 1 || topicParts.length > 2) {
    throw new Error('topic shape must be one direct root or one child below it');
  }
  const leafName = path.posix.basename(topicRelative);
  const nested = topicParts.length === 2;
  if (nested && !/^\d{2}-/.test(leafName)) {
    throw new Error('nested topic must be a numbered child');
  }
  const leafDesignRelative = `${topicRelative}/design.md`;
  const leafPlanRelative = `${topicRelative}/plan.md`;
  const leafDesign = readNormal(root, leafDesignRelative);
  const leafPlan = readNormal(root, leafPlanRelative);
  const artifacts = [];

  if (nested) {
    const parentRelative = path.posix.dirname(topicRelative);
    if (!/^docs\/work\/\d{4}-\d{2}-\d{2}-/.test(parentRelative)) {
      throw new Error('nested leaf must belong to a dated parent');
    }
    const parentDesignRelative = `${parentRelative}/design.md`;
    const parentDesign = readNormal(root, parentDesignRelative);
    validateNestedHierarchy(root, parentRelative, leafName, parentDesign);
    artifacts.push({ role: 'parent-design', relative: parentDesignRelative, content: parentDesign });
  } else {
    const topicPath = lstatNoFollow(root, topicRelative, 'directory');
    const childDirectories = fs.readdirSync(topicPath, { withFileTypes: true })
      .filter((entry) => /^\d{2}-/.test(entry.name));
    if (childDirectories.length) throw new Error('project parent cannot be used as a direct leaf');
  }

  artifacts.push(
    { role: 'leaf-design', relative: leafDesignRelative, content: leafDesign },
    { role: 'leaf-plan', relative: leafPlanRelative, content: leafPlan },
  );
  return artifacts;
}

function frame(hash, value) {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length);
  hash.update(bytes);
}

function snapshot({ projectRoot, topic }) {
  const root = normalRoot(projectRoot);
  const artifacts = deriveArtifacts(root, topic);
  const hash = crypto.createHash('sha256');
  hash.update(DOMAIN);
  let planState = null;
  let reviewState = null;
  for (const artifact of artifacts) {
    const state = artifact.role === 'leaf-plan'
      ? canonicalPlan(artifact.content)
      : canonicalDesign(artifact.content, { allowReviewState: artifact.role === 'leaf-design' });
    if (artifact.role === 'leaf-plan') planState = state;
    if (artifact.role === 'leaf-design') reviewState = state;
    frame(hash, artifact.role);
    frame(hash, artifact.relative);
    frame(hash, state.canonical);
  }
  return {
    kind: 'CURRENT_RUN',
    digest: hash.digest('hex'),
    revision: planState.revision,
    derivedPaths: artifacts.map((artifact) => artifact.relative),
    orderedTaskIds: planState.tasks.map((task) => task.id),
    completedTaskIds: planState.tasks.filter((task) => task.completed).map((task) => task.id),
    taskWaves: Object.fromEntries(planState.tasks.map((task) => [task.id, task.wave])),
    completedReviewPasses: reviewState.completedReviewPasses,
    reviewPassMaximum: reviewState.reviewPassMaximum,
  };
}

function selectionToken(root, topic) {
  return encodeOpaqueToken('selection', { root: rootBinding(root), topic });
}

function normalDirectoryEntries(target) {
  return fs.readdirSync(target, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function discoverApprovalTopics({ projectRoot = process.cwd() } = {}) {
  const root = normalRoot(projectRoot);
  const workRelative = 'docs/work';
  const workPath = path.join(root, workRelative);
  const entries = [];
  const discrepancies = [];
  if (!fs.existsSync(workPath)) return { entries, discrepancies };

  try {
    lstatNoFollow(root, workRelative, 'directory');
  } catch (error) {
    return { entries, discrepancies: [{ displayPath: workRelative, error: error.message }] };
  }

  for (const rootEntry of normalDirectoryEntries(workPath)) {
    const rootRelative = `${workRelative}/${rootEntry.name}`;
    if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory()) {
      if (rootEntry.isSymbolicLink()) {
        discrepancies.push({ displayPath: rootRelative, error: 'topic root must not be a symbolic link' });
      }
      continue;
    }

    let candidates = [rootRelative];
    try {
      const rootPath = lstatNoFollow(root, rootRelative, 'directory');
      const children = normalDirectoryEntries(rootPath);
      const numbered = children.filter((entry) => /^\d{2}-/.test(entry.name));
      let hasTopics = false;
      try {
        hasTopics = /^## Topics\s*$/m.test(readNormal(root, `${rootRelative}/design.md`));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (hasTopics || numbered.length) {
        candidates = [];
        for (const child of numbered) {
          const childRelative = `${rootRelative}/${child.name}`;
          if (child.isSymbolicLink() || !child.isDirectory()) {
            discrepancies.push({ displayPath: childRelative, error: 'topic child must be a normal directory' });
          } else {
            candidates.push(childRelative);
          }
        }
        if (!candidates.length) {
          discrepancies.push({ displayPath: rootRelative, error: 'project parent has no normal numbered leaves' });
        }
      }
    } catch (error) {
      discrepancies.push({ displayPath: rootRelative, error: error.message });
      continue;
    }

    for (const topic of candidates) {
      try {
        snapshot({ projectRoot: root, topic });
        entries.push({ displayPath: topic, token: selectionToken(root, topic) });
      } catch (error) {
        discrepancies.push({ displayPath: topic, error: error.message });
      }
    }
  }

  entries.sort((left, right) => left.displayPath.localeCompare(right.displayPath));
  discrepancies.sort((left, right) => left.displayPath.localeCompare(right.displayPath));
  return { entries, discrepancies };
}

function topicFromSelectionToken(projectRoot, token) {
  const payload = decodeOpaqueToken(token, 'selection');
  const root = assertRootBinding(projectRoot, payload?.root);
  const topic = safeRelative(payload?.topic, 'token topic');
  const discovered = discoverApprovalTopics({ projectRoot: root });
  const entry = discovered.entries.find((candidate) => candidate.token === token);
  if (!entry || entry.displayPath !== topic) {
    throw new Error('selection token is not a current discovery membership');
  }
  return { root, topic };
}

function receiptPayload(receipt) {
  return {
    completedReviewPasses: receipt.completedReviewPasses,
    completedTaskIds: receipt.completedTaskIds,
    derivedPaths: receipt.derivedPaths,
    digest: receipt.digest,
    kind: receipt.kind,
    orderedTaskIds: receipt.orderedTaskIds,
    reviewPassMaximum: receipt.reviewPassMaximum,
    revision: receipt.revision,
    taskWaves: receipt.taskWaves,
  };
}

function pendingWaveTaskIds(receipt) {
  const completed = new Set(receipt.completedTaskIds);
  const pending = receipt.orderedTaskIds.filter((id) => !completed.has(id));
  if (!pending.length) return [];
  const wave = Math.min(...pending.map((id) => receipt.taskWaves[id]));
  return pending.filter((id) => receipt.taskWaves[id] === wave);
}

function receiptEnvelope(root, topicToken, receipt) {
  const core = receiptPayload(receipt);
  const receiptToken = encodeOpaqueToken('receipt', {
    receipt: core,
    root: rootBinding(root),
    topicToken,
  });
  const expectedTaskIds = pendingWaveTaskIds(core);
  const taskAdvanceToken = expectedTaskIds.length
    ? encodeOpaqueToken('task-advance', {
      expectedTaskIds,
      receiptTokenHash: crypto.createHash('sha256').update(receiptToken).digest('hex'),
      root: rootBinding(root),
      topicToken,
    })
    : null;
  return { ...core, receiptToken, taskAdvanceToken, topicToken };
}

export function createApprovalReceiptFromToken({
  projectRoot = process.cwd(),
  topicToken,
} = {}) {
  const { root, topic } = topicFromSelectionToken(projectRoot, topicToken);
  return receiptEnvelope(root, topicToken, snapshot({ projectRoot: root, topic }));
}

function receiptFromToken(projectRoot, topicToken, token) {
  const payload = decodeOpaqueToken(token, 'receipt');
  const root = assertRootBinding(projectRoot, payload?.root);
  if (payload?.topicToken !== topicToken) throw new Error('receipt token topic mismatch');
  if (!payload?.receipt || payload.receipt.kind !== 'CURRENT_RUN') {
    throw new Error('receipt token payload is invalid');
  }
  return { receipt: payload.receipt, root };
}

export function advanceTaskReceiptFromTokens({
  projectRoot = process.cwd(),
  topicToken,
  receiptToken,
  taskAdvanceToken,
} = {}) {
  const { root, topic } = topicFromSelectionToken(projectRoot, topicToken);
  const decoded = receiptFromToken(root, topicToken, receiptToken);
  const advance = decodeOpaqueToken(taskAdvanceToken, 'task-advance');
  assertRootBinding(root, advance?.root);
  if (advance?.topicToken !== topicToken
    || advance?.receiptTokenHash !== crypto.createHash('sha256').update(receiptToken).digest('hex')) {
    throw new Error('task advance token does not match receipt');
  }
  const updated = advanceTaskReceipt({
    receipt: decoded.receipt,
    projectRoot: root,
    topic,
    verifiedTaskIds: advance.expectedTaskIds,
  });
  return receiptEnvelope(root, topicToken, updated);
}

export function advanceReviewReceiptFromTokens({
  projectRoot = process.cwd(),
  topicToken,
  receiptToken,
} = {}) {
  const { root, topic } = topicFromSelectionToken(projectRoot, topicToken);
  const decoded = receiptFromToken(root, topicToken, receiptToken);
  const updated = advanceReviewReceipt({
    receipt: decoded.receipt,
    projectRoot: root,
    topic,
  });
  return receiptEnvelope(root, topicToken, updated);
}

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function markerState(root) {
  const markerPath = path.join(root, STAGE_MARKER);
  const markerIdentity = filesystemIdentity(markerPath, 'file');
  const markerBytes = fs.readFileSync(markerPath);
  const afterIdentity = filesystemIdentity(markerPath, 'file');
  if (!sameFilesystemIdentity(markerIdentity, afterIdentity)) {
    throw new Error('stage marker identity changed while reading');
  }
  const markerText = strictDecode(markerBytes, 'stage marker');
  let marker;
  try {
    marker = JSON.parse(markerText);
  } catch {
    throw new Error('stage marker JSON is invalid');
  }
  if (stableJson(marker) !== markerText
    || marker?.version !== 1
    || typeof marker?.nonce !== 'string'
    || !/^[a-f0-9]{48}$/.test(marker.nonce)
    || typeof marker?.sealed !== 'boolean') {
    throw new Error('stage marker is not canonical');
  }
  return {
    marker,
    markerHash: sha256Bytes(markerBytes),
    markerIdentity,
    markerPath,
  };
}

function stageTokenFor(root) {
  const state = markerState(root);
  return encodeOpaqueToken('stage', {
    markerHash: state.markerHash,
    markerIdentity: state.markerIdentity,
    nonce: state.marker.nonce,
    root: rootBinding(root),
    sealed: state.marker.sealed,
  });
}

function validateStageToken(token, { sealed = null, manifest = false } = {}) {
  const payload = decodeOpaqueToken(token, 'stage');
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const root = assertRootBinding(payload?.root?.path, payload?.root);
  const relative = path.relative(temporaryRoot, root);
  if (relative.startsWith('..') || path.isAbsolute(relative)
    || !path.basename(root).startsWith(STAGE_PREFIX)) {
    throw new Error('stage root is outside the helper-owned temporary namespace');
  }
  const state = markerState(root);
  if (!sameFilesystemIdentity(payload?.markerIdentity, state.markerIdentity)
    || payload?.markerHash !== state.markerHash
    || payload?.nonce !== state.marker.nonce
    || payload?.sealed !== state.marker.sealed) {
    throw new Error('stage token marker identity or content mismatch');
  }
  if (sealed !== null && state.marker.sealed !== sealed) {
    throw new Error(sealed ? 'stage must be sealed' : 'stage is already sealed');
  }
  if (manifest) assertStageManifest(root, state.marker.manifest);
  return { root, state };
}

function writeExclusiveStageMarker(root, marker) {
  const markerPath = path.join(root, STAGE_MARKER);
  const descriptor = fs.openSync(markerPath, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, stableJson(marker), 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

export function createApprovalStage() {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temporaryRoot, STAGE_PREFIX));
  fs.chmodSync(root, 0o700);
  writeExclusiveStageMarker(root, {
    manifest: null,
    nonce: crypto.randomBytes(24).toString('hex'),
    sealed: false,
    version: 1,
  });
  return { displayPath: root, stageToken: stageTokenFor(root) };
}

function manifestIdentity(stat) {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    mode: String(stat.mode),
  };
}

function scanStageManifest(root) {
  const records = [];
  function visit(directory, relativeDirectory = '') {
    const directoryStatBefore = fs.lstatSync(directory, { bigint: true });
    if (!directoryStatBefore.isDirectory() || directoryStatBefore.isSymbolicLink()) {
      throw new Error(`stage manifest requires a normal directory: ${relativeDirectory || '.'}`);
    }
    for (const entry of normalDirectoryEntries(directory)) {
      if (!relativeDirectory && entry.name === STAGE_MARKER) continue;
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      const statBefore = fs.lstatSync(absolute, { bigint: true });
      if (statBefore.isSymbolicLink()) throw new Error(`stage manifest rejects symbolic link: ${relative}`);
      if (statBefore.isDirectory()) {
        records.push({ identity: manifestIdentity(statBefore), path: relative, type: 'directory' });
        visit(absolute, relative);
        const statAfter = fs.lstatSync(absolute, { bigint: true });
        if (!sameFilesystemIdentity(manifestIdentity(statBefore), manifestIdentity(statAfter))) {
          throw new Error(`stage directory identity changed while sealing: ${relative}`);
        }
      } else if (statBefore.isFile()) {
        const bytes = fs.readFileSync(absolute);
        const statAfter = fs.lstatSync(absolute, { bigint: true });
        if (!sameFilesystemIdentity(manifestIdentity(statBefore), manifestIdentity(statAfter))) {
          throw new Error(`stage file identity changed while sealing: ${relative}`);
        }
        records.push({
          identity: manifestIdentity(statBefore),
          path: relative,
          sha256: sha256Bytes(bytes),
          size: String(statBefore.size),
          type: 'file',
        });
      } else {
        throw new Error(`stage manifest rejects special file: ${relative}`);
      }
    }
  }
  visit(root);
  records.sort((left, right) => left.path.localeCompare(right.path));
  return records;
}

function assertStageManifest(root, expected) {
  if (!Array.isArray(expected)) throw new Error('sealed stage manifest is missing');
  const current = scanStageManifest(root);
  if (stableJson(current) !== stableJson(expected)) {
    throw new Error(`stage manifest changed; retained stage path: ${root}`);
  }
  return current;
}

export function sealApprovalStage({ stageToken } = {}) {
  const { root, state } = validateStageToken(stageToken, { sealed: false });
  const manifest = scanStageManifest(root);
  const marker = {
    manifest,
    nonce: state.marker.nonce,
    sealed: true,
    version: 1,
  };
  writeNormalAtomic(root, STAGE_MARKER, stableJson(marker));
  return { displayPath: root, stageToken: stageTokenFor(root) };
}

export function discoverApprovalStage({ stageToken } = {}) {
  const { root } = validateStageToken(stageToken, { sealed: true, manifest: true });
  return discoverApprovalTopics({ projectRoot: root });
}

export function createStageApprovalReceiptFromToken({ stageToken, topicToken } = {}) {
  const { root } = validateStageToken(stageToken, { sealed: true, manifest: true });
  return createApprovalReceiptFromToken({ projectRoot: root, topicToken });
}

function manifestRecordAt(root, record) {
  const absolute = path.join(root, ...record.path.split('/'));
  const stat = fs.lstatSync(absolute, { bigint: true });
  if (stat.isSymbolicLink()) throw new Error(`stage disposal rejects symbolic link: ${record.path}`);
  const actual = { identity: manifestIdentity(stat), path: record.path, type: record.type };
  if (record.type === 'file') {
    if (!stat.isFile()) throw new Error(`stage disposal expected file: ${record.path}`);
    actual.sha256 = sha256Bytes(fs.readFileSync(absolute));
    actual.size = String(stat.size);
  } else if (!stat.isDirectory()) {
    throw new Error(`stage disposal expected directory: ${record.path}`);
  }
  if (stableJson(actual) !== stableJson(record)) {
    throw new Error(`stage descendant changed; retained stage path: ${root}`);
  }
  return absolute;
}

export function disposeApprovalStage({ stageToken } = {}) {
  const { root, state } = validateStageToken(stageToken, { sealed: true, manifest: true });
  const manifest = state.marker.manifest;
  const files = manifest.filter((record) => record.type === 'file');
  const directories = manifest
    .filter((record) => record.type === 'directory')
    .sort((left, right) => right.path.split('/').length - left.path.split('/').length);

  for (const record of files) fs.unlinkSync(manifestRecordAt(root, record));
  for (const record of directories) fs.rmdirSync(manifestRecordAt(root, record));
  const marker = markerState(root);
  if (!sameFilesystemIdentity(marker.markerIdentity, state.markerIdentity)
    || marker.markerHash !== state.markerHash) {
    throw new Error(`stage marker changed; retained stage path: ${root}`);
  }
  fs.unlinkSync(marker.markerPath);
  fs.rmdirSync(root);
  return { disposed: true };
}

function assertReceiptIdentity(receipt, current) {
  if (!receipt || receipt.kind !== 'CURRENT_RUN') throw new Error('missing CURRENT_RUN receipt');
  if (receipt.digest !== current.digest) throw new Error('approval digest mismatch');
  if (receipt.revision !== current.revision) throw new Error('Plan revision mismatch');
  assertArrayEqual(receipt.derivedPaths, current.derivedPaths, 'derived paths mismatch');
  assertArrayEqual(receipt.orderedTaskIds, current.orderedTaskIds, 'ordered tasks mismatch');
  if (JSON.stringify(receipt.taskWaves) !== JSON.stringify(current.taskWaves)) {
    throw new Error('task waves mismatch');
  }
  if (receipt.reviewPassMaximum !== current.reviewPassMaximum) throw new Error('review-pass maximum changed');
}

function writeNormalAtomic(root, relative, content) {
  const target = lstatNoFollow(root, relative, 'file');
  const mode = fs.statSync(target).mode;
  const directory = path.dirname(target);
  const temporary = path.join(
    directory,
    `.${path.basename(target)}.nectar-${process.pid}-${crypto.randomBytes(8).toString('hex')}`,
  );
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', mode);
    fs.writeFileSync(descriptor, content, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, target);
    const directoryDescriptor = fs.openSync(directory, 'r');
    try {
      fs.fsyncSync(directoryDescriptor);
    } finally {
      fs.closeSync(directoryDescriptor);
    }
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(temporary);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') throw cleanupError;
    }
    throw error;
  }
}

function replacePendingTaskChecks(content, taskIds) {
  const wanted = new Set(taskIds);
  const found = new Set();
  const lines = content.split('\n').map((line) => {
    const match = line.match(/^- \[ \] (T\d+):/);
    if (!match || !wanted.has(match[1])) return line;
    found.add(match[1]);
    return line.replace('- [ ]', '- [x]');
  });
  assertArrayEqual([...found].sort(), [...wanted].sort(), 'verified task is not an exact pending task');
  return lines.join('\n');
}

function replaceReviewCount(content, nextCount) {
  const state = canonicalDesign(content, { allowReviewState: true });
  if (!state.countField) throw new Error('canonical review progress state is missing');
  const lines = content.split('\n');
  lines[state.countField.index] = `${state.countField.prefix}${nextCount}${state.countField.suffix}`;
  return lines.join('\n');
}

function writeThenSnapshot({ root, relative, before, after, topic, validate }) {
  writeNormalAtomic(root, relative, after);
  try {
    const current = snapshot({ projectRoot: root, topic });
    validate(current);
    return current;
  } catch (error) {
    writeNormalAtomic(root, relative, before);
    throw error;
  }
}

export function createApprovalReceipt(args) {
  return snapshot(args);
}

export function advanceTaskReceipt({ receipt, projectRoot, topic, verifiedTaskIds }) {
  const root = normalRoot(projectRoot);
  const current = snapshot({ projectRoot, topic });
  assertReceiptIdentity(receipt, current);
  const previous = new Set(receipt.completedTaskIds);
  const next = new Set(current.completedTaskIds);
  const removed = [...previous].filter((id) => !next.has(id));
  if (removed.length) throw new Error(`task progress rewind: ${removed.join(', ')}`);
  const added = [...next].filter((id) => !previous.has(id));
  if (added.length) throw new Error('task progress mismatch: artifact changed outside receipt helper');

  const pending = receipt.orderedTaskIds.filter((id) => !previous.has(id));
  if (!pending.length) throw new Error('duplicate completion or no pending task progress');
  const currentWave = Math.min(...pending.map((id) => receipt.taskWaves[id]));
  const expected = pending.filter((id) => receipt.taskWaves[id] === currentWave);
  assertArrayEqual([...verifiedTaskIds].sort(), [...expected].sort(), 'must complete the exact pending current wave');

  const planRelative = receipt.derivedPaths.at(-1);
  const before = readNormal(root, planRelative);
  const after = replacePendingTaskChecks(before, expected);
  const completedAfterAdvance = new Set([...receipt.completedTaskIds, ...expected]);
  const expectedCompleted = receipt.orderedTaskIds.filter((id) => completedAfterAdvance.has(id));
  return writeThenSnapshot({
    root,
    relative: planRelative,
    before,
    after,
    topic,
    validate(updated) {
      assertReceiptIdentity(receipt, updated);
      assertArrayEqual(updated.completedTaskIds, expectedCompleted, 'task progress write verification failed');
    },
  });
}

export function advanceReviewReceipt({ receipt, projectRoot, topic }) {
  const root = normalRoot(projectRoot);
  const current = snapshot({ projectRoot, topic });
  assertReceiptIdentity(receipt, current);
  assertArrayEqual(receipt.completedTaskIds, current.completedTaskIds, 'task progress changed during review');
  if (current.completedReviewPasses < receipt.completedReviewPasses) throw new Error('review progress rewind');
  if (current.completedReviewPasses > receipt.completedReviewPasses) {
    throw new Error('review progress mismatch: artifact changed outside receipt helper');
  }
  if (current.reviewPassMaximum === null || current.completedReviewPasses >= current.reviewPassMaximum) {
    throw new Error('review-pass maximum reached');
  }

  const designRelative = receipt.derivedPaths.at(-2);
  const before = readNormal(root, designRelative);
  const expectedCount = receipt.completedReviewPasses + 1;
  const after = replaceReviewCount(before, expectedCount);
  return writeThenSnapshot({
    root,
    relative: designRelative,
    before,
    after,
    topic,
    validate(updated) {
      assertReceiptIdentity(receipt, updated);
      assertArrayEqual(receipt.completedTaskIds, updated.completedTaskIds, 'task progress changed during review');
      if (updated.completedReviewPasses !== expectedCount) {
        throw new Error('review progress write verification failed');
      }
    },
  });
}

function requireCliArgs(argv, count, usage) {
  if (argv.length !== count) throw new Error(`usage: approval-receipt.mjs ${usage}`);
}

function runCli(argv) {
  const [command, ...args] = argv;
  if (command === 'snapshot') {
    throw new Error('raw path snapshot CLI is disabled; use discover and snapshot-token');
  }
  if (command === 'discover') {
    requireCliArgs(args, 0, 'discover');
    return discoverApprovalTopics();
  }
  if (command === 'snapshot-token') {
    requireCliArgs(args, 1, 'snapshot-token <selection-token>');
    return createApprovalReceiptFromToken({ topicToken: args[0] });
  }
  if (command === 'advance-task-token') {
    requireCliArgs(args, 3, 'advance-task-token <selection-token> <receipt-token> <task-token>');
    return advanceTaskReceiptFromTokens({
      receiptToken: args[1],
      taskAdvanceToken: args[2],
      topicToken: args[0],
    });
  }
  if (command === 'advance-review-token') {
    requireCliArgs(args, 2, 'advance-review-token <selection-token> <receipt-token>');
    return advanceReviewReceiptFromTokens({ receiptToken: args[1], topicToken: args[0] });
  }
  if (command === 'create-stage') {
    requireCliArgs(args, 0, 'create-stage');
    return createApprovalStage();
  }
  if (command === 'seal-stage') {
    requireCliArgs(args, 1, 'seal-stage <stage-token>');
    return sealApprovalStage({ stageToken: args[0] });
  }
  if (command === 'stage-discover') {
    requireCliArgs(args, 1, 'stage-discover <stage-token>');
    return discoverApprovalStage({ stageToken: args[0] });
  }
  if (command === 'stage-snapshot-token') {
    requireCliArgs(args, 2, 'stage-snapshot-token <stage-token> <selection-token>');
    return createStageApprovalReceiptFromToken({ stageToken: args[0], topicToken: args[1] });
  }
  if (command === 'dispose-stage') {
    requireCliArgs(args, 1, 'dispose-stage <stage-token>');
    return disposeApprovalStage({ stageToken: args[0] });
  }
  throw new Error('unknown approval receipt command; use discover');
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
