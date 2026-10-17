import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createCodexIsolation, selectCodexConfig, verificationEnvironment } from './isolation.mjs';
import { redactExcludedValues } from './results.mjs';

test('isolates host instructions and removes copied credentials even when results are retained', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-isolation-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const original = path.join(root, '.codex');
  fs.mkdirSync(original);
  fs.writeFileSync(path.join(original, 'auth.json'), '{"fixture":"synthetic-token"}');
  fs.writeFileSync(path.join(original, 'config.toml'), 'model = "example-model"\nmodel_reasoning_effort = "high"\ndeveloper_instructions = "unwanted"\n[mcp_servers.private]\ncommand = "private-tool"\n');
  fs.writeFileSync(path.join(original, 'AGENTS.md'), 'Private instructions');
  const isolation = createCodexIsolation({ source: { HOME: root, PATH: process.env.PATH, ERA_HOME: '/private', NECTAR_EVAL_PASSTHROUGH_ENV: 'ERA_HOME,CODEX_HOME', CODEX_HOME: original } });
  assert.notEqual(isolation.env.HOME, root);
  assert.equal(isolation.env.ERA_HOME, undefined);
  assert.equal(fs.existsSync(path.join(isolation.env.CODEX_HOME, 'AGENTS.md')), false);
  assert.deepEqual(isolation.settings, { model: 'example-model', model_reasoning_effort: 'high' });
  assert.doesNotMatch(fs.readFileSync(path.join(isolation.env.CODEX_HOME, 'config.toml'), 'utf8'), /private|unwanted/);
  assert.equal(fs.statSync(path.join(isolation.env.CODEX_HOME, 'auth.json')).mode & 0o777, 0o600);
  assert.equal(isolation.redact('synthetic-token'), '<redacted>');
  isolation.cleanup();
  assert.equal(fs.existsSync(isolation.env.HOME), false);
  assert.equal(fs.existsSync(path.join(original, 'auth.json')), true);
});

test('failed initialization does not leave an authentication directory or echo its contents', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-invalid-auth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.codex'));
  fs.writeFileSync(path.join(root, '.codex/auth.json'), 'private-invalid-auth-value');
  assert.throws(() => createCodexIsolation({ source: { HOME: root }, temporaryRoot: root }), (error) => {
    assert.doesNotMatch(error.message, /private-invalid-auth-value/);
    return /invalid JSON/.test(error.message);
  });
  const after = fs.readdirSync(root).filter((name) => name.startsWith('nectar-eval-auth-'));
  assert.deepEqual(after, []);
});

test('configuration selection does not silently change custom provider or multiline settings', () => {
  assert.throws(() => selectCodexConfig('model_provider = "private"\n'), /custom providers/);
  assert.throws(() => selectCodexConfig('model = """unsupported\n'), /simple quoted/);
  assert.throws(() => selectCodexConfig('profile = "work"\n'), /active profile/);
  assert.deepEqual(selectCodexConfig('model = "real"\ndeveloper_instructions = """\nmodel = "injected"\n"""\n').settings, { model: 'real' });
  assert.equal(verificationEnvironment('/tmp/owned-verifier').OPENAI_API_KEY, undefined);
});

test('exit and termination clean ephemeral credentials', () => {
  const url = new URL('./isolation.mjs', import.meta.url).href;
  for (const signal of ['exit', 'SIGTERM', 'SIGINT']) {
    const script = `import {createCodexIsolation} from ${JSON.stringify(url)}; const x=createCodexIsolation({source:{HOME:'/nonexistent'}});console.log(x.env.HOME);${signal === 'exit' ? 'process.exit(0)' : `process.kill(process.pid, '${signal}');setInterval(()=>{},1000)`};`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 5000 });
    const home = result.stdout.trim();
    assert.ok(home.includes('nectar-eval-auth-'));
    assert.equal(fs.existsSync(home), false, signal);
  }
});

test('redacts complete and truncated quoted secrets without exposing suffix words', () => {
  const value = redactExcludedValues(null, 'failure password="two word secret\nnext line token=abc123');
  assert.doesNotMatch(value, /two word secret|abc123/);
  assert.match(value, /password=<redacted>\nnext line token=<redacted>/);
  assert.doesNotMatch(redactExcludedValues(null,
    'Authorization: Bearer private-bearer-token\nhttps://user:private-password@example.test/repo'),
  /private-bearer-token|private-password/);
});
