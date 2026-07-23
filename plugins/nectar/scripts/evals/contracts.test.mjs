import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  loadContracts,
  validateContract,
} from './contracts.mjs';
import { normalizeResult } from './results.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(currentDirectory, '../..');

test('loads the seven shipped behavioral contracts', () => {
  const contracts = loadContracts(path.join(pluginRoot, 'evals', 'contracts'));

  assert.deepEqual(
    contracts.map((contract) => contract.id),
    [
      'artifact-recovery',
      'contiguous-numbering',
      'dependency-readiness',
      'duplicate-detection',
      'plan-risk-classification',
      'review-risk-classification',
      'split-approval',
    ],
  );

  for (const contract of contracts) {
    assert.match(contract.prompt, /\S/);
    assert.match(contract.skill, /^nectar-(orient|plan|review|shape)$/);
    assert.ok(Object.keys(contract.fixture.files).length > 0);
    assert.ok(contract.checks.length > 0);
    assert.ok(contract.graderCriteria.length > 0);
  }
});

test('accepts complete semantic finding and summary checks', () => {
  const contract = validateContract({
    id: 'semantic-report',
    skill: 'nectar-review',
    prompt: 'Review the fixture.',
    fixture: { files: { 'src/example.js': 'export const value = 1;\n' } },
    checks: [
      {
        type: 'findingMatches',
        where: 'src/example.js',
        class: 'CODE_DEFECT',
        severityIn: ['MEDIUM', 'HIGH'],
        convergence: 'BLOCKING',
        requiredFields: ['Runtime path', 'Likelihood', 'Impact'],
      },
      { type: 'summaryCount', label: 'Blocking', value: 1 },
    ],
    graderCriteria: ['The report associates evidence with the classified finding.'],
  });

  assert.equal(contract.checks[0].type, 'findingMatches');
  assert.equal(contract.checks[1].type, 'summaryCount');
});

test('accepts a whole-fixture read-only invariant', () => {
  const contract = validateContract({
    id: 'fixture-integrity',
    skill: 'nectar-review',
    prompt: 'Review without edits.',
    fixture: { files: { 'src/example.js': 'export const value = 1;\n' } },
    checks: [{ type: 'fixtureUnchanged' }],
    graderCriteria: ['The fixture remains byte-for-byte unchanged.'],
  });

  assert.equal(contract.checks[0].type, 'fixtureUnchanged');
});

test('rejects incomplete semantic finding checks', () => {
  assert.throws(
    () => validateContract({
      id: 'bad-semantic-report',
      skill: 'nectar-review',
      prompt: 'Review the fixture.',
      fixture: { files: { 'src/example.js': 'export const value = 1;\n' } },
      checks: [{ type: 'findingMatches', where: '', class: 'not-a-class' }],
      graderCriteria: ['Require a structured finding.'],
    }, 'semantic contract'),
    /semantic contract\.checks\[0\]\.(where|class|severityIn|convergence|requiredFields)/,
  );
});

test('rejects malformed contracts with field-level errors', () => {
  assert.throws(
    () => validateContract({
      id: 'Bad ID',
      skill: 'unknown',
      fixture: { files: [] },
      prompt: '',
      checks: [{ type: 'mystery' }],
      graderCriteria: [],
    }, 'inline contract'),
    (error) => {
      assert.match(error.message, /inline contract\.id/);
      assert.match(error.message, /inline contract\.skill/);
      assert.match(error.message, /inline contract\.prompt/);
      assert.match(error.message, /inline contract\.fixture\.files/);
      assert.match(error.message, /inline contract\.checks\[0\]\.type/);
      assert.match(error.message, /inline contract\.graderCriteria/);
      return true;
    },
  );
});

test('rejects fixture paths that can escape an isolated workspace', () => {
  assert.throws(
    () => validateContract({
      id: 'escape-attempt',
      skill: 'nectar-shape',
      prompt: 'Start a feature',
      fixture: { files: { '../outside.md': 'unsafe' } },
      checks: [{ type: 'pathAbsent', path: 'docs/work/new-feature' }],
      graderCriteria: ['Do not write before approval.'],
    }, 'escape contract'),
    /escape contract\.fixture\.files\.\.\.\/outside\.md/,
  );
});

test('accepts a check that rejects any materialized split child', () => {
  const contract = validateContract({
    id: 'no-split-writes',
    skill: 'nectar-plan',
    prompt: 'Plan this work.',
    fixture: { files: { 'docs/work/example/design.md': '# Example\n' } },
    checks: [{
      type: 'childDirectoriesAbsent',
      path: 'docs/work/example',
    }],
    graderCriteria: ['No child directory is created before approval.'],
  });

  assert.equal(contract.checks[0].type, 'childDirectoriesAbsent');
});

test('loadContracts identifies invalid JSON by filename', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-contracts-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'broken.json'), '{not-json}\n');

  assert.throws(() => loadContracts(root), /broken\.json: invalid JSON/);
});

test('normalizes passed, failed, and unavailable host results', () => {
  assert.deepEqual(
    normalizeResult({
      host: 'codex',
      caseId: 'split-approval',
      passed: true,
      score: 1,
      evidence: ['Asked for explicit approval.'],
    }),
    {
      host: 'codex',
      caseId: 'split-approval',
      status: 'passed',
      passed: true,
      score: 1,
      evidence: ['Asked for explicit approval.'],
    },
  );

  assert.deepEqual(
    normalizeResult({
      host: 'claude',
      caseId: 'split-approval',
      passed: false,
      score: 0,
      evidence: 'Feature is early access.',
      status: 'unavailable',
    }),
    {
      host: 'claude',
      caseId: 'split-approval',
      status: 'unavailable',
      passed: false,
      score: 0,
      evidence: ['Feature is early access.'],
    },
  );

  assert.throws(
    () => normalizeResult({
      host: 'other',
      caseId: 'split-approval',
      passed: true,
      score: 2,
      evidence: [],
    }),
    /host must be claude or codex|score must be between 0 and 1/,
  );
});
