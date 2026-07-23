import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(pluginRoot, relative), 'utf8');

const review = read('internal-skills/nectar-review/SKILL.md');
const honey = read('internal-skills/nectar-honey/SKILL.md');
const orient = read('internal-skills/nectar-orient/SKILL.md');
const readme = read('README.md');
const changelog = read('CHANGELOG.md');
const cleanMarker = /Clean pass: zero blocking code defects remain\./;

test('direct review is one read-only pass and owns no repair or repetition budget', () => {
  assert.match(review, /single[- ]pass/i);
  assert.match(review, /read-only/i);
  assert.match(review, /recommended caller action/i);
  assert.doesNotMatch(review, /bounded fix loop|at most three full rounds|rounds 1 and 2|round 3/i);
  assert.doesNotMatch(review, /apply (?:a )?fix|repair(?:s|ed)? automatically|re-review/i);
});

test('zero-blocker review emits the canonical clean marker consumed by status recovery', () => {
  assert.match(review, /Blocking: 0.*append.*exact final line.*Clean pass: zero blocking code defects remain\./is);
  assert.match(review, cleanMarker);
  assert.match(orient, cleanMarker);
  assert.match(honey, cleanMarker);
  assert.match(orient, /clean marker.*done/is);
});

test('Honey uses a default review maximum while allowing any positive user-selected maximum', () => {
  assert.match(honey, /freeze.*delivery scope/is);
  assert.match(honey, /same frozen (?:delivery )?scope/is);
  assert.match(honey, /default maximum.*three full review passes/is);
  assert.match(honey, /explicit.*positive integer.*review-pass maximum/is);
  assert.match(honey, /(?:1.*2.*greater than three|one.*two.*greater than three)/is);
  assert.doesNotMatch(honey, /N\s*>?=\s*3|below three.*default/is);
  assert.match(honey, /trivial- or quick-scale.*in-session.*frozen delivery scope.*completed pass count.*review-pass maximum/is);
  assert.match(honey, /single-pass review.*BLOCKING \+ FIX_NOW.*repair.*next review pass/is);
  assert.match(honey, /zero blocking code defects.*review-pass maximum.*reached/is);
});

test('Honey recovery restores its frozen scope and review-pass maximum', () => {
  assert.match(honey, /resume.*frozen delivery scope.*completed review-pass count.*review-pass maximum/is);
  assert.match(orient, /resume.*Honey.*frozen delivery scope.*completed review-pass count.*review-pass maximum/is);
  assert.doesNotMatch(orient, /finish the review until a clean pass/i);
  assert.match(orient, /run one single-pass review/i);
});

test('Honey uses the same permissive maximum rule for plan classification', () => {
  assert.match(honey, /plan-pass maximum.*default.*three/is);
  assert.match(honey, /explicit.*positive integer.*plan-pass maximum/is);
  assert.doesNotMatch(honey, /N\s*>?=\s*3|below three.*default/is);
  assert.match(honey, /completed plan-pass count.*plan-pass maximum.*Plan blocking/is);
  assert.match(honey, /Plan blocking: 0.*proceed to Build/is);
  assert.match(honey, /Plan blocking.*nonzero.*revise.*next.*single.*classification pass/is);
  assert.match(honey, /never advance to Build.*Plan blocking.*nonzero/is);
  assert.doesNotMatch(honey, /self-review replaces plan approval/i);
});

test('Honey and Orient resume the persisted plan budget without replenishing it', () => {
  assert.match(honey, /resume.*completed plan-pass count.*plan-pass maximum.*never.*replenish/is);
  assert.match(orient, /resume Honey.*plan.*completed plan-pass count.*plan-pass maximum/is);
  assert.match(orient, /never propose Build.*Plan blocking: 0/is);
});

test('public documentation distinguishes direct review from Honey orchestration', () => {
  assert.match(readme, /nectar-review[^\n]*single read-only pass/i);
  assert.match(readme, /direct review.*never edits.*never starts another pass/is);
  assert.match(readme, /Honey.*default maximum.*three full review passes/is);
  assert.match(readme, /explicit.*positive integer.*maximum/is);
  assert.doesNotMatch(readme, /N\s*>?=\s*3|below three.*default/is);
  assert.match(changelog, /single-pass, read-only review/is);
  assert.match(changelog, /Honey.*default.*three.*user.*positive integer/is);
});
