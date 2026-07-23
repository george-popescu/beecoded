import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(pluginRoot, relative), 'utf8');

const lens = read('agents/lens.md');
const validator = read('agents/validator.md');
const review = read('internal-skills/nectar-review/SKILL.md');
const audit = read('internal-skills/nectar-audit/SKILL.md');

const findingClasses = [
  'CODE_DEFECT',
  'TEST_OR_COVERAGE_GAP',
  'TEST_DEFECT',
  'DOCUMENTATION_GAP',
  'MAINTAINABILITY',
  'STYLISTIC',
  'HARDENING_IDEA',
];

test('lens, validator, review, and audit share the complete finding taxonomy', () => {
  for (const source of [lens, validator, review, audit]) {
    for (const findingClass of findingClasses) assert.match(source, new RegExp('\\b' + findingClass + '\\b'));
  }
});

test('medium-or-higher findings of every class carry the complete risk record', () => {
  const riskFields = [
    'Class',
    'Runtime path',
    'Reachability',
    'Exposure/preconditions',
    'Likelihood',
    'Exploitability',
    'Impact',
    'Solution opportunity',
    'Confidence',
    'Convergence',
    'Disposition',
  ];

  for (const source of [lens, review, audit]) {
    for (const field of riskFields) {
      assert.match(source, new RegExp('\\*\\*' + field + ':\\*\\*'), field + ' missing from finding format');
    }
    assert.match(source, /Medium, High, and Critical.*regardless of class.*every field/is);
    assert.match(source, /Exploitability.*NOT_APPLICABLE.*non-security/is);
    assert.doesNotMatch(source, /Exploitability.*omit otherwise/is);
  }

  assert.match(validator, /For each finding, return:.*Exploitability/is);
});

test('validator traces live paths and may reclassify instead of only confirming', () => {
  assert.match(validator, /runtime API.*wired/i);
  assert.match(validator, /preconditions.*simultaneously satisfiable/i);
  assert.match(validator, /reclassif/i);
  assert.match(validator, /adjusted class/i);
  assert.match(validator, /likelihood.*confidence/is);
  assert.match(validator, /solution opportunity.*planned.*(?:replace|delete)/is);
});

test('only credible medium-or-higher code defects block convergence', () => {
  assert.match(review, /only.*CONFIRMED.*CODE_DEFECT.*(?:MEDIUM|medium).*(?:HIGH|high).*(?:CRITICAL|critical).*BLOCKING/is);
  assert.match(review, /LOW.*CODE_DEFECT.*NON_BLOCKING/is);
  assert.match(review, /non-code.*NON_BLOCKING/is);
  assert.doesNotMatch(review, /Fix CONFIRMED findings only/);
  assert.doesNotMatch(review, /zero CONFIRMED findings/);
});

test('review is one read-only classification pass and delegates all follow-up', () => {
  assert.match(review, /single.*read-only.*pass/is);
  assert.match(review, /never edit.*reviewed files/is);
  assert.match(review, /never.*(?:repair|fix).*loop/is);
  assert.match(review, /Recommended caller action:/);
  assert.doesNotMatch(review, /Bounded fix loop/i);
  assert.doesNotMatch(review, /three full rounds/i);
  assert.doesNotMatch(review, /round budget/i);
  assert.doesNotMatch(review, /Round [123]/i);
  assert.doesNotMatch(review, /re-review/i);
  assert.doesNotMatch(review, /new review run/i);
});

test('solution opportunity accounts for planned replacement or deletion', () => {
  for (const source of [lens, validator, review, audit]) {
    assert.match(source, /Solution opportunity.*planned.*(?:replace|delete)/is);
  }
});

test('reports expose parseable class and convergence totals', () => {
  for (const summaryLine of [
    'Confirmed code defects:',
    'Non-code findings:',
    'Blocking:',
    'Deferred:',
    'Stylistic:',
    'Refuted:',
  ]) assert.match(review, new RegExp(summaryLine));
  assert.match(review, /group.*class.*severity/is);
  assert.match(audit, /group.*class.*severity/is);
});
