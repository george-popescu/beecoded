import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { evaluateChecks } from './checks.mjs';
import { snapshotFixture } from './contracts.mjs';

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-eval-checks-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/app.js'), 'const token = process.env.TOKEN;\n');
  return root;
}

test('grades response, finding, summary, path, file, and immutable-fixture checks', (t) => {
  const root = workspace(t);
  const initialSnapshot = snapshotFixture(root);
  fs.writeFileSync(path.join(root, 'audit.md'), '# Audit\n');
  const response = `### [HIGH] Exposed token\n- **Class:** CODE_DEFECT\n- **Where:** src/app.js:1\n- **Convergence:** BLOCKING\n- **Confidence:** HIGH\n\nBlocking: 1\n`;
  const contract = {
    checks: [
      { type: 'responseIncludes', value: 'Exposed token' },
      { type: 'responseExcludes', value: 'all clean' },
      { type: 'pathExists', path: 'audit.md' },
      { type: 'pathAbsent', path: 'unexpected.md' },
      { type: 'fileIncludes', path: 'audit.md', value: '# Audit' },
      {
        type: 'findingMatches',
        where: 'src/app.js:1',
        class: 'CODE_DEFECT',
        severityIn: ['HIGH'],
        convergence: 'BLOCKING',
        requiredFields: ['Confidence'],
      },
      { type: 'summaryCount', label: 'Blocking', value: 1 },
    ],
  };

  const result = evaluateChecks({ contract, response, root, initialSnapshot });
  assert.equal(result.passed, true);
  assert.equal(result.results.every(({ passed }) => passed), true);
});

test('detects fixture mutation against the initial snapshot', (t) => {
  const root = workspace(t);
  const initialSnapshot = snapshotFixture(root);
  fs.writeFileSync(path.join(root, 'src/app.js'), 'changed\n');

  const result = evaluateChecks({
    contract: { checks: [{ type: 'fixtureUnchanged' }] },
    response: '',
    root,
    initialSnapshot,
  });

  assert.equal(result.passed, false);
  assert.match(result.results[0].evidence, /fixture changed: src\/app.js/);
});

test('rejects deterministic check targets that traverse symbolic links', (t) => {
  const root = workspace(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-eval-check-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret\n');
  fs.symlinkSync(outside, path.join(root, 'linked'));

  const result = evaluateChecks({
    contract: { checks: [{ type: 'pathExists', path: 'linked/secret.txt' }] },
    response: '',
    root,
    initialSnapshot: {},
  });

  assert.equal(result.passed, false);
  assert.match(result.results[0].evidence, /symbolic links are not allowed/);
});

test('finding matches reject each contradictory enum and location independently', (t) => {
  const root = workspace(t);
  const invalidFields = [
    { classValue: 'NOT_CODE_DEFECT' },
    { whereValue: 'src/app.js:10' },
    { convergenceValue: 'NON_BLOCKING' },
    { classValue: 'CODE_DEFECT or TEST_DEFECT' },
    { convergenceValue: 'BLOCKING and NON_BLOCKING' },
  ];

  for (const invalid of invalidFields) {
    const response = `### [HIGH] Contradictory finding
- **Class:** ${invalid.classValue || 'CODE_DEFECT'}
- **Where:** ${invalid.whereValue || 'src/app.js:1'}
- **Convergence:** ${invalid.convergenceValue || 'BLOCKING'}
- **Confidence:** HIGH
`;
    const result = evaluateChecks({
      contract: {
        checks: [{
          type: 'findingMatches',
          where: 'src/app.js:1',
          class: 'CODE_DEFECT',
          severityIn: ['HIGH'],
          convergence: 'BLOCKING',
          requiredFields: ['Confidence'],
        }],
      },
      response,
      root,
      initialSnapshot: snapshotFixture(root),
    });

    assert.equal(result.passed, false, JSON.stringify(invalid));
  }
});

test('child directory absence rejects a missing parent and symbolic children', (t) => {
  const root = workspace(t);
  const protectedParent = path.join(root, 'docs/work/topic');
  fs.mkdirSync(protectedParent, { recursive: true });
  const contract = {
    checks: [{ type: 'childDirectoriesAbsent', path: 'docs/work/topic' }],
  };

  fs.rmSync(path.join(root, 'docs'), { recursive: true });
  const missing = evaluateChecks({ contract, response: '', root, initialSnapshot: {} });
  assert.equal(missing.passed, false);

  fs.mkdirSync(protectedParent, { recursive: true });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-eval-child-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, path.join(protectedParent, '01-child'));
  const linked = evaluateChecks({ contract, response: '', root, initialSnapshot: {} });
  assert.equal(linked.passed, false);
  assert.match(linked.results[0].evidence, /symbolic/);
});

test('workspace change allowlist permits only the requested report', (t) => {
  const root = workspace(t);
  const initialSnapshot = snapshotFixture(root);
  fs.writeFileSync(path.join(root, 'code-audit-report.md'), '# Report\n');
  const contract = {
    checks: [{ type: 'workspaceChangesOnly', paths: ['code-audit-report.md'] }],
  };

  const reportOnly = evaluateChecks({ contract, response: '', root, initialSnapshot });
  assert.equal(reportOnly.passed, true);

  fs.writeFileSync(path.join(root, 'src/app.js'), 'mutated\n');
  const sourceMutation = evaluateChecks({ contract, response: '', root, initialSnapshot });
  assert.equal(sourceMutation.passed, false);
  assert.match(sourceMutation.results[0].evidence, /src\/app\.js/);
});
