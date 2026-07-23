import fs from 'node:fs';
import path from 'node:path';

const DATED_ROOT = /^(\d{4})-(\d{2})-(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const CHILD_TOPIC = /^(\d+)-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const PARENT_STRUCTURE_CODES = new Set([
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
  'UNSUPPORTED_NESTING',
]);

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function relativeProjectPath(projectRoot, absolute) {
  return toPosix(path.relative(projectRoot, absolute));
}

function directories(root) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function readIfPresent(file) {
  return fs.existsSync(file) && fs.statSync(file).isFile()
    ? fs.readFileSync(file, 'utf8')
    : null;
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

function leafArtifacts(absoluteRoot) {
  const design = readIfPresent(path.join(absoluteRoot, 'design.md'));
  const plan = readIfPresent(path.join(absoluteRoot, 'plan.md'));
  const review = readIfPresent(path.join(absoluteRoot, 'review.md'));
  const debugFiles = fs.existsSync(absoluteRoot)
    ? fs.readdirSync(absoluteRoot)
      .filter((file) => /^debug-.+\.md$/.test(file))
      .sort()
    : [];
  const checkboxes = plan ? [...plan.matchAll(/^- \[([ xX])\]/gm)] : [];
  const checkedTasks = checkboxes.filter((match) => match[1].toLowerCase() === 'x').length;
  const uncheckedTasks = checkboxes.length - checkedTasks;
  return {
    design,
    plan,
    review,
    debugFiles,
    checkedTasks,
    uncheckedTasks,
    checkboxCount: checkboxes.length,
  };
}

function deriveLeafStatus(topic, projectRoot, addDiagnostic) {
  const absoluteRoot = path.join(projectRoot, topic.path);
  const artifacts = leafArtifacts(absoluteRoot);
  const artifactPath = topic.path;

  topic.artifacts = {
    design: artifacts.design !== null,
    plan: artifacts.plan !== null,
    review: artifacts.review !== null,
    debug: artifacts.debugFiles,
    checkedTasks: artifacts.checkedTasks,
    uncheckedTasks: artifacts.uncheckedTasks,
  };

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
  const blockerCounts = artifacts.review === null
    ? []
    : [...artifacts.review.matchAll(/^Blocking:\s*(\d+)\s*$/gim)]
      .map((match) => Number.parseInt(match[1], 10));
  const cleanCount = blockerCounts.length
    ? blockerCounts.at(-1) === 0
    : artifacts.review !== null
      && (/(zero blocking code defects remain)/i.test(artifacts.review)
        || /\b(?:no|zero)\s+confirmed findings remain\b/i.test(artifacts.review));
  const cleanReview = artifacts.review !== null
    && (/^## Clean pass\s*$/im.test(artifacts.review) || /clean pass confirmation/i.test(artifacts.review))
    && cleanCount;
  if (cleanReview) return 'done';
  return 'in review';
}

function addDuplicateDiagnostics(topics, projectRoot, addDiagnostic) {
  const aliases = new Map();
  for (const topic of topics) {
    const absoluteRoot = path.join(projectRoot, topic.path);
    const values = new Set([normalizedAlias(path.basename(topic.path))]);
    const heading = firstHeading(readIfPresent(path.join(absoluteRoot, 'design.md')));
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
    ['open debug hunt', 4],
    ['in review', 3],
    ['building', 2],
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
  const workRoot = path.join(resolvedProjectRoot, 'docs', 'work');
  const diagnostics = [];
  const topics = [];

  function addDiagnostic(code, diagnosticPath, message, evidence) {
    diagnostics.push({
      code,
      severity: 'error',
      path: toPosix(diagnosticPath),
      message,
      ...(evidence ? { evidence } : {}),
    });
  }

  for (const rootName of directories(workRoot)) {
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
      for (const nested of directories(absoluteRoot)) {
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
    const topicEntries = parseTopics(readIfPresent(designFile), designPath, addDiagnostic);
    const childNames = directories(absoluteRoot);
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
      for (const nested of directories(childRoot)) {
        addDiagnostic(
          'UNSUPPORTED_NESTING',
          `${childPath}/${nested}`,
          'Nested work topics cannot contain grandchildren.',
        );
      }
    }
  }

  for (const topic of topics.filter((candidate) => candidate.kind !== 'parent')) {
    topic.status = deriveLeafStatus(topic, resolvedProjectRoot, addDiagnostic);
  }
  addDuplicateDiagnostics(topics, resolvedProjectRoot, addDiagnostic);
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
