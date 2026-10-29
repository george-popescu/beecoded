#!/usr/bin/env node
// Nectar package metadata consistency. Instructional meaning is reviewed and
// evaluated semantically; parser/runtime tests own persisted-state contracts.
// Zero dependencies. Exit 0 = all pass, exit 1 = failures printed.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let failures = 0;
const pass = (msg) => console.log(`  PASS  ${msg}`);
const fail = (msg) => { failures++; console.log(`  FAIL  ${msg}`); };

// --- helpers ---------------------------------------------------------------

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
  investigator: read('agents/investigator.md'),
  lens: read('agents/lens.md'),
  validator: read('agents/validator.md'),
};
console.log('nectar consistency check\n');

// --- skill frontmatter ----------------------------------------------------

console.log('\nskill frontmatter:');

const expectedSkillDirs = [
  'nectar-audit',
  'nectar-build',
  'nectar-burciu-inspection',
  'nectar-capture',
  'nectar-close',
  'nectar-context',
  'nectar-debug',
  'nectar-honey',
  'nectar-orient',
  'nectar-plan',
  'nectar-polish',
  'nectar-rehearse',
  'nectar-release',
  'nectar-review',
  'nectar-security',
  'nectar-shape',
  'nectar-test-review',
];
if (JSON.stringify(skillDirs) !== JSON.stringify(expectedSkillDirs)) {
  fail(`internal skill roster must be exactly: ${expectedSkillDirs.join(', ')}`);
} else {
  pass(`internal skill roster contains ${expectedSkillDirs.length} nectar-* sources`);
}

for (const directory of skillDirs) {
  const name = directory.replace(/^nectar-/, '');
  const content = skills[name];
  const fm = frontmatter(content);
  const fmName = fmField(fm, 'name');
  if (fmName !== directory) fail(`${directory}: frontmatter name "${fmName}" != directory name`);
  else pass(`${directory}: frontmatter name matches its directory`);
}

// --- 3. agent references + frontmatter ----------------------------------------

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
  if ((name === 'investigator' || name === 'lens' || name === 'validator') && /\b(Write|Edit|Bash)\b/.test(tools)) {
    fail(`agent ${name}: must be read-only but declares tools: ${tools}`);
  } else {
    pass(`agent ${name}: frontmatter and tool restrictions sane`);
  }
}

// --- 4. version agreement ------------------------------------------------------

console.log('\nversion:');

const claudeManifest = JSON.parse(read('.claude-plugin/plugin.json'));
const codexManifest = JSON.parse(read('.codex-plugin/plugin.json'));
const pluginVersion = claudeManifest.version;
const codexVersion = codexManifest.version;
const packageJson = JSON.parse(read('package.json'));
if (packageJson.version !== pluginVersion) {
  fail(`package.json version ${packageJson.version} != Claude plugin version ${pluginVersion}`);
} else if (codexVersion !== pluginVersion) {
  fail(`Codex plugin version ${codexVersion} != Claude plugin version ${pluginVersion}`);
} else {
  pass(`npm, Claude, and Codex agree on ${pluginVersion}`);
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

// --- result ---------------------------------------------------------------------

console.log(failures ? `\n${failures} failure(s)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
