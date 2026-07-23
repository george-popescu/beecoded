// spec-state.js -- per-spec STATE.md lifecycle + the global mirror. Per-spec STATE.md is
// authoritative; .bee/STATE.md mirrors the last-touched spec so existing consumers keep working.
const fs = require('fs');
const path = require('path');

const SPEC_SLUG_PATTERN = /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/;

function isValidSpecSlug(slug) {
  return typeof slug === 'string' && SPEC_SLUG_PATTERN.test(slug);
}

function lstatOrNull(file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function assertSafeBeePath(beeDir, candidate) {
  const beeRoot = path.resolve(beeDir);
  const target = path.resolve(candidate);
  const relation = path.relative(beeRoot, target);
  if (relation.startsWith('..') || path.isAbsolute(relation)) {
    throw new Error(`Bee state path escapes ${beeRoot}: ${target}`);
  }

  const parts = relation ? relation.split(path.sep) : [];
  let current = beeRoot;
  for (const part of ['', ...parts]) {
    if (part) current = path.join(current, part);
    const stat = lstatOrNull(current);
    if (stat?.isSymbolicLink()) {
      throw new Error(`Bee state path contains a symbolic link: ${current}`);
    }
  }
  return target;
}

function safeStateExists(beeDir, file) {
  const target = assertSafeBeePath(beeDir, file);
  return lstatOrNull(target) !== null;
}

function readStateFile(beeDir, file) {
  const target = assertSafeBeePath(beeDir, file);
  return fs.readFileSync(target, 'utf8');
}

function writeStateFile(beeDir, file, content) {
  const target = assertSafeBeePath(beeDir, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  assertSafeBeePath(beeDir, target);
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.tmp-${process.pid}-${Date.now()}`,
  );
  try {
    fs.writeFileSync(temporary, content, { flag: 'wx' });
    fs.renameSync(temporary, target);
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch (_) {}
  }
}

function specFilePath(beeDir, slug, filename) {
  if (!isValidSpecSlug(slug)) throw new Error(`invalid spec slug: ${slug}`);
  const specsRoot = path.resolve(beeDir, 'specs');
  const specDirectory = path.resolve(specsRoot, slug);
  const relation = path.relative(specsRoot, specDirectory);
  if (!relation || relation.startsWith('..') || path.isAbsolute(relation)) {
    throw new Error(`spec path escapes ${specsRoot}: ${slug}`);
  }
  return assertSafeBeePath(beeDir, path.join(specDirectory, filename));
}

function specStatePath(beeDir, slug) { return specFilePath(beeDir, slug, 'STATE.md'); }
function globalStatePath(beeDir) {
  return assertSafeBeePath(beeDir, path.resolve(beeDir, 'STATE.md'));
}

function renderSpecState({ name, slug, status }) {
  return [
    '# Bee Project State', '',
    '## Current Spec',
    `- Name: ${name}`,
    `- Path: .bee/specs/${slug}/`,
    `- Status: ${status}`, '',
    '<!-- Valid Status values:',
    '  NO_SPEC       — No active spec; project is idle or between features.',
    '  SPEC_CREATED  — Spec document exists but no phases have been executed yet.',
    '  IN_PROGRESS   — At least one phase has moved past the planned stage.',
    '  COMPLETED     — All phases committed and review-implementation is done.',
    '  ARCHIVED      — Developer ran archive-spec; spec is stored in history.',
    '-->', '',
    '## Phases',
    '| # | Name | Status | Plan | Plan Review | Executed | Reviewed | Tested | Committed |',
    '|---|------|--------|------|-------------|----------|----------|--------|-----------|', '',
    '<!-- Valid Phase Status values:',
    '  PENDING       — Phase exists but planning has not started.',
    '  PLANNED       — Phase has been planned; TASKS.md created with task breakdown and waves.',
    '  PLAN_REVIEWED — Phase plan has been reviewed and approved; ready for execution.',
    '  EXECUTING     — Phase is currently being executed; wave-based task implementation in progress.',
    '  EXECUTED      — All tasks in the phase completed; implementation is done.',
    '  REVIEWING     — Code review is in progress for this phase.',
    '  REVIEWED      — Code review complete; all findings resolved or accepted.',
    '  TESTING       — Manual test scenarios are being verified for this phase.',
    '  TESTED        — All test scenarios passed; phase is ready to commit.',
    '  COMMITTED     — Phase changes have been committed to version control.',
    '-->', '',
    '## Quick Tasks', '',
    '| # | Description | Date | Commit |',
    '|---|-------------|------|--------|', '',
    '## Decisions Log', '',
    '<!-- Structured decision entry format:',
    '  Each entry records an autonomous decision made during ship or plan-all execution.',
    '',
    '  Format:',
    '  - **[WHAT]:** Brief description of the decision made.',
    '  - **Why:** Reasoning behind the choice.',
    '  - **Alternative rejected:** What option was considered but not chosen, and why.',
    '',
    '  Example:',
    '  - **[Review finding auto-fixed]:** Applied null-check fix to UserService.getProfile return value.',
    '  - **Why:** Bug-detector flagged potential null dereference; fix is mechanical and safe.',
    '  - **Alternative rejected:** Deferring to next phase — finding is in current phase scope and trivial to fix now.',
    '-->', '',
    '## Last Action',
    '- Command: /bee-new-spec',
    '- Timestamp:',
    '- Result: spec created', '',
  ].join('\n');
}

function initSpecState(beeDir, slug, { name, status }) {
  const p = specStatePath(beeDir, slug);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (!safeStateExists(beeDir, p)) {
    writeStateFile(beeDir, p, renderSpecState({ name, slug, status: status || 'SPEC_CREATED' }));
  }
  return p;
}

function specMemoryPath(beeDir, slug) { return specFilePath(beeDir, slug, 'memory.md'); }

function renderSpecMemory({ name }) {
  return [
    `# Spec Memory — ${name}`, '',
    '<!-- bee-spec-memory-template',
    'Per-spec memory. Manually curated, like .bee/user.md but scoped to THIS spec.',
    'It is injected into every bee agent at SubagentStart while this is the single active',
    'spec (suppressed when two or more specs are active). Put here what agents should ALWAYS',
    'know while working on this spec: the chosen approach, hard constraints, invariants,',
    'gotchas, "always do X / never do Y here". Keep it short — this is agent guidance, not a',
    'decision log (decisions live in STATE.md). Edit via /bee-memory or directly.',
    '-->', '',
  ].join('\n');
}

function initSpecMemory(beeDir, slug, { name } = {}) {
  const p = specMemoryPath(beeDir, slug);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (!safeStateExists(beeDir, p)) {
    writeStateFile(beeDir, p, renderSpecMemory({ name: name || slug }));
  }
  return p;
}

function mirrorToGlobal(beeDir, slug) {
  const src = specStatePath(beeDir, slug);
  if (!safeStateExists(beeDir, src)) return false;
  writeStateFile(beeDir, globalStatePath(beeDir), readStateFile(beeDir, src));
  return true;
}

function snapshotToPerSpec(beeDir, slug) {
  const g = globalStatePath(beeDir);
  if (!safeStateExists(beeDir, g)) return false;
  const dest = specStatePath(beeDir, slug);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  writeStateFile(beeDir, dest, readStateFile(beeDir, g));
  return true;
}

function seedSpecStateFromGlobal(beeDir, slug) {
  const global = globalStatePath(beeDir);
  if (!safeStateExists(beeDir, global)) return false;
  const destination = specStatePath(beeDir, slug);
  if (safeStateExists(beeDir, destination)) return false;
  writeStateFile(beeDir, destination, readStateFile(beeDir, global));
  return true;
}

const PROJECT_GLOBAL_SECTIONS = ['Quick Tasks'];

// The "## heading" block: from its line up to just before the next "## " or end-of-string.
function getSectionBlock(content, heading) {
  const esc = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|\\n)(## ${esc}[ \\t]*\\n[\\s\\S]*?)(?=\\n## |\\s*$)`);
  const m = content.match(re);
  return m ? m[1] : null;
}

function upsertSectionBlock(content, heading, block) {
  const esc = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|\\n)## ${esc}[ \\t]*\\n[\\s\\S]*?(?=\\n## |\\s*$)`);
  if (re.test(content)) return content.replace(re, (m, p1) => `${p1}${block}`);
  return `${content.replace(/\s*$/, '')}\n\n${block}\n`;
}

// Restore the spec's snapshot into global, but KEEP the live global's project-global sections.
function restoreToGlobal(beeDir, slug) {
  const src = specStatePath(beeDir, slug);
  if (!safeStateExists(beeDir, src)) return false;
  let merged = readStateFile(beeDir, src);
  const g = globalStatePath(beeDir);
  if (safeStateExists(beeDir, g)) {
    const cur = readStateFile(beeDir, g);
    for (const h of PROJECT_GLOBAL_SECTIONS) {
      const block = getSectionBlock(cur, h);
      if (block) merged = upsertSectionBlock(merged, h, block);
    }
  }
  writeStateFile(beeDir, g, merged);
  return true;
}

module.exports = { isValidSpecSlug, assertSafeBeePath, specStatePath, globalStatePath, renderSpecState, initSpecState, mirrorToGlobal, snapshotToPerSpec, seedSpecStateFromGlobal, restoreToGlobal, PROJECT_GLOBAL_SECTIONS, getSectionBlock, upsertSectionBlock, specMemoryPath, renderSpecMemory, initSpecMemory };
