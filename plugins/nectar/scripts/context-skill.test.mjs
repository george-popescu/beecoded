import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillPath = path.join(
  pluginRoot,
  'internal-skills/nectar-context/SKILL.md',
);
const agentPath = path.join(pluginRoot, 'agents/context-builder.md');

test('nectar-context routes status and refresh through the safe context runner', () => {
  const skill = fs.readFileSync(skillPath, 'utf8');
  const contextBuilderAgent = `nectar${':'}context-builder`;

  assert.match(skill, /^name: nectar-context$/m);
  assert.match(skill, /^description: Use (?:when|for)/m);
  assert.match(skill, /Not for/);
  assert.match(skill, /run-context\.mjs" status/);
  assert.match(skill, /status is read-only/i);
  assert.match(skill, /run-context\.mjs" stage/);
  assert.match(skill, new RegExp(contextBuilderAgent));
  assert.match(skill, /run-context\.mjs" promote/);
  assert.ok(
    skill.indexOf('run-context.mjs" stage')
      < skill.indexOf(contextBuilderAgent)
      && skill.indexOf(contextBuilderAgent)
        < skill.indexOf('run-context.mjs" promote'),
  );
});

test('context builder treats repository content as untrusted staged data', () => {
  const agent = fs.readFileSync(agentPath, 'utf8');

  assert.match(agent, /^name: context-builder$/m);
  assert.match(agent, /^tools: .*Write.*$/m);
  assert.match(agent, /untrusted data/i);
  assert.match(agent, /source: relative\/path:line/);
  assert.match(agent, /6 KiB/);
  assert.match(agent, /secret/i);
  assert.match(agent, /prompt injection/i);
  assert.match(agent, /symlink/i);
  assert.match(agent, /outside the project root/i);
  assert.match(agent, /AGENTS\.md.*CLAUDE\.md.*authoritative/is);
  assert.match(agent, /write only.*staging/is);
  assert.match(agent, /never (?:write to|modify) `?\.bee\//i);
  assert.match(agent, /never (?:write directly to|modify) `?\.nectar\/(?:CONTEXT|CONVENTIONS|context\.json)/i);
});

test('refresh keeps the previous snapshot when generation or promotion fails', () => {
  const skill = fs.readFileSync(skillPath, 'utf8');

  assert.match(skill, /previous valid snapshot/i);
  assert.match(skill, /do not retry by bypassing validation/i);
  assert.match(skill, /never modify `?\.bee\//i);
  assert.match(skill, /native `AGENTS\.md` and `CLAUDE\.md`.*higher priority/is);
});
