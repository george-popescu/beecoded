#!/usr/bin/env node
// Nectar consistency check — guards the invariants that keep the plugin coherent:
// 1. Shared discipline blocks are byte-identical everywhere they appear
//    (finding classes, finding format, severity scale, verdict definitions).
// 2. Exactly ten internal Nectar sources use product-prefixed directory and
//    frontmatter names, with triggers ("Use when") and boundaries ("Not for").
// 3. The README skill table matches the skills that exist on disk.
// 4. Agents referenced by skills exist as files; agent frontmatter is sane.
// 5. plugin.json, marketplace.json, and CHANGELOG.md agree on the version.
//
// Zero dependencies. Exit 0 = all pass, exit 1 = failures printed.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let failures = 0;
const pass = (msg) => console.log(`  PASS  ${msg}`);
const fail = (msg) => { failures++; console.log(`  FAIL  ${msg}`); };

// --- helpers ---------------------------------------------------------------

function extractSection(content, heading) {
  // Returns the body of a "## heading" section up to the next "## " or EOF.
  const re = new RegExp(`^## ${heading}\\s*$`, 'm');
  const m = content.match(re);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = content.slice(start);
  const next = rest.search(/^## /m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

function extractFencedBlock(sectionBody) {
  const m = sectionBody && sectionBody.match(/```(?:markdown)?\n([\s\S]*?)```/);
  return m ? m[1].trim() : null;
}

function extractBullets(sectionBody, prefixes) {
  if (!sectionBody) return null;
  return sectionBody
    .split('\n')
    .filter((l) => prefixes.some((p) => l.trim().startsWith(p)))
    .map((l) => l.trim())
    .join('\n');
}

function frontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : null;
}

function fmField(fm, field) {
  const m = fm && fm.match(new RegExp(`^${field}:\\s*(.*)$`, 'm'));
  return m ? m[1].trim() : null;
}

// --- load files ------------------------------------------------------------

const skillDirs = fs
  .readdirSync(path.join(ROOT, 'internal-skills'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const skills = Object.fromEntries(
  skillDirs.map((directory) => [
    directory.replace(/^nectar-/, ''),
    read(`internal-skills/${directory}/SKILL.md`),
  ])
);
const agents = {
  'context-builder': read('agents/context-builder.md'),
  implementer: read('agents/implementer.md'),
  lens: read('agents/lens.md'),
  validator: read('agents/validator.md'),
};

console.log('nectar consistency check\n');

// --- 1. shared blocks stay identical ----------------------------------------

console.log('shared blocks:');

const findingClassPrefixes = [
  '- CODE_DEFECT — ',
  '- TEST_OR_COVERAGE_GAP — ',
  '- TEST_DEFECT — ',
  '- DOCUMENTATION_GAP — ',
  '- MAINTAINABILITY — ',
  '- STYLISTIC — ',
  '- HARDENING_IDEA — ',
];
const findingClassCopies = {
  'review SKILL': extractBullets(extractSection(skills.review, 'Finding classes'), findingClassPrefixes),
  'audit SKILL': extractBullets(extractSection(skills.audit, 'Finding classes'), findingClassPrefixes),
  'lens agent': extractBullets(extractSection(agents.lens, 'Finding classes'), findingClassPrefixes),
  'validator agent': extractBullets(extractSection(agents.validator, 'Finding classes'), findingClassPrefixes),
};
compareCopies('finding classes', findingClassCopies);

const findingFormatCopies = {
  'review SKILL': extractFencedBlock(extractSection(skills.review, 'Finding format')),
  'audit SKILL': extractFencedBlock(extractSection(skills.audit, 'Finding format')),
  'lens agent': extractFencedBlock(extractSection(agents.lens, 'Finding format')),
};
compareCopies('finding format', findingFormatCopies);

const severityCopies = {
  'review SKILL': extractBullets(extractSection(skills.review, 'Severity scale'), ['- CRITICAL', '- HIGH', '- MEDIUM', '- LOW']),
  'audit SKILL': extractBullets(extractSection(skills.audit, 'Severity scale'), ['- CRITICAL', '- HIGH', '- MEDIUM', '- LOW']),
  'lens agent': extractBullets(extractSection(agents.lens, 'Severity scale'), ['- CRITICAL', '- HIGH', '- MEDIUM', '- LOW']),
  'validator agent': extractBullets(extractSection(agents.validator, 'Severity scale'), ['- CRITICAL', '- HIGH', '- MEDIUM', '- LOW']),
};
compareCopies('severity scale', severityCopies);

// Definition lines only: "- VERDICT — <definition>". Prose lines that merely
// start with a verdict name (e.g. "- STYLISTIC findings are presented...") don't count.
const verdictPrefixes = ['- CONFIRMED — ', '- REFUTED — '];
const verdictCopies = {
  'review SKILL': extractBullets(skills.review, verdictPrefixes),
  'audit SKILL': extractBullets(skills.audit, verdictPrefixes),
  'validator agent': extractBullets(extractSection(agents.validator, 'Verdicts'), verdictPrefixes),
};
compareCopies('verdict definitions', verdictCopies);

const convergenceContracts = [
  ['review blocks only credible medium+ code defects', skills.review.includes('Only `CONFIRMED` `CODE_DEFECT` findings at `MEDIUM`, `HIGH`, or `CRITICAL` are `BLOCKING`')],
  ['review is a single read-only pass', /single[^\n]*read-only[^\n]*classification pass/i.test(skills.review)],
  ['honey defaults to three full review passes', skills.honey.includes('default maximum is three full review passes')],
  ['honey accepts any positive integer review maximum', /explicit[^\n]*positive integer[^\n]*review-pass maximum/i.test(skills.honey)],
  ['honey has no minimum-three override restriction', !/N\s*>?=\s*3|below three[^\n]*default/i.test(skills.honey)],
  ['review keeps non-code findings non-blocking', skills.review.includes('every non-code class is also `NON_BLOCKING`')],
  ['validator can reclassify findings', agents.validator.includes('Reclassification is a successful validation outcome')],
  ['plan uses plan-specific classes', skills.plan.includes('PLAN_CORRECTNESS_DEFECT') && skills.plan.includes('PLAN_STYLE')],
];
for (const [label, condition] of convergenceContracts) {
  if (condition) pass(label);
  else fail(label);
}

function compareCopies(label, copies) {
  const entries = Object.entries(copies);
  const missing = entries.filter(([, v]) => !v);
  if (missing.length) {
    fail(`${label}: missing in ${missing.map(([k]) => k).join(', ')}`);
    return;
  }
  const [refName, refVal] = entries[0];
  const diverged = entries.filter(([, v]) => v !== refVal);
  if (diverged.length) {
    fail(`${label}: diverged from ${refName} in ${diverged.map(([k]) => k).join(', ')}`);
  } else {
    pass(`${label}: identical across ${entries.map(([k]) => k).join(', ')}`);
  }
}

// --- 2. skill frontmatter ----------------------------------------------------

console.log('\nskill frontmatter:');

const expectedSkillDirs = [
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
];
if (JSON.stringify(skillDirs) !== JSON.stringify(expectedSkillDirs)) {
  fail(`internal skill roster must be exactly: ${expectedSkillDirs.join(', ')}`);
} else {
  pass('internal skill roster contains exactly ten nectar-* sources');
}

for (const directory of skillDirs) {
  const name = directory.replace(/^nectar-/, '');
  const content = skills[name];
  const fm = frontmatter(content);
  const fmName = fmField(fm, 'name');
  const desc = fmField(fm, 'description') || '';
  if (fmName !== directory) fail(`${directory}: frontmatter name "${fmName}" != directory name`);
  else if (!/^Use (when|for|after)/.test(desc)) fail(`${directory}: description must open with its trigger ("Use when/for/after ...")`);
  else if (!desc.includes('Not for')) fail(`${directory}: description must state a "Not for" boundary`);
  else pass(`${directory}: name, triggers, and boundary present`);
}

// --- 3. README table matches disk ---------------------------------------------

console.log('\nreadme:');

const readme = read('README.md');
// Skill rows are "| name |" with a bare lowercase word; the agents table uses
// backticked `nectar:*` names, so it never matches this pattern.
const tableSkills = [...readme.matchAll(/^\| (\w[\w-]*) \|/gm)]
  .map((m) => m[1])
  .filter((s) => s !== 'Skill' && s !== 'Agent');
const missingRows = skillDirs.filter((s) => !tableSkills.includes(s));
const extraRows = tableSkills.filter((s) => !skillDirs.includes(s));
if (missingRows.length) fail(`README table missing skills: ${missingRows.join(', ')}`);
else if (extraRows.length) fail(`README table lists skills that do not exist on disk: ${extraRows.join(', ')}`);
else pass(`README table matches skills on disk (${skillDirs.length} skills)`);

// --- 4. work hierarchy contracts ----------------------------------------------

console.log('\nwork hierarchy:');

const hierarchyContracts = [
  ['shape creates dated feature roots', skills.shape.includes('docs/work/YYYY-MM-DD-<feature-slug>/')],
  ['shape detects duplicate dated and legacy topics', skills.shape.includes('Duplicate check') && skills.shape.includes('legacy flat')],
  ['shape hands duplicate work to orient', skills.shape.includes('hand off to the orient skill')],
  ['plan decomposes before writing', skills.plan.includes('Complete decomposition first')],
  ['plan gates split writes on explicit approval', skills.plan.includes('Do not create') && skills.plan.includes('silence is not approval')],
  ['plan proposes ordered child paths', skills.plan.includes('NN-<topic-slug>') && skills.plan.includes('estimated tasks')],
  ['plan records exact dependency paths', skills.plan.includes('depends on: none') && skills.plan.includes('exact earlier child paths')],
  ['plan enforces contiguous numbering', skills.plan.includes('contiguous') && skills.plan.includes('01')],
  ['plan rejects invalid dependencies', skills.plan.includes('unknown, forward, or circular')],
  ['plan defines multiple dependency syntax', skills.plan.includes('comma-separated list of individually backticked exact earlier child paths')],
  ['plan asks before migrating oversized legacy work', skills.plan.includes('Migrate to a dated parent (recommended)') && skills.plan.includes('Keep one oversized legacy plan')],
  ['orient scans nested work recursively', skills.orient.includes('exactly two levels')],
  ['orient validates parent topic paths and numbering', skills.orient.includes('mixed padding') && skills.orient.includes('order mismatch')],
  ['orient derives aggregate parent status', skills.orient.includes('Aggregate parent status')],
  ['orient blocks children with unfinished dependencies', skills.orient.includes('declared dependencies are done')],
  ['orient preserves legacy flat topics', skills.orient.includes('legacy flat')],
  ['build resolves the active leaf path', skills.build.includes('resolved leaf topic directory')],
  ['build checks child dependencies', skills.build.includes('dependency-ready')],
  ['review writes into the resolved leaf path', skills.review.includes('resolved leaf topic directory')],
  ['debug persists beside the resolved leaf', skills.debug.includes('resolved leaf topic directory')],
  ['honey executes children by dependency readiness', skills.honey.includes('dependency-ready child')],
  ['honey closes only after every child is clean', skills.honey.includes('every child') && skills.honey.includes('clean pass')],
  ['README documents dated nested hierarchy', readme.includes('YYYY-MM-DD-<feature-slug>') && readme.includes('NN-<topic-slug>')],
  ['README documents split approval and legacy support', readme.includes('Approve split') && readme.includes('legacy flat')],
];

for (const [label, condition] of hierarchyContracts) {
  if (condition) pass(label);
  else fail(label);
}

// --- 5. agent references + frontmatter ----------------------------------------

console.log('\nagents:');

const referenced = new Set();
const agentReferencePattern = new RegExp('nectar:([\\w-]+)', 'g');
for (const content of Object.values(skills)) {
  for (const m of content.matchAll(agentReferencePattern)) referenced.add(m[1]);
}
for (const ref of referenced) {
  if (!agents[ref]) fail(`skills reference nectar:${ref} but agents/${ref}.md does not exist`);
  else pass(`nectar:${ref} referenced by skills and exists on disk`);
}
for (const [name, content] of Object.entries(agents)) {
  const fm = frontmatter(content);
  const tools = fmField(fm, 'tools') || '';
  if (fmField(fm, 'name') !== name) fail(`agent ${name}: frontmatter name mismatch`);
  if ((name === 'lens' || name === 'validator') && /\b(Write|Edit|Bash)\b/.test(tools)) {
    fail(`agent ${name}: must be read-only but declares tools: ${tools}`);
  } else {
    pass(`agent ${name}: frontmatter and tool restrictions sane`);
  }
}

// --- 6. version agreement ------------------------------------------------------

console.log('\nversion:');

const claudeManifest = JSON.parse(read('.claude-plugin/plugin.json'));
const codexManifest = JSON.parse(read('.codex-plugin/plugin.json'));
const pluginVersion = claudeManifest.version;
const codexVersion = codexManifest.version;
const packageJson = JSON.parse(read('package.json'));
const changelog = read('CHANGELOG.md');
if (packageJson.version !== pluginVersion) {
  fail(`package.json version ${packageJson.version} != Claude plugin version ${pluginVersion}`);
} else if (codexVersion !== pluginVersion) {
  fail(`Codex plugin version ${codexVersion} != Claude plugin version ${pluginVersion}`);
} else if (!changelog.includes(`## ${pluginVersion} `) && !changelog.includes(`## ${pluginVersion}\n`)) {
  fail(`plugin.json version ${pluginVersion} has no CHANGELOG heading`);
} else {
  pass(`npm, Claude, Codex, and CHANGELOG agree on ${pluginVersion}`);
}
if (Object.hasOwn(claudeManifest, 'skills') || Object.hasOwn(codexManifest, 'skills')) {
  fail('plugin manifests must not auto-register internal Nectar skill sources');
} else {
  pass('plugin manifests leave standalone Nectar skills to the npm installer');
}
const marketplacePath = path.join(ROOT, '..', '..', '.claude-plugin', 'marketplace.json');
if (fs.existsSync(marketplacePath)) {
  const marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'));
  const entry = (marketplace.plugins || []).find((p) => p.name === 'nectar');
  if (!entry) fail('marketplace.json has no nectar entry');
  else if (entry.version !== pluginVersion) fail(`marketplace.json nectar version ${entry.version} != plugin.json ${pluginVersion}`);
  else pass(`marketplace.json agrees on ${pluginVersion}`);
}

const reliabilityFiles = [
  'evals/contracts/split-approval.json',
  'evals/contracts/contiguous-numbering.json',
  'evals/contracts/dependency-readiness.json',
  'evals/contracts/duplicate-detection.json',
  'evals/contracts/artifact-recovery.json',
  'evals/contracts/plan-risk-classification.json',
  'evals/contracts/review-risk-classification.json',
  'scripts/run-behavioral-evals.mjs',
  'scripts/run-doctor.mjs',
];
const missingReliabilityFiles = reliabilityFiles.filter(
  (file) => !fs.existsSync(path.join(ROOT, file)),
);
if (missingReliabilityFiles.length) {
  fail(`reliability payload missing: ${missingReliabilityFiles.join(', ')}`);
} else if (!packageJson.files.includes('evals/') || !packageJson.files.includes('scripts/')) {
  fail('package files allowlist must ship evals/ and scripts/');
} else if (!packageJson.files.includes('internal-skills/') || packageJson.files.includes('skills/')) {
  fail('package files allowlist must ship internal-skills/ without a plugin skills/ directory');
} else {
  pass('behavioral contracts and doctor runners are present and allowlisted');
}

const forbiddenInvocationTokens = [`/${'nectar'}:`, `$${'nectar'}:`];
const legacyInvocations = [];
function scanCurrentSources(target) {
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      const absolute = path.join(target, entry.name);
      scanCurrentSources(absolute);
    }
    return;
  }
  if (stat.isFile()) {
    const content = fs.readFileSync(target, 'utf8');
    for (const token of forbiddenInvocationTokens) {
      if (content.includes(token)) {
        legacyInvocations.push(`${path.relative(ROOT, target)} contains ${token}`);
      }
    }
  }
}
for (const relative of [
  '.claude-plugin',
  '.codex-plugin',
  'internal-skills',
  'evals/contracts',
  'scripts/evals',
  'scripts/check-consistency.js',
  'package.json',
]) {
  const absolute = path.join(ROOT, relative);
  if (fs.existsSync(absolute)) {
    scanCurrentSources(absolute);
  }
}
if (legacyInvocations.length) {
  fail(`active legacy Nectar invocations remain: ${legacyInvocations.join(', ')}`);
} else {
  pass('current sources contain no legacy public Nectar invocation syntax');
}

// --- result ---------------------------------------------------------------------

console.log(failures ? `\n${failures} failure(s)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
