import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(currentDirectory, '..');
const expectedSkills = [
  'nectar-audit',
  'nectar-build',
  'nectar-capture',
  'nectar-close',
  'nectar-context',
  'nectar-debug',
  'nectar-honey',
  'nectar-orient',
  'nectar-plan',
  'nectar-review',
  'nectar-shape',
];

function walkFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'CHANGELOG.md' || entry.name === 'node_modules') continue;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

test('ships exactly eleven prefixed canonical Nectar skill sources', () => {
  const sourceRoot = path.join(pluginRoot, 'internal-skills');
  const sources = fs.readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.deepEqual(sources, expectedSkills);
  for (const name of sources) {
    const skill = fs.readFileSync(path.join(sourceRoot, name, 'SKILL.md'), 'utf8');
    assert.match(skill, new RegExp(`^---\\nname: ${name}\\n`, 'm'));
  }
  const legacyRoot = path.join(pluginRoot, 'skills');
  const legacyFiles = fs.existsSync(legacyRoot) ? walkFiles(legacyRoot) : [];
  assert.deepEqual(legacyFiles, []);
});

test('plugin manifests do not auto-register internal skill sources', () => {
  for (const relative of [
    '.claude-plugin/plugin.json',
    '.codex-plugin/plugin.json',
  ]) {
    const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, relative), 'utf8'));
    assert.equal(Object.hasOwn(manifest, 'skills'), false, `${relative} must not register skills`);
  }
});

test('package allowlist ships internal sources without a plugin skills directory', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf8'));

  assert.ok(packageJson.files.includes('internal-skills/'));
  assert.equal(packageJson.files.includes('skills/'), false);
});
