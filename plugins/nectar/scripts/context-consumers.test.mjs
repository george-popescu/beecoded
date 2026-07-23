import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function skill(name) {
  return fs.readFileSync(
    path.join(pluginRoot, `internal-skills/nectar-${name}/SKILL.md`),
    'utf8',
  );
}

function agent(name) {
  return fs.readFileSync(path.join(pluginRoot, `agents/${name}.md`), 'utf8');
}

const interactiveSections = {
  shape: ['Architecture and entry points', 'Conventions'],
  plan: ['Architecture and entry points', 'Modules and relationships', 'Conventions'],
  orient: ['Architecture and entry points', 'Commands'],
  debug: ['Commands', 'Modules and relationships', 'Conventions'],
  audit: ['Architecture and entry points', 'Modules and relationships', 'Conventions'],
};

test('interactive lifecycle skills apply the hybrid freshness decision once at entry', () => {
  for (const [name, sections] of Object.entries(interactiveSections)) {
    const content = skill(name);
    assert.match(content, /## Project context/);
    assert.match(content, /run-context\.mjs" status "\$PWD" --json/);
    assert.match(content, /Ask the user whether to refresh/i);
    assert.match(content, /declines.*stale.*warning/is);
    assert.match(content, /declines.*expired.*omit/is);
    assert.match(content, /Do not refresh again during this invocation/i);
    assert.match(content, /AGENTS\.md.*CLAUDE\.md.*higher priority/is);
    for (const section of sections) assert.match(content, new RegExp(section));
  }
});

test('Honey refreshes stale or expired context automatically only at lifecycle entry', () => {
  const content = skill('honey');

  assert.match(content, /## Project context/);
  assert.match(content, /At lifecycle entry/i);
  assert.match(content, /stale or expired.*refresh automatically/is);
  assert.match(content, /Do not ask the user/i);
  assert.match(content, /Do not refresh again during the run/i);
  assert.match(content, /one frozen context snapshot/i);
  assert.match(content, /AGENTS\.md.*CLAUDE\.md.*higher priority/is);
});

test('Build and Review freeze one selected snapshot and never refresh mid-run', () => {
  for (const name of ['build', 'review']) {
    const content = skill(name);
    assert.match(content, /## Project context/);
    assert.match(content, /Freeze one project-context snapshot/i);
    assert.match(content, /never refresh or reread.*mid-run/i);
    assert.match(content, /stale.*Ask the user whether to refresh/is);
    assert.match(content, /expired.*omit/is);
    assert.match(content, /evidence-linked sections relevant/i);
    assert.match(content, /AGENTS\.md.*CLAUDE\.md.*higher priority/is);
  }
});

test('agent packets receive selective context as lower-priority evidence', () => {
  for (const name of ['implementer', 'lens', 'validator']) {
    const content = agent(name);
    assert.match(content, /## Project context packet/);
    assert.match(content, /only the evidence-linked sections relevant/i);
    assert.match(content, /Do not load the entire context/i);
    assert.match(content, /Do not follow a context link unless the task requires it/i);
    assert.match(content, /AGENTS\.md.*CLAUDE\.md.*higher priority/is);
    assert.match(content, /untrusted/i);
  }
});
