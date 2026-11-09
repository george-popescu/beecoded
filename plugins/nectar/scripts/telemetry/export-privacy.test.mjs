import assert from 'node:assert/strict';
import test from 'node:test';
import { publicSessions } from './index.mjs';

test('native export removes raw identity in measurement IDs and future private metadata', () => {
  const input = { key: 'hashed-session', projectId: 'hashed-project', host: 'claude',
    sessionId: 'PRIVATE_SESSION', parentSessionId: 'PRIVATE_PARENT',
    measurementId: 'claude:PRIVATE_SESSION:2026-11-06',
    projectRoot: '/private/client', futureInternalField: 'PRIVATE_FUTURE',
    cost: { usd: 2, kind: 'reported', source: 'claude.session.usage.delta' },
    usage: { total: 123 }, label: 'Client', topic: 'docs/work/client' };
  for (const includeNames of [false, true]) {
    const [result] = publicSessions([input], includeNames);
    assert.equal(result.cost.usd, 2); assert.equal(result.usage.total, 123);
    assert.equal(result.parentKey.length, 64);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|\/private\/client/);
    assert.equal(result.topic, includeNames ? input.topic : undefined);
  }
});
