import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plan = fs.readFileSync(
  path.join(pluginRoot, 'internal-skills/nectar-plan/SKILL.md'),
  'utf8',
);

const planClasses = [
  'PLAN_CORRECTNESS_DEFECT',
  'PLAN_COVERAGE_GAP',
  'PLAN_DEPENDENCY_DEFECT',
  'PLAN_VERIFICATION_GAP',
  'PLAN_SCOPE_DEFECT',
  'PLAN_QUALITY_IMPROVEMENT',
  'PLAN_STYLE',
];

test('plan self-review keeps all seven plan-only finding classes', () => {
  for (const planClass of planClasses) {
    assert.match(plan, new RegExp(`\\b${planClass}\\b`), `${planClass} missing from plan taxonomy`);
  }
  assert.match(plan, /plan findings.*never `CODE_DEFECT`/i);
});

test('every plan finding carries explicit risk and convergence fields', () => {
  for (const field of [
    'Class',
    'Where',
    'Evidence',
    'Preconditions',
    'Probability',
    'Impact',
    'Solution opportunity',
    'Confidence',
    'Convergence',
  ]) {
    assert.match(plan, new RegExp(`\\*\\*${field}:\\*\\*`), `${field} missing from plan finding format`);
  }

  for (const planClass of planClasses) {
    assert.match(
      plan,
      new RegExp(`Plan findings: ${planClass} Critical N, High N, Medium N, Low N`),
      `${planClass} missing from parseable plan summary`,
    );
  }
  assert.match(plan, /Plan blocking:/);
  assert.match(plan, /Plan non-blocking:/);
  assert.match(plan, /group.*class.*severity/is);
});

test('plan self-review is one read-only classification pass owned by its caller', () => {
  assert.match(plan, /single classification pass/i);
  assert.match(plan, /do not revise.*draft/i);
  assert.match(plan, /do not.*re-run.*self-review/i);
  assert.match(plan, /caller.*decides.*revision.*another pass/is);

  assert.doesNotMatch(plan, /Fix blocking plan defects inline/i);
  assert.doesNotMatch(plan, /Revise until approved/i);
});
