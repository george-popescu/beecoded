import fs from 'node:fs';
import path from 'node:path';

import { parseReviewCompletion } from '../review-completion.mjs';
import { parsePlanState } from '../plan-state.mjs';

const DATED_ROOT = /^(\d{4})-(\d{2})-(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const CHILD_TOPIC = /^(\d+)-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const ARTIFACT_LIMIT_BYTES = 256 * 1024;
const PARENT_STRUCTURE_CODES = new Set([
  'ARTIFACT_TOO_LARGE',
  'INVALID_TOPIC_ENTRY',
  'INVALID_DEPENDENCY_SYNTAX',
  'PARENT_TOPICS_MISSING',
  'INVALID_CHILD_NAME',
  'MIXED_CHILD_PADDING',
  'DUPLICATE_CHILD_NUMBER',
  'NON_CONTIGUOUS_CHILDREN',
  'UNKNOWN_DEPENDENCY',
  'SELF_DEPENDENCY',
  'FORWARD_DEPENDENCY',
  'DEPENDENCY_CYCLE',
  'MISSING_LISTED_CHILD',
  'UNLISTED_CHILD',
  'TOPIC_ORDER_MISMATCH',
  'UNSAFE_ARTIFACT',
  'UNSAFE_TOPIC_PATH',
  'UNSUPPORTED_NESTING',
]);

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function relativeProjectPath(projectRoot, absolute) {
  return toPosix(path.relative(projectRoot, absolute));
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalPathState(projectRoot, realProjectRoot, candidate) {
  const relative = path.relative(projectRoot, candidate);
  if (!isInside(projectRoot, candidate)) return { exists: false, safe: false };

  let current = projectRoot;
  let stat = null;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      stat = fs.lstatSync(current, { bigint: true });
    } catch (error) {
      if (error.code === 'ENOENT') return { exists: false, safe: true };
      throw error;
    }
    if (stat.isSymbolicLink()) return { exists: true, safe: false };
  }

  if (!stat) stat = fs.lstatSync(projectRoot, { bigint: true });
  const realCandidate = fs.realpathSync(candidate);
  if (!isInside(realProjectRoot, realCandidate)) return { exists: true, safe: false };
  return { exists: true, safe: true, stat };
}

function normalDirectories({
  addDiagnostic,
  projectRoot,
  realProjectRoot,
  root,
  rootPath,
  unsafePaths,
}) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    addDiagnostic(
      'UNSAFE_TOPIC_PATH',
      rootPath,
      'Work topic directories must be normal readable directories inside docs/work.',
    );
    unsafePaths.add(rootPath);
    return [];
  }

  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const absolute = path.join(root, entry.name);
    const relative = `${rootPath}/${entry.name}`;
    let state;
    try {
      state = normalPathState(projectRoot, realProjectRoot, absolute);
    } catch {
      state = { exists: true, safe: false };
    }
    if (!state.safe || !state.exists || !state.stat?.isDirectory()) {
      addDiagnostic(
        'UNSAFE_TOPIC_PATH',
        relative,
        'Work topic directories must be normal non-symlink directories inside docs/work.',
      );
      unsafePaths.add(relative);
      continue;
    }
    found.push(entry.name);
  }
  return found.sort();
}

function readBoundedArtifact({
  addDiagnostic,
  cache,
  file,
  projectRoot,
  realProjectRoot,
  unsafePaths,
}) {
  if (cache.has(file)) return cache.get(file);
  const relative = relativeProjectPath(projectRoot, file);
  const reject = (code, message) => {
    addDiagnostic(code, relative, message);
    unsafePaths.add(relative);
    cache.set(file, null);
    return null;
  };

  let state;
  try {
    state = normalPathState(projectRoot, realProjectRoot, file);
  } catch {
    return reject(
      'UNSAFE_ARTIFACT',
      'Work artifacts must be normal readable files inside the project root.',
    );
  }
  if (!state.exists) {
    cache.set(file, null);
    return null;
  }
  if (!state.safe || !state.stat?.isFile()) {
    return reject(
      'UNSAFE_ARTIFACT',
      'Work artifacts must be normal non-symlink files inside the project root.',
    );
  }
  if (state.stat.size > BigInt(ARTIFACT_LIMIT_BYTES)) {
    return reject(
      'ARTIFACT_TOO_LARGE',
      `Work artifacts must not exceed ${ARTIFACT_LIMIT_BYTES} bytes.`,
    );
  }

  let descriptor;
  try {
    descriptor = fs.openSync(
      file,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile()
      || before.size > BigInt(ARTIFACT_LIMIT_BYTES)
      || before.dev !== state.stat.dev
      || before.ino !== state.stat.ino) {
      const tooLarge = before.size > BigInt(ARTIFACT_LIMIT_BYTES);
      return reject(
        tooLarge ? 'ARTIFACT_TOO_LARGE' : 'UNSAFE_ARTIFACT',
        tooLarge
          ? `Work artifacts must not exceed ${ARTIFACT_LIMIT_BYTES} bytes.`
          : 'Work artifacts must remain normal files while Doctor reads them.',
      );
    }
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (offset !== bytes.length
      || after.dev !== before.dev
      || after.ino !== before.ino
      || after.size !== before.size
      || after.mtimeNs !== before.mtimeNs) {
      return reject(
        'UNSAFE_ARTIFACT',
        'Work artifacts must remain unchanged while Doctor reads them.',
      );
    }
    const content = bytes.toString('utf8');
    cache.set(file, content);
    return content;
  } catch {
    return reject(
      'UNSAFE_ARTIFACT',
      'Work artifacts must be normal readable files inside the project root.',
    );
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function validCalendarDate(year, month, day) {
  const value = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return value.getUTCFullYear() === Number(year)
    && value.getUTCMonth() === Number(month) - 1
    && value.getUTCDate() === Number(day);
}

function section(content, heading) {
  if (!content) return null;
  const match = content.match(new RegExp(`^## ${heading}\\s*$`, 'm'));
  if (!match) return null;
  const start = match.index + match[0].length;
  const rest = content.slice(start);
  const next = rest.search(/^## /m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

function parseTopics(content, designPath, addDiagnostic) {
  const body = section(content, 'Topics');
  if (body === null) return null;
  const entries = [];

  for (const line of body.split('\n').filter((candidate) => candidate.trim())) {
    const match = line.match(/^\s*(\d+)\.\s+`([^`]+)`\s+—\s+.+?;\s*depends on:\s*(.+?)\s*$/);
    if (!match) {
      addDiagnostic(
        'INVALID_TOPIC_ENTRY',
        designPath,
        'Topic entries must use the documented numbered path and depends-on format.',
        line.trim(),
      );
      continue;
    }

    const topicPath = match[2].replace(/\/$/, '');
    const rawDependencies = match[3].trim();
    let dependencies = [];
    if (rawDependencies !== 'none') {
      if (!/^`[^`]+`(?:,\s*`[^`]+`)*$/.test(rawDependencies)) {
        addDiagnostic(
          'INVALID_DEPENDENCY_SYNTAX',
          designPath,
          `Invalid dependency syntax for ${topicPath}.`,
          rawDependencies,
        );
      } else {
        dependencies = [...rawDependencies.matchAll(/`([^`]+)`/g)]
          .map((dependency) => dependency[1].replace(/\/$/, ''));
      }
    }

    entries.push({
      order: Number(match[1]),
      path: topicPath,
      dependencies,
    });
  }

  return entries;
}

function validateNumbering(childNames, parentPath, addDiagnostic) {
  const parsed = childNames.map((name) => {
    const match = name.match(CHILD_TOPIC);
    if (!match) {
      addDiagnostic(
        'INVALID_CHILD_NAME',
        `${parentPath}/${name}`,
        'Nested child directories must use NN-lowercase-hyphen-case.',
      );
      return null;
    }
    return { name, digits: match[1], number: Number(match[1]) };
  }).filter(Boolean);

  if (parsed.some((child) => child.digits.length !== 2)) {
    addDiagnostic(
      'MIXED_CHILD_PADDING',
      parentPath,
      'Child numbers must use exactly two digits.',
      parsed.map((child) => child.name).join(', '),
    );
  }

  const counts = new Map();
  for (const child of parsed) counts.set(child.number, (counts.get(child.number) || 0) + 1);
  const duplicateNumbers = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([number]) => number);
  if (duplicateNumbers.length) {
    addDiagnostic(
      'DUPLICATE_CHILD_NUMBER',
      parentPath,
      'Child numeric prefixes must be unique.',
      duplicateNumbers.join(', '),
    );
  }

  const numbers = parsed.map((child) => child.number).sort((a, b) => a - b);
  const contiguous = numbers.length === childNames.length
    && numbers.every((number, index) => number === index + 1);
  if (!contiguous && childNames.length) {
    addDiagnostic(
      'NON_CONTIGUOUS_CHILDREN',
      parentPath,
      'Child numbers must be contiguous from 01 with no gaps or duplicates.',
      parsed.map((child) => child.name).join(', '),
    );
  }
}

function validateDependencies(entries, designPath, addDiagnostic) {
  if (!entries) return;
  const indices = new Map(entries.map((entry, index) => [entry.path, index]));
  const graph = new Map(entries.map((entry) => [entry.path, []]));

  entries.forEach((entry, index) => {
    for (const dependency of entry.dependencies) {
      if (!indices.has(dependency)) {
        addDiagnostic(
          'UNKNOWN_DEPENDENCY',
          designPath,
          `${entry.path} references an unknown dependency.`,
          dependency,
        );
        continue;
      }
      graph.get(entry.path).push(dependency);
      const dependencyIndex = indices.get(dependency);
      if (dependency === entry.path) {
        addDiagnostic(
          'SELF_DEPENDENCY',
          designPath,
          `${entry.path} depends on itself.`,
        );
      } else if (dependencyIndex > index) {
        addDiagnostic(
          'FORWARD_DEPENDENCY',
          designPath,
          `${entry.path} depends on a later child.`,
          dependency,
        );
      }
    }
  });

  const visiting = new Set();
  const visited = new Set();
  let cycleReported = false;
  function visit(node) {
    if (visiting.has(node)) {
      if (!cycleReported) {
        cycleReported = true;
        addDiagnostic(
          'DEPENDENCY_CYCLE',
          designPath,
          'Child dependencies contain a cycle.',
          [...visiting, node].join(' -> '),
        );
      }
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    for (const dependency of graph.get(node) || []) visit(dependency);
    visiting.delete(node);
    visited.add(node);
  }
  for (const node of graph.keys()) visit(node);
}

function normalizedAlias(value) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+[—-]\s+design\s*$/i, '')
    .replace(/^\d{4}-\d{2}-\d{2}-/, '')
    .replace(/^\d+-/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function firstHeading(content) {
  const match = content?.match(/^#\s+(.+?)\s*$/m);
  return match ? match[1] : null;
}

function leafArtifacts(absoluteRoot, readArtifact) {
  const design = readArtifact(path.join(absoluteRoot, 'design.md'));
  const plan = readArtifact(path.join(absoluteRoot, 'plan.md'));
  const planState = parsePlanState(plan);
  const review = readArtifact(path.join(absoluteRoot, 'review.md'));
  const debugFiles = fs.existsSync(absoluteRoot)
    ? fs.readdirSync(absoluteRoot)
      .filter((file) => /^debug-.+\.md$/.test(file))
      .sort()
    : [];
  const checkboxes = plan ? [...plan.matchAll(/^- \[([ xX])\]/gm)] : [];
  const checkedTasks = planState.checkedTasks
    ?? checkboxes.filter((match) => match[1].toLowerCase() === 'x').length;
  const uncheckedTasks = planState.uncheckedTasks ?? (checkboxes.length - checkedTasks);
  return {
    design,
    plan,
    planState,
    review,
    debugFiles,
    checkedTasks,
    uncheckedTasks,
    checkboxCount: checkedTasks + uncheckedTasks,
  };
}

function deriveLeafStatus(topic, projectRoot, addDiagnostic, readArtifact, unsafePaths) {
  const absoluteRoot = path.join(projectRoot, topic.path);
  const artifacts = leafArtifacts(absoluteRoot, readArtifact);
  const artifactPath = topic.path;

  topic.artifacts = {
    design: artifacts.design !== null,
    plan: artifacts.plan !== null,
    review: artifacts.review !== null,
    debug: artifacts.debugFiles,
    checkedTasks: artifacts.checkedTasks,
    uncheckedTasks: artifacts.uncheckedTasks,
  };

  if ([...unsafePaths].some((candidate) => (
    candidate === artifactPath || candidate.startsWith(`${artifactPath}/`)
  ))) return null;

  if (artifacts.planState.error) {
    addDiagnostic('INVALID_PLAN_STATE', `${artifactPath}/plan.md`, artifacts.planState.error);
    return null;
  }
  if (artifacts.planState.workflow === 'slim') {
    topic.artifacts.verification = artifacts.planState.verification.status;
  }

  if (artifacts.plan !== null && artifacts.design === null) {
    addDiagnostic(
      'PLAN_WITHOUT_DESIGN',
      `${artifactPath}/plan.md`,
      'A plan cannot be interpreted without design.md.',
    );
  }
  if (artifacts.review !== null && artifacts.plan === null) {
    addDiagnostic(
      'REVIEW_WITHOUT_PLAN',
      `${artifactPath}/review.md`,
      'A topic review cannot exist without plan.md.',
    );
  }
  if (artifacts.debugFiles.length && artifacts.design === null) {
    addDiagnostic(
      'DEBUG_WITHOUT_DESIGN',
      `${artifactPath}/${artifacts.debugFiles[0]}`,
      'A topic debug hunt cannot be interpreted without design.md.',
    );
  }
  if (artifacts.plan !== null && artifacts.checkboxCount === 0) {
    addDiagnostic(
      'MALFORMED_PLAN',
      `${artifactPath}/plan.md`,
      'A plan must contain at least one task checkbox.',
    );
  }
  if (artifacts.review !== null && artifacts.uncheckedTasks > 0) {
    addDiagnostic(
      'REVIEW_BEFORE_PLAN_COMPLETE',
      `${artifactPath}/review.md`,
      'Review exists while plan tasks are still unchecked.',
    );
  }

  if (artifacts.debugFiles.length) return 'open debug hunt';
  if (artifacts.design !== null && artifacts.plan === null) return 'designed, needs plan';
  if (artifacts.plan === null || artifacts.checkboxCount === 0 || artifacts.design === null) return null;
  if (artifacts.uncheckedTasks > 0) return 'building';
  if (artifacts.planState.workflow === 'slim') {
    if (artifacts.planState.verification.status === 'pending') return 'awaiting verification';
    if (artifacts.planState.verification.status === 'failed') return 'verification failed';
  }
  if (artifacts.review === null) return 'in review';
  return parseReviewCompletion(artifacts.review).state;
}

function addDuplicateDiagnostics(topics, projectRoot, addDiagnostic, readArtifact) {
  const aliases = new Map();
  for (const topic of topics) {
    const absoluteRoot = path.join(projectRoot, topic.path);
    const values = new Set([normalizedAlias(path.basename(topic.path))]);
    const heading = firstHeading(readArtifact(path.join(absoluteRoot, 'design.md')));
    if (heading) values.add(normalizedAlias(heading));
    for (const alias of values) {
      if (!alias) continue;
      if (!aliases.has(alias)) aliases.set(alias, []);
      aliases.get(alias).push(topic.path);
    }
  }

  const reportedPairs = new Set();
  for (const [alias, paths] of aliases) {
    const uniquePaths = [...new Set(paths)].sort();
    if (uniquePaths.length < 2) continue;
    const first = uniquePaths[0];
    for (const duplicate of uniquePaths.slice(1)) {
      const pair = `${first}\0${duplicate}`;
      if (reportedPairs.has(pair)) continue;
      reportedPairs.add(pair);
      addDiagnostic(
        'DUPLICATE_TOPIC',
        duplicate,
        `Topic identity "${alias}" duplicates existing work.`,
        `${first} <-> ${duplicate}`,
      );
    }
  }
}

function deriveParentStatuses(topics, diagnostics, addDiagnostic) {
  const byPath = new Map(topics.map((topic) => [topic.path, topic]));
  const priority = new Map([
    ['verification failed', 5],
    ['awaiting verification', 4],
    ['open debug hunt', 4],
    ['in review', 3],
    ['building', 2],
    ['legacy-needing-adjudication', 1],
    ['designed, needs plan', 1],
    ['done', 0],
  ]);

  for (const topic of topics.filter((candidate) => candidate.kind === 'nested')) {
    const parentPath = topic.path.slice(0, topic.path.lastIndexOf('/'));
    const unfinished = topic.dependencies
      .map((dependency) => byPath.get(`${parentPath}/${dependency}`))
      .filter((dependency) => !dependency || dependency.status !== 'done');
    const progressStarted = topic.artifacts.checkedTasks > 0
      || topic.artifacts.review
      || topic.artifacts.debug.length > 0;
    if (unfinished.length && progressStarted) {
      const historicalComplete = topic.artifacts.uncheckedTasks === 0
        && topic.artifacts.checkedTasks > 0
        && topic.artifacts.review;
      const onlyLegacyDependencies = unfinished.every((dependency) => (
        dependency?.status === 'legacy-needing-adjudication'
      ));
      if (historicalComplete && onlyLegacyDependencies) {
        addDiagnostic(
          'LEGACY_DEPENDENCY_HISTORY',
          topic.path,
          'Completed historical progress depends on legacy review evidence that needs adjudication.',
          unfinished.map((dependency) => dependency.path).join(', '),
          'warning',
        );
        continue;
      }
      addDiagnostic(
        'DEPENDENCY_PROGRESS_STARTED',
        topic.path,
        'Progress exists while declared dependencies are unfinished.',
        unfinished.map((dependency) => dependency?.path || 'missing dependency').join(', '),
      );
    }
  }

  for (const parent of topics.filter((candidate) => candidate.kind === 'parent')) {
    const structurallyInvalid = diagnostics.some((diagnostic) => (
      PARENT_STRUCTURE_CODES.has(diagnostic.code)
      && (diagnostic.path === parent.path || diagnostic.path.startsWith(`${parent.path}/`))
    ));
    if (structurallyInvalid) {
      parent.status = null;
      continue;
    }
    const children = (parent.children || []).map((child) => byPath.get(child)).filter(Boolean);
    if (!children.length || children.some((child) => !child.status)) {
      parent.status = null;
      continue;
    }
    if (children.every((child) => child.status === 'done')) {
      parent.status = 'done';
      continue;
    }
    const selected = [...children]
      .filter((child) => child.status !== 'done')
      .sort((left, right) => (
        (priority.get(right.status) || 0) - (priority.get(left.status) || 0)
        || left.path.localeCompare(right.path)
      ))[0];
    parent.status = selected.status;
    parent.statusSource = path.basename(selected.path);
  }
}

export function inspectWorkTree(projectRoot) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const realProjectRoot = fs.realpathSync(resolvedProjectRoot);
  const workRoot = path.join(resolvedProjectRoot, 'docs', 'work');
  const diagnostics = [];
  const topics = [];
  const unsafePaths = new Set();
  const artifactCache = new Map();

  function addDiagnostic(code, diagnosticPath, message, evidence, severity = 'error') {
    const normalizedPath = toPosix(diagnosticPath);
    diagnostics.push({
      code,
      severity,
      path: normalizedPath,
      message,
      ...(evidence ? { evidence } : {}),
    });
  }

  const readArtifact = (file) => readBoundedArtifact({
    addDiagnostic,
    cache: artifactCache,
    file,
    projectRoot: resolvedProjectRoot,
    realProjectRoot,
    unsafePaths,
  });
  const childDirectories = (root, rootPath) => normalDirectories({
    addDiagnostic,
    projectRoot: resolvedProjectRoot,
    realProjectRoot,
    root,
    rootPath,
    unsafePaths,
  });

  let workState;
  try {
    workState = normalPathState(resolvedProjectRoot, realProjectRoot, workRoot);
  } catch {
    workState = { exists: true, safe: false };
  }
  if (workState.exists && (!workState.safe || !workState.stat?.isDirectory())) {
    addDiagnostic(
      'UNSAFE_WORK_ROOT',
      'docs/work',
      'docs/work must be a normal non-symlink directory inside the project root.',
    );
    unsafePaths.add('docs/work');
  }

  for (const rootName of workState.exists && workState.safe && workState.stat?.isDirectory()
    ? childDirectories(workRoot, 'docs/work')
    : []) {
    if (rootName === 'debug') continue;
    const absoluteRoot = path.join(workRoot, rootName);
    const rootPath = relativeProjectPath(resolvedProjectRoot, absoluteRoot);
    const datedMatch = rootName.match(DATED_ROOT);

    if (!datedMatch) {
      if (/^\d{4}-/.test(rootName)) {
        addDiagnostic(
          'MALFORMED_DATED_ROOT',
          rootPath,
          'Dated work roots must use YYYY-MM-DD-lowercase-hyphen-case.',
        );
      }
      topics.push({ path: rootPath, kind: 'legacy', dependencies: [] });
      for (const nested of childDirectories(absoluteRoot, rootPath)) {
        addDiagnostic(
          'UNSUPPORTED_NESTING',
          `${rootPath}/${nested}`,
          'Legacy flat topics cannot contain nested topic directories.',
        );
      }
      continue;
    }
    if (!validCalendarDate(datedMatch[1], datedMatch[2], datedMatch[3])) {
      addDiagnostic(
        'MALFORMED_DATED_ROOT',
        rootPath,
        'Dated work roots must contain a real calendar date.',
      );
    }

    const designFile = path.join(absoluteRoot, 'design.md');
    const designPath = `${rootPath}/design.md`;
    const topicEntries = parseTopics(readArtifact(designFile), designPath, addDiagnostic);
    const childNames = childDirectories(absoluteRoot, rootPath);
    const isParent = topicEntries !== null || childNames.length > 0;

    topics.push({
      path: rootPath,
      kind: isParent ? 'parent' : 'direct',
      dependencies: [],
      children: isParent ? childNames.map((name) => `${rootPath}/${name}`) : undefined,
    });

    if (!isParent) continue;
    if (topicEntries === null) {
      addDiagnostic(
        'PARENT_TOPICS_MISSING',
        designPath,
        'A dated root with child directories must declare a ## Topics section.',
      );
    }

    validateNumbering(childNames, rootPath, addDiagnostic);
    validateDependencies(topicEntries, designPath, addDiagnostic);

    const listed = (topicEntries || []).map((entry) => entry.path);
    for (const expected of listed.filter((entry) => !childNames.includes(entry))) {
      addDiagnostic(
        'MISSING_LISTED_CHILD',
        `${rootPath}/${expected}`,
        'The parent design lists a child directory that does not exist.',
      );
    }
    for (const actual of childNames.filter((entry) => !listed.includes(entry))) {
      addDiagnostic(
        'UNLISTED_CHILD',
        `${rootPath}/${actual}`,
        'A child directory exists but is not listed in the parent design.',
      );
    }
    if (topicEntries && JSON.stringify(listed) !== JSON.stringify(childNames)) {
      addDiagnostic(
        'TOPIC_ORDER_MISMATCH',
        rootPath,
        'The ordered ## Topics list and filesystem child order differ.',
        `listed=${listed.join(', ')} actual=${childNames.join(', ')}`,
      );
    }

    for (const childName of childNames) {
      const childRoot = path.join(absoluteRoot, childName);
      const childPath = `${rootPath}/${childName}`;
      const entry = topicEntries?.find((candidate) => candidate.path === childName);
      topics.push({
        path: childPath,
        kind: 'nested',
        dependencies: entry?.dependencies || [],
      });
      for (const nested of childDirectories(childRoot, childPath)) {
        addDiagnostic(
          'UNSUPPORTED_NESTING',
          `${childPath}/${nested}`,
          'Nested work topics cannot contain grandchildren.',
        );
      }
    }
  }

  for (const topic of topics.filter((candidate) => candidate.kind !== 'parent')) {
    topic.status = deriveLeafStatus(
      topic,
      resolvedProjectRoot,
      addDiagnostic,
      readArtifact,
      unsafePaths,
    );
  }
  addDuplicateDiagnostics(topics, resolvedProjectRoot, addDiagnostic, readArtifact);
  deriveParentStatuses(topics, diagnostics, addDiagnostic);

  diagnostics.sort((left, right) => (
    left.path.localeCompare(right.path)
    || left.code.localeCompare(right.code)
    || left.message.localeCompare(right.message)
  ));
  topics.sort((left, right) => left.path.localeCompare(right.path));

  return {
    version: 1,
    projectRoot: resolvedProjectRoot,
    workRoot: relativeProjectPath(resolvedProjectRoot, workRoot),
    diagnostics,
    topics,
  };
}
