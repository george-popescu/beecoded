import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectGuide, runGuide } from './run-guide.mjs';

test('guide discovers actual packaged skills and host invocation mappings without executing them', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-guide-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['nectar-build', 'nectar-custom']) {
    const folder = path.join(root, 'internal-skills', name);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} behavior\n---\n`);
  }
  const result = runGuide({ argv: ['--json'], root });
  assert.equal(result.exitCode, 0);
  const report = JSON.parse(result.output);
  assert.deepEqual(report.skills.map(s => s.name), ['nectar-build', 'nectar-custom']);
  assert.equal(report.skills[0].invocation.codex, '$nectar-build');
  assert.equal(report.skills[0].invocation.claude, '/nectar-build');
  assert.deepEqual(report.routes.flatMap(route => route.skills), ['nectar-build']);
  assert.equal(fs.existsSync(path.join(root, '.nectar')), false);
});

test('guide rejects malformed packaged frontmatter and unknown command arguments', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-guide-invalid-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const folder = path.join(root, 'internal-skills', 'nectar-build');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'SKILL.md'), '---\nname: wrong-name\ndescription: invalid\n---\n');
  assert.throws(() => inspectGuide(root));
  assert.equal(runGuide({ argv: ['--bad'], root }).exitCode, 2);
});
