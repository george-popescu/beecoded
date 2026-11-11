#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function inspectGuide(root = packageRoot) {
  const skillsRoot = path.join(root, 'internal-skills');
  const skills = fs.readdirSync(skillsRoot, { withFileTypes: true }).filter(entry => entry.isDirectory() && /^nectar-[a-z0-9-]+$/.test(entry.name))
    .map(entry => {
      const file = path.join(skillsRoot, entry.name, 'SKILL.md');
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024) throw new Error(`Invalid packaged skill: ${entry.name}`);
      const content = fs.readFileSync(file, 'utf8');
      const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
      const name = frontmatter?.match(/^name:\s*(nectar-[a-z0-9-]+)\s*$/m)?.[1];
      const description = frontmatter?.match(/^description:[ \t]*(.+)$/m)?.[1]?.trim();
      if (name !== entry.name || !description || /^[>|]/.test(description)) throw new Error(`Unsupported packaged skill metadata: ${entry.name}`);
      return { name, description, invocation: { codex: `$${name}`, claude: `/${name}` } };
    }).sort((a, b) => a.name.localeCompare(b.name));
  return { version: 1, skills, installation: 'Managed standalone skills; confirm discovery in the selected host.',
    routes: [
      { purpose: 'Discuss or plan', skills: ['nectar-shape', 'nectar-plan'], effect: 'Read-only planning; no implementation authority implied.' },
      { purpose: 'Implement or deliver', skills: ['nectar-build', 'nectar-honey'], effect: 'Only the authorized outcome; publishing remains separate.' },
      { purpose: 'Inspect quality', skills: ['nectar-review', 'nectar-audit', 'nectar-burciu-inspection', 'nectar-test-review', 'nectar-security'], effect: 'Review does not authorize repairs; Audit may save its report.' },
      { purpose: 'Recover state or record follow-up', skills: ['nectar-orient', 'nectar-context', 'nectar-capture', 'nectar-debt'], effect: 'Capture saves an idea; Debt inventories existing records.' },
    ].map(route => ({ ...route, skills: route.skills.filter(name => skills.some(skill => skill.name === name)) })),
    commands: [
      { command: 'nectar doctor [path] --json', effect: 'Read recorded delivery state and diagnostics.' },
      { command: 'nectar debt [path] --json', effect: 'Read comment candidates and existing backlog.' },
      { command: 'nectar telemetry --help', effect: 'Inspect optional collection controls; enabling or importing requires explicit authority.' },
      { command: 'nectar hooks --help', effect: 'Explain optional context, native hooks and separate collection controls; do not activate them from a help request.' },
      { command: 'nectar impact --file <results.json>', effect: 'Summarize an explicitly selected benchmark; never run paid evaluations.' },
    ] };
}

export function runGuide({ argv = [], root = packageRoot } = {}) {
  const args = argv[0] === 'guide' ? argv.slice(1) : argv;
  if (args.includes('--help') || args.includes('-h')) return { exitCode: 0, output: 'Usage: nectar guide [--json]' };
  if (args.some(arg => arg !== '--json')) return { exitCode: 2, output: '[nectar-guide] Unknown argument.' };
  try {
    const report = inspectGuide(root);
    return { exitCode: 0, report, output: args.includes('--json') ? JSON.stringify(report, null, 2) : [
      report.installation,
      ...report.skills.map(skill => `${skill.invocation.codex} / ${skill.invocation.claude}: ${skill.description}`),
      '', ...report.commands.map(item => `${item.command} — ${item.effect}`),
    ].join('\n') };
  } catch (error) { return { exitCode: 2, output: `[nectar-guide] ${error.message}` }; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runGuide({ argv: process.argv.slice(2) });
  console.log(result.output);
  process.exitCode = result.exitCode;
}
