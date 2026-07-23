import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const beeRoot = path.join(repoRoot, 'plugins', 'bee');
const workflowsDir = path.join(beeRoot, 'workflows');
const internalSkillsDir = path.join(beeRoot, 'internal-skills');

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(beeRoot, relative), 'utf8'));
}

function filesBelow(root) {
  if (!fs.existsSync(root)) return [];
  if (!fs.statSync(root).isDirectory()) return [root];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    return entry.isDirectory() ? filesBelow(absolute) : [absolute];
  });
}

const workflowNames = fs.readdirSync(workflowsDir)
  .filter((file) => file.endsWith('.md'))
  .map((file) => file.slice(0, -3))
  .sort();

test('generated Bee roster has exactly one prefixed entry per canonical workflow', () => {
  assert.equal(fs.existsSync(path.join(beeRoot, 'skills')), false,
    'plugin-root skills/ would be auto-discovered as namespaced commands');
  assert.equal(fs.existsSync(internalSkillsDir), true);

  const entries = fs.readdirSync(internalSkillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(entries, workflowNames.map((name) => `bee-${name}`));

  for (const workflow of workflowNames) {
    const publicName = `bee-${workflow}`;
    const skillPath = path.join(internalSkillsDir, publicName, 'SKILL.md');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, new RegExp(`^name: ${publicName}$`, 'm'), skillPath);
    assert.match(content, new RegExp(`workflows/${workflow}\\.md`), skillPath);
    assert.ok(content.includes(`/${publicName}`), `${skillPath} must document its Claude invocation`);
    assert.ok(content.includes(`$${publicName}`), `${skillPath} must document its Codex invocation`);
  }
});

test('plugin manifests register only hidden Claude knowledge skills', () => {
  assert.equal(readJson('.claude-plugin/plugin.json').skills, './claude-skills/');
  assert.equal(Object.hasOwn(readJson('.codex-plugin/plugin.json'), 'skills'), false);
  for (const skill of filesBelow(path.join(beeRoot, 'claude-skills'))
    .filter((file) => path.basename(file) === 'SKILL.md')) {
    assert.match(fs.readFileSync(skill, 'utf8'), /^user-invocable:\s*false$/m, skill);
  }
});

test('package ships internal skill sources instead of plugin-discovered skills', () => {
  const pkg = readJson('package.json');
  assert.ok(pkg.files.includes('internal-skills/'));
  assert.equal(pkg.files.includes('skills/'), false);
});

test('Bee README documents the complete public command roster', () => {
  const readme = fs.readFileSync(path.join(beeRoot, 'README.md'), 'utf8');
  const documented = [...readme.matchAll(/^\| `\/(bee-[a-z0-9-]+)` \|/gm)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(documented, workflowNames.map((name) => `bee-${name}`));
});

test('active Bee instructions contain no legacy colon invocation', () => {
  const activeRoots = [
    workflowsDir,
    path.join(beeRoot, 'agents'),
    path.join(beeRoot, 'claude-skills'),
    internalSkillsDir,
    path.join(beeRoot, 'codex'),
    path.join(beeRoot, 'scripts'),
    path.join(beeRoot, 'hooks'),
    path.join(beeRoot, 'README.md'),
    path.join(repoRoot, 'README.md'),
  ];
  const legacy = new RegExp(`(?:/|\\$)bee${':'}`);
  const offenders = activeRoots.flatMap(filesBelow)
    .filter((file) => /\.(?:md|json|js|mjs|cjs|sh|ya?ml)$/i.test(file))
    .filter((file) => legacy.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(repoRoot, file));
  assert.deepEqual(offenders, []);
});

test('active Bee workflows contain no retired command IDs or invented prefixed commands', () => {
  const workflowPattern = workflowNames
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const retiredBareCommand = new RegExp(`\\bbee:(?:${workflowPattern})(?!-)\\b`);
  const forbidden = [
    retiredBareCommand,
    new RegExp(`bee${':'}\\{command\\}`),
    /\/bee-new(?!-spec)/,
    /\/bee-execute-phase-style\b/,
  ];
  const roots = [
    workflowsDir,
    path.join(beeRoot, 'agents'),
    path.join(beeRoot, 'claude-skills'),
    internalSkillsDir,
    path.join(beeRoot, 'codex'),
    path.join(beeRoot, 'scripts'),
    path.join(beeRoot, 'hooks'),
    path.join(beeRoot, 'README.md'),
    path.join(repoRoot, 'README.md'),
  ];
  const offenders = roots.flatMap(filesBelow)
    .filter((file) => forbidden.some((pattern) => pattern.test(fs.readFileSync(file, 'utf8'))))
    .map((file) => path.relative(repoRoot, file))
    .sort();

  assert.deepEqual(offenders, []);
});
