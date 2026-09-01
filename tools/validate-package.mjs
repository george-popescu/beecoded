#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getProductDefinition } from './plugin-products.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const product = process.argv[2];
let productDefinition;
try {
  productDefinition = getProductDefinition(product);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

const pluginRoot = path.join(repoRoot, productDefinition.packageRoot);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const pkg = readJson(path.join(pluginRoot, 'package.json'));
const claude = readJson(path.join(pluginRoot, '.claude-plugin', 'plugin.json'));
const codex = readJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'));
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

check(pkg.name === productDefinition.packageName, `package name must be ${productDefinition.packageName}`);
check(pkg.version === claude.version, 'npm and Claude manifest versions must match');
check(pkg.version === codex.version, 'npm and Codex manifest versions must match');
check(claude.name === product, 'Claude manifest name must match package product');
check(codex.name === product, 'Codex manifest name must match package product');
check(!Object.hasOwn(claude, 'agents'), 'Claude agents must use default root-level discovery; do not declare the agents directory');
check(pkg.license === 'MIT' && fs.existsSync(path.join(pluginRoot, 'LICENSE')), 'MIT LICENSE must be shipped');
check(Array.isArray(pkg.files), 'package.json files allowlist is required');
check(pkg.files.includes('.claude-plugin/'), 'npm package must include .claude-plugin/');
check(pkg.files.includes('.codex-plugin/'), 'npm package must include .codex-plugin/');
check(pkg.files.includes('bin/'), 'npm package must include bin/');
check(pkg.bin?.[product] === 'bin/install.mjs', `package bin must expose ${product} via bin/install.mjs`);
const installerPath = path.join(pluginRoot, 'bin', 'install.mjs');
check(fs.existsSync(installerPath), 'bin/install.mjs must exist');
if (fs.existsSync(installerPath)) {
  check(fs.readFileSync(installerPath, 'utf8').startsWith('#!/usr/bin/env node\n'), 'bin/install.mjs must have a Node shebang');
}
check(!pkg.scripts?.install && !pkg.scripts?.postinstall && !pkg.scripts?.prepare, 'install-time lifecycle scripts are not allowed');

function walk(entry) {
  const absolute = path.join(pluginRoot, entry);
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.statSync(absolute);
  if (!stat.isDirectory()) return [absolute];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((child) => {
    const nested = path.join(entry, child.name);
    return child.isDirectory() ? walk(nested) : [path.join(pluginRoot, nested)];
  });
}

const packedFiles = [...new Set(pkg.files.flatMap((entry) => walk(entry.replace(/\/$/, ''))))];
check(packedFiles.length > 0, 'package files allowlist must resolve to real files');

for (const file of packedFiles) {
  const relative = path.relative(pluginRoot, file).split(path.sep).join('/');
  check(!relative.includes('/node_modules/'), `${relative}: node_modules must not be packed`);
  if (productDefinition.kind === 'bee') {
    const parts = relative.toLowerCase().split('/');
    check(!parts.some((part) => part === 'dashboard' || part.startsWith('hive')), `${relative}: Hive artifact must not be packed`);
  }
  if (/\.(?:md|js|mjs|cjs|json|sh|yaml|yml)$/i.test(file)) {
    const content = fs.readFileSync(file, 'utf8');
    check(!content.includes('[TODO:'), `${relative}: unresolved TODO placeholder`);
    if (productDefinition.kind === 'bee') {
      const retiredHiveCommand = new RegExp(`/bee${':'}hive\\b`, 'i');
      check(!/Bee Hive|hive-server|emit-event|\.hive-pid/i.test(content)
        && !retiredHiveCommand.test(content), `${relative}: active Hive reference must not be packed`);
    }
  }
}

if (productDefinition.kind === 'bee') {
  const commands = fs.readdirSync(path.join(pluginRoot, 'workflows')).filter((file) => file.endsWith('.md'));
  const internalSkillsRoot = path.join(pluginRoot, 'internal-skills');
  const internalSkills = fs.existsSync(internalSkillsRoot)
    ? fs.readdirSync(internalSkillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(internalSkillsRoot, entry.name, 'SKILL.md')))
    : [];
  const expectedSkills = commands.map((file) => `bee-${file.slice(0, -3)}`).sort();
  const actualSkills = internalSkills.map((entry) => entry.name).sort();
  check(commands.length === internalSkills.length, `expected one internal skill per Bee workflow (${commands.length} workflows, ${internalSkills.length} skills)`);
  check(JSON.stringify(actualSkills) === JSON.stringify(expectedSkills), 'Bee internal skill roster must be exactly bee-<workflow> for every canonical workflow');
  check(fs.existsSync(path.join(internalSkillsRoot, 'bee-init', 'SKILL.md')), '$bee-init skill is required');
  check(commands.includes('checkpoint.md'), '/bee-checkpoint workflow is required');
  check(!commands.includes('compact.md'), '/bee-compact must not exist because it interferes with Claude Code autocomplete for built-in /compact');
  check(!fs.existsSync(path.join(internalSkillsRoot, 'bee-compact')), '$bee-compact skill directory must not exist');
  check(!commands.includes('hive.md'), 'Hive command must not exist');
  check(!fs.existsSync(path.join(pluginRoot, 'commands')), 'top-level commands/ must not exist because it conflicts with shared host skills');
  check(!fs.existsSync(path.join(pluginRoot, 'skills')), 'plugin-root skills/ must not exist because it auto-discovers namespaced public commands');
  check(pkg.files.includes('internal-skills/'), 'Bee npm package must include internal-skills/');
  check(!pkg.files.includes('skills/'), 'Bee npm package must not include plugin-discovered skills/');
  check(claude.skills === './claude-skills/', 'Claude manifest must register only private Bee knowledge skills');
  check(!Object.hasOwn(codex, 'skills'), 'Codex manifest must not register Bee public or internal skills');
  for (const knowledgeSkill of walk('claude-skills').filter((file) => path.basename(file) === 'SKILL.md')) {
    check(
      /^user-invocable:\s*false$/m.test(fs.readFileSync(knowledgeSkill, 'utf8')),
      `${path.relative(pluginRoot, knowledgeSkill)}: Claude knowledge skill must remain hidden from the slash-command menu`,
    );
  }
  check(claude.hooks === './hooks/claude.json', 'Claude hooks must use the host-specific claude.json file');
  check(!codex.hooks, 'Codex hooks must remain disabled until a native hook set exists');

  const activeInstructionRoots = [
    path.join(pluginRoot, 'workflows'),
    path.join(pluginRoot, 'agents'),
    path.join(pluginRoot, 'claude-skills'),
    internalSkillsRoot,
    path.join(pluginRoot, 'codex'),
    path.join(pluginRoot, 'scripts'),
    path.join(pluginRoot, 'hooks'),
    path.join(pluginRoot, 'README.md'),
    path.join(repoRoot, 'README.md'),
  ];
  const legacyInvocation = /(?:\/|\$)bee:/;
  for (const file of activeInstructionRoots.flatMap((root) => {
    const relative = path.relative(pluginRoot, root);
    return walk(relative);
  })) {
    if (!/\.(?:md|json|js|mjs|cjs|sh|yaml|yml)$/i.test(file)) continue;
    const relative = path.relative(pluginRoot, file).split(path.sep).join('/');
    check(!legacyInvocation.test(fs.readFileSync(file, 'utf8')), `${relative}: legacy Bee invocation is not allowed`);
  }
} else if (productDefinition.kind === 'nectar') {
  const internalSkillsRoot = path.join(pluginRoot, 'internal-skills');
  const expectedSkills = productDefinition.publicSkills;
  const skills = fs.existsSync(internalSkillsRoot)
    ? fs.readdirSync(internalSkillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(internalSkillsRoot, entry.name, 'SKILL.md')))
    : [];
  const actualSkills = skills.map((entry) => entry.name).sort();
  check(JSON.stringify(actualSkills) === JSON.stringify(expectedSkills), `Nectar must ship exactly its declared internal nectar-* skills (expected ${expectedSkills.length}, found ${actualSkills.join(', ') || 'none'})`);
  check(!fs.existsSync(path.join(pluginRoot, 'skills')), 'Nectar plugin-root skills/ must not exist because it auto-discovers namespaced public commands');
  check(pkg.files.includes('internal-skills/'), 'Nectar npm package must include internal-skills/');
  check(!pkg.files.includes('skills/'), 'Nectar npm package must not include plugin-discovered skills/');
  check(!Object.hasOwn(claude, 'skills'), 'Claude manifest must not register Nectar public or internal skills');
  check(!Object.hasOwn(codex, 'skills'), 'Codex manifest must not register Nectar public or internal skills');
  check(pkg.files.includes('evals/'), 'Nectar npm package must include evals/');
  check(pkg.files.includes('scripts/'), 'Nectar npm package must include scripts/');
  check(pkg.files.includes('.mcp.json'), 'Nectar npm package must include the Codex MCP config');
  check(pkg.files.includes('.mcp.claude.json'), 'Nectar npm package must include the Claude MCP config');
  check(codex.mcpServers === './.mcp.json', 'Codex must use the package-relative MCP config');
  check(claude.mcpServers === './.mcp.claude.json', 'Claude must use its host-specific MCP config');
  const claudeMcp = readJson(path.join(pluginRoot, '.mcp.claude.json'));
  check(
    claudeMcp.mcpServers?.['nectar-atlas']?.args?.[0]
      === '${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs',
    'Claude MCP server must resolve through CLAUDE_PLUGIN_ROOT',
  );
  check(fs.existsSync(path.join(pluginRoot, 'scripts', 'run-doctor.mjs')), 'Nectar doctor runner is required');
  check(fs.existsSync(path.join(pluginRoot, 'scripts', 'run-context.mjs')), 'Nectar context runner is required');
  check(fs.existsSync(path.join(pluginRoot, 'scripts', 'run-behavioral-evals.mjs')), 'Nectar eval runner is required');
  check(fs.existsSync(path.join(pluginRoot, 'scripts', 'run-atlas.mjs')), 'Nectar Atlas CLI runner is required');
  check(fs.existsSync(path.join(pluginRoot, 'scripts', 'run-atlas-evals.mjs')), 'Nectar Atlas evaluation runner is required');
  check(fs.existsSync(path.join(pluginRoot, 'mcp', 'server.mjs')), 'Nectar Atlas MCP server is required');
  check(fs.existsSync(path.join(pluginRoot, 'evals', 'contracts', 'review-risk-classification.json')), 'Nectar review-risk-classification behavioral contract is required');
  check(fs.existsSync(path.join(pluginRoot, 'evals', 'contracts', 'atlas-workflow-discipline.json')), 'Nectar Atlas workflow behavioral contract is required');
  check(pkg.scripts?.test?.includes('scripts/*.test.mjs'), 'Nectar npm test must run root script contract tests');
  check(pkg.scripts?.test?.includes('mcp/*.test.mjs'), 'Nectar npm test must run MCP tests');
  check(pkg.scripts?.test?.includes('scripts/atlas/*.test.mjs'), 'Nectar npm test must run recursive Atlas tests');
  check(pkg.scripts?.['evals:atlas'] === 'node scripts/run-atlas-evals.mjs', 'Nectar must expose the Atlas evaluation suite');
  check(pkg.engines?.node === '^22.18.0 || >=24.11.0', 'Nectar Node engine must match the Atlas runtime contract');
  check(
    JSON.stringify(Object.keys(pkg.dependencies || {}).sort())
      === JSON.stringify(['@babel/parser', 'php-parser']),
    'Nectar Atlas runtime dependencies must remain the approved pure-JavaScript parser pair',
  );
  const installer = fs.readFileSync(installerPath, 'utf8');
  check(installer.includes("command === 'doctor'"), 'Nectar npm executable must route the doctor command');
  check(installer.includes("command === 'eval'"), 'Nectar npm executable must route the eval command');
  check(installer.includes("command === 'atlas'"), 'Nectar npm executable must route Atlas commands');
} else {
  const internalSkillsRoot = path.join(pluginRoot, 'internal-skills');
  const skills = fs.existsSync(internalSkillsRoot)
    ? fs.readdirSync(internalSkillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(internalSkillsRoot, entry.name, 'SKILL.md')))
    : [];
  const actualSkills = skills.map((entry) => entry.name).sort();
  const expectedSkills = [...productDefinition.publicSkills].sort();
  check(
    JSON.stringify(actualSkills) === JSON.stringify(expectedSkills),
    `${product} must ship exactly its declared public skills (expected ${expectedSkills.join(', ')}, found ${actualSkills.join(', ') || 'none'})`,
  );
  check(!fs.existsSync(path.join(pluginRoot, 'skills')), `${product} plugin-root skills/ must not exist because managed skills are installed standalone`);
  check(pkg.files.includes('internal-skills/'), `${product} npm package must include internal-skills/`);
  check(!pkg.files.includes('skills/'), `${product} npm package must not include plugin-discovered skills/`);
  check(!Object.hasOwn(claude, 'skills'), `Claude manifest must not register ${product} public skills`);
  check(!Object.hasOwn(codex, 'skills'), `Codex manifest must not register ${product} public skills`);
  if (productDefinition.evalContracts) {
    check(pkg.files.includes('evals/'), `${product} npm package must include evals/`);
    check(fs.existsSync(path.join(pluginRoot, 'evals', 'contracts')), `${product} behavioral contract directory is required`);
  }
}

for (const marketplacePath of [
  path.join(repoRoot, '.claude-plugin', 'marketplace.json'),
  path.join(repoRoot, '.agents', 'plugins', 'marketplace.json'),
]) {
  const marketplace = readJson(marketplacePath);
  const entry = marketplace.plugins?.find((candidate) => candidate.name === product);
  check(Boolean(entry), `${path.relative(repoRoot, marketplacePath)} must list ${product}`);
  check(entry?.source?.source === 'npm', `${product} marketplace source must be npm`);
  check(entry?.source?.package === pkg.name, `${product} marketplace package must match ${pkg.name}`);
  check(entry?.source?.version === pkg.version, `${product} marketplace version must match ${pkg.version}`);
}

if (failures.length) {
  console.error(`${product} package validation failed:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`${product} package valid: ${pkg.name}@${pkg.version} (${packedFiles.length} allowlisted files)`);
