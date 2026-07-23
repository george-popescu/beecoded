#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'load-context.sh');
let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${name}`);
  } else {
    failed++;
    console.log(`  FAIL: ${name}`);
  }
}

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-load-context-'));
  fs.mkdirSync(path.join(root, '.bee'), { recursive: true });
  return root;
}

function run(root) {
  return spawnSync('bash', [SCRIPT], {
    cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: 'utf8',
  });
}

const source = fs.readFileSync(SCRIPT, 'utf8');
assert(!source.includes('rejectSymlinks(root)'), 'SessionStart does not recursively scan the entire .bee tree');
assert(source.includes("path.join('specs', slug, 'COMPACT-CONTEXT.md')"),
  'SessionStart validates the selected spec context path');
assert(!source.includes('for session_dir in'), 'SessionStart does not fork one parser per debug session');
assert(!source.includes('for debug_file in'), 'SessionStart does not fork one parser per legacy debug file');

{
  const root = project();
  const bee = path.join(root, '.bee');
  fs.writeFileSync(path.join(bee, 'STATE.md'),
    '# State\n\n## Current Spec\n- Name: Safe\n- Path: (none)\n- Status: NO_SPEC\n');
  const external = path.join(root, 'external-history');
  fs.mkdirSync(external);
  fs.mkdirSync(path.join(bee, 'archive'));
  fs.symlinkSync(external, path.join(bee, 'archive', 'old'));
  const result = run(root);
  assert(result.status === 0, 'unrelated archived history does not block SessionStart');
  assert(result.stdout.includes('## Bee Project State'), 'safe current state is still injected');
  assert(fs.lstatSync(path.join(bee, '.session-start')).isFile(), 'session marker is a regular file');
  fs.rmSync(root, { recursive: true, force: true });
}

{
  const root = project();
  const bee = path.join(root, '.bee');
  fs.mkdirSync(path.join(bee, 'debug', 'sessions', 'active-one'), { recursive: true });
  fs.mkdirSync(path.join(bee, 'debug', 'sessions', 'finished-one'), { recursive: true });
  fs.writeFileSync(path.join(bee, 'debug', 'legacy-active.md'), 'status: active\n');
  fs.writeFileSync(path.join(bee, 'debug', 'legacy-finished.md'), 'status: resolved\n');
  fs.writeFileSync(
    path.join(bee, 'debug', 'sessions', 'active-one', 'state.json'),
    JSON.stringify({ status: 'active' }),
  );
  fs.writeFileSync(
    path.join(bee, 'debug', 'sessions', 'finished-one', 'state.json'),
    JSON.stringify({ status: 'resolved' }),
  );
  const result = run(root);
  assert(result.stdout.includes('- active-one'), 'batched debug discovery reports active sessions');
  assert(!result.stdout.includes('- finished-one'), 'batched debug discovery omits inactive sessions');
  assert(result.stdout.includes('- legacy-active (legacy)'), 'batched debug discovery reports active legacy sessions');
  assert(!result.stdout.includes('- legacy-finished'), 'batched debug discovery omits inactive legacy sessions');
  fs.rmSync(root, { recursive: true, force: true });
}

{
  const root = project();
  const bee = path.join(root, '.bee');
  const externalState = path.join(root, 'external-state.md');
  fs.writeFileSync(externalState, 'EXTERNAL STATE MUST NOT LOAD\n');
  fs.symlinkSync(externalState, path.join(bee, 'STATE.md'));
  const result = run(root);
  assert(result.status === 0, 'unsafe top-level state fails closed without crashing the hook');
  assert(!result.stdout.includes('EXTERNAL STATE'), 'symlinked STATE.md is never injected');
  assert(!fs.existsSync(path.join(bee, '.session-start')), 'unsafe state prevents marker writes');
  fs.rmSync(root, { recursive: true, force: true });
}

{
  const root = project();
  const bee = path.join(root, '.bee');
  fs.writeFileSync(path.join(bee, 'STATE.md'),
    '# State\n\n## Current Spec\n- Name: Alpha\n- Path: .bee/specs/alpha/\n- Status: IN_PROGRESS\n');
  fs.writeFileSync(path.join(bee, 'specs.json'), JSON.stringify({
    specs: [{
      slug: 'alpha',
      title: 'Alpha',
      stage: 'planning',
      location: 'in-place',
      created: '2026-07-17T00:00:00Z',
      last_touched: '2026-07-17T00:00:00Z',
    }],
  }));
  fs.mkdirSync(path.join(bee, 'specs', 'alpha'), { recursive: true });
  const externalContext = path.join(root, 'external-context.md');
  fs.writeFileSync(externalContext, 'EXTERNAL CONTEXT MUST NOT LOAD\n');
  fs.symlinkSync(externalContext, path.join(bee, 'specs', 'alpha', 'COMPACT-CONTEXT.md'));
  const result = run(root);
  assert(result.status === 0, 'unsafe selected context fails closed without crashing the hook');
  assert(!result.stdout.includes('EXTERNAL CONTEXT'), 'symlinked selected context is never injected');
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed ? 1 : 0);
