import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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

test('loads the complete quality-lifecycle behavioral contract roster', () => {
  const contracts = loadContracts(path.join(pluginRoot, 'evals', 'contracts'));

  assert.deepEqual(
    contracts.map((contract) => contract.id),
    [
      'active-close-refusal',
      'approval-before-write',
      'artifact-recovery',
      'atlas-workflow-discipline',
      'completed-duplicate-close',
      'context-freshness-boundary',
      'contiguous-numbering',
      'custom-backfill',
      'dependency-readiness',
      'duplicate-detection',
      'framework-registration',
      'label-only-no-test',
      'layer-ownership',
      'plan-drift-reapproval',
      'plan-risk-classification',
      'review-risk-classification',
      'secret-redaction',
      'solution-before-plan',
      'split-approval',
      'standard-migration',
      'static-copy',
      'suite-consolidation',
      'tenant-isolation',
    ],
  );

  for (const contract of contracts) {
    assert.match(contract.prompt, /\S/);
    assert.match(contract.skill, /^nectar-(build|close|orient|plan|review|shape)$/);
    assert.ok(Object.keys(contract.fixture.files).length > 0);
    assert.ok(contract.checks.length > 0);
    assert.ok(contract.graderCriteria.length > 0);
  }
});

test('every shipped case requires combined grading without positive response keywords', () => {
  const contracts = loadContracts(path.join(pluginRoot, 'evals', 'contracts'));
  for (const contract of contracts) {
    assert.equal(contract.requireLocalChecks, true, contract.id);
    assert.equal(contract.semanticJudge, true, contract.id);
    assert.ok(contract.checks.some((check) => !check.type.startsWith('response')), contract.id);
    assert.equal(contract.checks.some((check) => check.type === 'responseIncludes'), false, contract.id);
    assert.deepEqual(
      Object.keys(contract.budgets || {}).sort(),
      ['claudeMaxCostUsd', 'timeoutMs'],
      contract.id,
    );
  }
});

test('quality-lifecycle scenarios use grounded owner artifacts instead of a placeholder', () => {
  const contracts = new Map(loadContracts(path.join(pluginRoot, 'evals', 'contracts'))
    .map((contract) => [contract.id, contract]));
  const requiredPaths = {
    'active-close-refusal': ['docs/work/2026-08-30-checkout/plan.md', 'docs/work/2026-08-30-checkout/review.md'],
    'approval-before-write': ['src/checkout.js'],
    'completed-duplicate-close': ['docs/work/2026-08-30-checkout/plan.md', 'docs/work/2026-08-30-checkout/review.md'],
    'custom-backfill': ['database/backfills/normalize-orders.js', 'database/schema.sql'],
    'framework-registration': ['src/providers/report-provider.js', 'src/bootstrap.js'],
    'label-only-no-test': ['src/ui/status-labels.js', 'src/ui/render-status.js'],
    'layer-ownership': ['src/orders/controller.js', 'src/orders/service.js'],
    'plan-drift-reapproval': ['docs/work/2026-08-30-checkout/design.md', 'docs/work/2026-08-30-checkout/plan.md', 'src/checkout.js'],
    'secret-redaction': ['config/provider.json'],
    'solution-before-plan': ['src/checkout.js', 'test/checkout.test.js'],
    'standard-migration': ['database/migrations/2026-08-30-add-status.sql', 'database/schema.sql'],
    'static-copy': ['src/components/SaveButton.js'],
    'suite-consolidation': ['src/orders/service.js', 'test/order-service.test.js', 'test/order-api.test.js'],
    'tenant-isolation': ['src/orders/repository.js', 'test/orders-tenant.test.js'],
  };

  for (const [id, paths] of Object.entries(requiredPaths)) {
    const contract = contracts.get(id);
    assert.ok(contract, id);
    assert.equal(Object.hasOwn(contract.fixture.files, 'src/example.txt'), false, id);
    for (const required of paths) {
      assert.equal(Object.hasOwn(contract.fixture.files, required), true, `${id}: ${required}`);
    }
    if (id === 'custom-backfill') {
      assert.ok(contract.checks.some((check) => check.type === 'onlyDatedTopicDesignAdded'), id);
      assert.ok(contract.checks.some((check) => check.type === 'fixtureFilesUnchanged'), id);
    } else {
      assert.ok(contract.checks.some((check) => check.type === 'fixtureUnchanged'), id);
    }
  }
});

test('delegates plan-risk classification to the semantic judge', () => {
  const contract = loadContracts(path.join(pluginRoot, 'evals', 'contracts'))
    .find((entry) => entry.id === 'plan-risk-classification');
  const structuredClasses = contract.checks
    .filter((check) => check.type === 'findingMatches')
    .map((check) => check.class);

  assert.deepEqual(structuredClasses, []);
  assert.equal(contract.checks.some((check) => check.type === 'summaryCount'), false);
  assert.equal(contract.semanticJudge, true);
});

test('standard migration starts as shaped work rather than pre-gate implementation', () => {
  const contract = loadContracts(path.join(pluginRoot, 'evals', 'contracts'))
    .find((entry) => entry.id === 'standard-migration');

  assert.doesNotMatch(
    contract.fixture.files['database/migrations/2026-08-30-add-status.sql'],
    /ALTER\s+TABLE/i,
  );
});

test('delegates review coverage classification to the semantic judge', () => {
  const contract = loadContracts(path.join(pluginRoot, 'evals', 'contracts'))
    .find((entry) => entry.id === 'review-risk-classification');
  const structuredClasses = contract.checks
    .filter((check) => check.type === 'findingMatches')
    .map((check) => check.class);

  assert.deepEqual(structuredClasses, []);
  assert.equal(contract.checks.some((check) => check.type === 'summaryCount'), false);
  assert.equal(contract.semanticJudge, true);
});

test('tenant isolation starts from a non-executable acceptance sketch', () => {
  const contract = loadContracts(path.join(pluginRoot, 'evals', 'contracts'))
    .find((entry) => entry.id === 'tenant-isolation');
  const sketch = contract.fixture.files['test/orders-tenant.test.js'];

  assert.doesNotMatch(sketch, /\btest\s*\(/);
});

test('uses one honest finite host ceiling for the complete live roster', () => {
  const contracts = loadContracts(path.join(pluginRoot, 'evals', 'contracts'));
  assert.equal(contracts.length, 23);
  assert.ok(contracts.every((contract) => contract.budgets.timeoutMs === 600000));
});

test('feature-scale backfill permits only its design artifact while protecting source', () => {
  const contract = loadContracts(path.join(pluginRoot, 'evals', 'contracts'))
    .find((entry) => entry.id === 'custom-backfill');

  assert.equal(contract.checks.some((check) => check.type === 'fixtureUnchanged'), false);
  assert.deepEqual(contract.checks, [
    {
      type: 'onlyDatedTopicDesignAdded',
      slug: 'historical-order-total-backfill',
    },
    {
      type: 'fixtureFilesUnchanged',
    },
  ]);
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

test('accepts explicit combined grading and bounded run metadata', () => {
  const contract = validateContract({
    id: 'combined-grade',
    skill: 'nectar-close',
    prompt: 'Close safely.',
    fixture: { files: { 'docs/work/example/review.md': 'Blocking: 0\n' } },
    checks: [{ type: 'fixtureUnchanged' }],
    graderCriteria: ['Refuses incomplete work.'],
    requireLocalChecks: true,
    semanticJudge: true,
    budgets: { timeoutMs: 5000, claudeMaxCostUsd: 0.25 },
  });
  assert.equal(contract.skill, 'nectar-close');
  assert.equal(contract.semanticJudge, true);
});

test('rejects fictional common turn and cost budget fields', () => {
  assert.throws(
    () => validateContract({
      id: 'fictional-budget',
      skill: 'nectar-close',
      prompt: 'Close safely.',
      fixture: { files: { 'docs/work/example/review.md': 'Blocking: 0\n' } },
      checks: [{ type: 'fixtureUnchanged' }],
      graderCriteria: ['Refuses incomplete work.'],
      requireLocalChecks: true,
      semanticJudge: true,
      budgets: { timeoutMs: 5000, maxTurns: 1, maxCostUsd: 0.25 },
    }, 'fictional contract'),
    /timeoutMs.*claudeMaxCostUsd|unsupported budget/i,
  );
});

test('rejects positive response keywords when semantic judging owns meaning', () => {
  assert.throws(
    () => validateContract({
      id: 'keyword-surrogate',
      skill: 'nectar-shape',
      prompt: 'Choose the correct evidence.',
      fixture: { files: { 'src/example.js': 'export const value = 1;\n' } },
      checks: [
        { type: 'fixtureUnchanged' },
        { type: 'responseIncludes', value: 'NO_NEW_TEST' },
      ],
      graderCriteria: ['Chooses the right evidence for the actual risk.'],
      requireLocalChecks: true,
      semanticJudge: true,
    }, 'keyword contract'),
    /positive response keywords.*semantic/i,
  );
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

test('preserves auditable actor-response artifacts on normalized results', () => {
  const actorResponse = 'auditable response';
  const artifacts = {
    actorResponse,
    actorResponseSha256: crypto.createHash('sha256').update(actorResponse).digest('hex'),
  };
  const result = normalizeResult({
    host: 'codex',
    caseId: 'auditable-result',
    passed: true,
    score: 1,
    evidence: ['semantic and final-state pass'],
    artifacts,
  });

  assert.deepEqual(result.artifacts, artifacts);

  assert.throws(
    () => normalizeResult({
      host: 'codex',
      caseId: 'mismatched-audit-result',
      passed: true,
      score: 1,
      evidence: ['semantic and final-state pass'],
      artifacts: { actorResponse, actorResponseSha256: 'a'.repeat(64) },
    }),
    /does not match actorResponse/i,
  );
});
