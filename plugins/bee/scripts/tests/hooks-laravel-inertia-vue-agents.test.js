#!/usr/bin/env node
// Test: claude.json does NOT have stale SubagentStop entries for nonexistent
// laravel-inertia-vue agents, and generic counterpart entries still exist.
// (The laravel-inertia-vue agent files were removed; hooks were cleaned up.)

const fs = require('fs');
const path = require('path');

const HOOKS_PATH = path.join(
  __dirname, '..', '..', 'hooks', 'claude.json'
);

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${testName}`);
  } else {
    failed++;
    console.log(`  FAIL: ${testName}`);
  }
}

// ============================================================
// Test 0: claude.json is valid JSON
// ============================================================
console.log('Test 0: claude.json is valid JSON');
let hooks;
try {
  const raw = fs.readFileSync(HOOKS_PATH, 'utf8');
  hooks = JSON.parse(raw);
  assert(true, 'claude.json parses as valid JSON');
} catch (e) {
  assert(false, `claude.json parses as valid JSON -- Error: ${e.message}`);
  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
  process.exit(1);
}

// ============================================================
// Test 1: Stale laravel-inertia-vue entries are REMOVED
// ============================================================
console.log('\nTest 1: Stale laravel-inertia-vue hook entries are removed');
const stopEntries = hooks.hooks.SubagentStop;
assert(Array.isArray(stopEntries), 'SubagentStop array exists');

const staleAgentNames = [
  'laravel-inertia-vue-bug-detector',
  'laravel-inertia-vue-pattern-reviewer',
  'laravel-inertia-vue-implementer',
];
for (const name of staleAgentNames) {
  const entry = stopEntries.find(e => e.matcher === name || e.matcher === `^${name}$`);
  assert(
    entry === undefined,
    `No stale hook entry for "${name}"`
  );
}

// ============================================================
// Test 2: Generic counterpart entries still exist
// ============================================================
console.log('\nTest 2: Generic counterpart rules still exist');
const dispatchSource = fs.readFileSync(
  path.join(__dirname, '..', 'hooks', 'validators', 'dispatch.js'),
  'utf8'
);
const genericBugDetectorFound = dispatchSource.includes('(?<!audit-)bug-detector$');
const genericPatternReviewerFound = dispatchSource.includes('pattern-reviewer$');
const genericImplementerFound = dispatchSource.includes('(?<!quick-)implementer$');

assert(genericBugDetectorFound, 'Generic bug-detector matched by a SubagentStop entry');
assert(genericPatternReviewerFound, 'Generic pattern-reviewer matched by a SubagentStop entry');
assert(genericImplementerFound, 'Generic implementer matched by a SubagentStop entry');

// ============================================================
// Test 3: No stale agent references anywhere in hooks
// ============================================================
console.log('\nTest 3: No stale references in claude.json');
const agentsDir = path.join(__dirname, '..', '..', 'agents');
const agentFiles = fs.readdirSync(agentsDir)
  .filter(f => f.endsWith('.md'))
  .map(f => f.replace('.md', ''));

for (const entry of stopEntries) {
  // The consolidated dispatcher has no matcher field.
  if (!entry.matcher) continue;
  // Extract agent name from matcher (strip ^ and $)
  const agentName = entry.matcher.replace(/^\^/, '').replace(/\$$/, '');
  // Check agent file exists (skip matchers that don't look like agent names)
  if (/^[a-z-]+$/.test(agentName)) {
    assert(
      agentFiles.includes(agentName),
      `Hook matcher "${entry.matcher}" has a corresponding agent file`
    );
  }
}

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
