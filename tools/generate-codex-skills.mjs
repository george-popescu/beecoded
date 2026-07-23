#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const commandsDir = path.join(repoRoot, 'plugins', 'bee', 'workflows');
const beeRoot = path.join(repoRoot, 'plugins', 'bee');
const skillsDir = path.join(beeRoot, 'internal-skills');
const legacySkillsDir = path.join(beeRoot, 'skills');
const checkOnly = process.argv.includes('--check');

function commandDescription(content, name) {
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
  const description = frontmatter?.[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
  return description || `Run Bee's ${name} workflow`;
}

function title(name) {
  return name.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
}

function wrapper(name, description) {
  const publicName = `bee-${name}`;
  const trigger = `Use when the user explicitly invokes /${publicName} on Claude Code or $${publicName} on Codex, or asks for this Bee workflow: ${description}`;
  return `---\nname: ${publicName}\ndescription: ${JSON.stringify(trigger)}\n---\n\n# Bee ${title(name)}\n\nRead both files completely before acting:\n\n1. [Host adapter](../../codex/host-adapter.md)\n2. [Canonical workflow](../../workflows/${name}.md)\n\nExecute the canonical workflow using the current-host rules in the adapter. Preserve its guards, artifact formats, review gates, and stop conditions. Invoke it as \`/${publicName}\` on Claude Code or \`$${publicName}\` on Codex.\n`;
}

function filesBelow(root) {
  if (!fs.existsSync(root)) return [];
  if (!fs.statSync(root).isDirectory()) return [root];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    return entry.isDirectory() ? filesBelow(absolute) : [absolute];
  });
}

function legacyInvocationFiles() {
  const activeRoots = [
    commandsDir,
    path.join(beeRoot, 'agents'),
    path.join(beeRoot, 'claude-skills'),
    path.join(beeRoot, 'codex'),
    skillsDir,
    path.join(beeRoot, 'scripts'),
    path.join(beeRoot, 'hooks'),
    path.join(beeRoot, 'README.md'),
    path.join(repoRoot, 'README.md'),
  ];
  const legacy = /(?:\/|\$)bee:/;
  return activeRoots.flatMap(filesBelow)
    .filter((file) => /\.(?:md|json|js|mjs|cjs|sh|ya?ml)$/i.test(file))
    .filter((file) => legacy.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(repoRoot, file));
}

const commandNames = fs.readdirSync(commandsDir)
  .filter((file) => file.endsWith('.md'))
  .map((file) => file.slice(0, -3))
  .sort();

const failures = [];
failures.push(...legacyInvocationFiles().map((file) => `${file} (legacy Bee invocation)`));
if (!checkOnly && failures.length) {
  console.error(`Cannot generate Bee skills while legacy invocations remain:\n${failures.map((file) => `- ${file}`).join('\n')}`);
  process.exit(1);
}
for (const name of commandNames) {
  const command = fs.readFileSync(path.join(commandsDir, `${name}.md`), 'utf8');
  const expected = wrapper(name, commandDescription(command, name));
  const destination = path.join(skillsDir, `bee-${name}`, 'SKILL.md');

  if (checkOnly) {
    if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== expected) {
      failures.push(path.relative(repoRoot, destination));
    }
    continue;
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, expected);
}

if (checkOnly) {
  if (fs.existsSync(legacySkillsDir)) failures.push('plugins/bee/skills (legacy auto-discovered entry layer)');
  const generatedDirs = fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    : [];
  const expectedDirs = commandNames.map((name) => `bee-${name}`);
  const unexpected = generatedDirs.filter((name) => !expectedDirs.includes(name));
  failures.push(...unexpected.map((name) => `plugins/bee/internal-skills/${name}`));
  if (failures.length) {
    console.error(`Generated Bee skills are stale:\n${failures.map((file) => `- ${file}`).join('\n')}`);
    console.error('Run: npm run generate:codex');
    process.exit(1);
  }
  console.log(`Prefixed Bee skill wrappers are in sync (${commandNames.length} workflows).`);
} else {
  fs.rmSync(legacySkillsDir, { recursive: true, force: true });
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (entry.isDirectory() && !commandNames.includes(entry.name.slice('bee-'.length))) {
      fs.rmSync(path.join(skillsDir, entry.name), { recursive: true, force: true });
    }
  }
  console.log(`Generated ${commandNames.length} prefixed Bee skill wrappers.`);
}
