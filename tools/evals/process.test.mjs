import assert from 'node:assert/strict';
import test from 'node:test';

import { evalEnvironment, runCommand } from './process.mjs';

test('evaluation environment excludes ambient secrets unless explicitly allowlisted', () => {
  assert.deepEqual(evalEnvironment({
    PATH: '/bin',
    HOME: '/tmp/home',
    OPENAI_API_KEY: 'secret',
    CUSTOM_TOKEN: 'custom-secret',
    PLUGIN_EVAL_PASSTHROUGH_ENV: 'CUSTOM_TOKEN',
  }), {
    PATH: '/bin',
    HOME: '/tmp/home',
    CUSTOM_TOKEN: 'custom-secret',
  });
});

test('returns a child exit status without leaking an early stdin close', async () => {
  const result = await runCommand(process.execPath, ['-e', 'process.exit(3)'], {
    input: 'x'.repeat(1024 * 1024),
  });
  assert.equal(result.status, 3);
  assert.equal(result.error, null);
});

test('kills a hung child after the configured timeout', async () => {
  const script = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);";
  const result = await runCommand(process.execPath, ['-e', script], {
    timeout: 100,
    killGraceMs: 20,
  });
  assert.equal(result.error?.code, 'ETIMEDOUT');
  assert.equal(result.signal, 'SIGKILL');
});
