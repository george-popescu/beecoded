import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// Run actor-produced modules without process, network, native imports or host
// credentials. The parent imposes a process timeout as well as VM timeouts.
export async function runOracle(root, source) {
  // Parent resolves the real root before applying filesystem permissions.
  const boundary = path.resolve(root);
  const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  const modules = new Map();
  async function load(relative) {
    const absolute = path.resolve(boundary, relative);
    const rel = path.relative(boundary, absolute);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Oracle import escapes fixture');
    let current = boundary;
    for (const part of rel.split(path.sep)) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Oracle refuses symlink imports');
    }
    if (modules.has(absolute)) return modules.get(absolute);
    const module = new vm.SourceTextModule(fs.readFileSync(absolute, 'utf8'), {
      context, identifier: absolute,
    });
    modules.set(absolute, module);
    return module;
  }
  const oracle = new vm.SourceTextModule(source.replace("import assert from 'node:assert/strict';", `
    const assert = {
      equal(actual, expected) { if (actual !== expected) throw new Error('Oracle equality failed'); },
      deepEqual(actual, expected) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Oracle value failed'); }
    };`).replace(/console\.log\([^\n]+\);/g, ''), {
    context, identifier: path.join(boundary, '__external_oracle__.mjs'),
  });
  await oracle.link(async (specifier, referencing) => {
    if (!specifier.startsWith('.')) throw new Error('Oracle refuses native or package imports');
    return load(path.relative(boundary, path.resolve(path.dirname(referencing.identifier), specifier)));
  });
  await oracle.evaluate({ timeout: 5000 });
  return true;
}
