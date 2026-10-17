import assert from 'node:assert/strict';

test('computed callee syntax is preserved rather than flattened into a static member', async () => {
  const { parseFile } = await import('./parsers/javascript.mjs');
  const parsed = parseFile({ path: 'dispatch.js', content: 'export function send(order) { channels[order.channel](order); channels["email"](order); channels?.[order.channel](order); }' });
  assert.deepEqual(parsed.calls.map((entry) => entry.name), [
    'channels[order.channel]', 'channels["email"]', 'channels?.[order.channel]',
  ]);
});
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

function fixture(relativePath) {
  return fs.readFileSync(path.join(currentDirectory, 'fixtures', relativePath), 'utf8');
}

async function loadRegistry() {
  try {
    return await import('./parsers/index.mjs');
  } catch (error) {
    assert.fail(`Atlas parser registry is not implemented: ${error.message}`);
  }
}

test('does not load language parsers for FTS-only or metadata-only files', async () => {
  const loaded = [];
  const { parseFiles } = await loadRegistry();

  const records = await parseFiles(
    [
      {
        path: 'src/medium.ts',
        tier: 'fts-only',
        content: 'export const medium = true;\n',
      },
      {
        path: 'src/large.php',
        tier: 'metadata-only',
        content: '<?php final class Large {}\n',
      },
    ],
    {
      loaders: {
        javascript: async () => {
          loaded.push('javascript');
          throw new Error('JavaScript parser must remain unloaded');
        },
        php: async () => {
          loaded.push('php');
          throw new Error('PHP parser must remain unloaded');
        },
      },
    },
  );

  assert.deepEqual(loaded, []);
  assert.deepEqual(
    records.map(({ path, status, reason }) => ({ path, status, reason })),
    [
      {
        path: 'src/medium.ts',
        status: 'skipped',
        reason: 'tier-not-ast',
      },
      {
        path: 'src/large.php',
        status: 'skipped',
        reason: 'tier-not-ast',
      },
    ],
  );
});

test('normalizes TSX and TypeScript structure with exact evidence line ranges', async () => {
  const { parseFiles } = await loadRegistry();
  const records = await parseFiles([
    {
      path: 'src/entry.tsx',
      tier: 'ast+fts',
      content: fixture('javascript/entry.tsx'),
    },
    {
      path: 'src/service.ts',
      tier: 'ast+fts',
      content: fixture('javascript/service.ts'),
    },
  ]);
  const [entry, service] = records;

  assert.deepEqual(
    Object.keys(entry).sort(),
    [
      'calls',
      'exports',
      'failure',
      'imports',
      'inheritance',
      'language',
      'path',
      'routeHints',
      'status',
      'symbols',
      'testHints',
    ],
  );
  assert.equal(entry.status, 'parsed');
  assert.equal(entry.language, 'javascript');
  assert.deepEqual(entry.imports, [
    {
      source: 'react',
      names: ['default:React'],
      startLine: 1,
      endLine: 1,
    },
    {
      source: './service',
      names: ['UserService'],
      startLine: 2,
      endLine: 2,
    },
  ]);
  assert.deepEqual(entry.symbols, [
    {
      kind: 'function',
      name: 'UserPage',
      startLine: 4,
      endLine: 8,
    },
    {
      kind: 'variable',
      name: 'userRoute',
      startLine: 10,
      endLine: 10,
    },
  ]);
  assert.deepEqual(entry.exports, [
    {
      kind: 'function',
      name: 'UserPage',
      startLine: 4,
      endLine: 8,
    },
    {
      kind: 'variable',
      name: 'userRoute',
      startLine: 10,
      endLine: 10,
    },
  ]);
  assert.deepEqual(entry.calls, [
    {
      name: 'UserService',
      startLine: 5,
      endLine: 5,
    },
    {
      name: 'service.loadUser',
      startLine: 6,
      endLine: 6,
    },
    {
      name: 'service.saveUser',
      startLine: 7,
      endLine: 7,
    },
  ]);
  assert.deepEqual(entry.routeHints, [
    {
      method: 'GET',
      path: '/users/:id',
      handler: 'UserPage',
      startLine: 10,
      endLine: 10,
    },
  ]);

  assert.equal(service.status, 'parsed');
  assert.deepEqual(service.symbols, [
    {
      kind: 'interface',
      name: 'Persistable',
      startLine: 1,
      endLine: 3,
    },
    {
      kind: 'class',
      name: 'UserService',
      startLine: 5,
      endLine: 13,
    },
    {
      kind: 'method',
      name: 'UserService.loadUser',
      startLine: 6,
      endLine: 8,
    },
    {
      kind: 'method',
      name: 'UserService.saveUser',
      startLine: 10,
      endLine: 12,
    },
  ]);
  assert.deepEqual(service.inheritance, [
    {
      symbol: 'UserService',
      relation: 'extends',
      target: 'BaseService',
      startLine: 5,
      endLine: 5,
    },
    {
      symbol: 'UserService',
      relation: 'implements',
      target: 'Persistable',
      startLine: 5,
      endLine: 5,
    },
  ]);
  assert.deepEqual(service.calls, [
    {
      name: 'fetchUser',
      startLine: 7,
      endLine: 7,
    },
    {
      name: 'persistUser',
      startLine: 11,
      endLine: 11,
    },
  ]);
});

test('preserves local and public identities for JavaScript reference exports', async () => {
  const { parseFiles } = await loadRegistry();
  const [record] = await parseFiles([
    {
      path: 'src/exports.js',
      tier: 'ast+fts',
      content: [
        'const aliasedLocal = true;',
        'const defaultLocal = true;',
        'export { aliasedLocal as publicAlias };',
        'export default defaultLocal;',
        'export const declarationExport = true;',
        '',
      ].join('\n'),
    },
  ]);

  assert.deepEqual(record.exports, [
    {
      kind: 'reference',
      name: 'publicAlias',
      localName: 'aliasedLocal',
      startLine: 3,
      endLine: 3,
    },
    {
      kind: 'reference',
      name: 'default',
      localName: 'defaultLocal',
      startLine: 4,
      endLine: 4,
    },
    {
      kind: 'variable',
      name: 'declarationExport',
      startLine: 5,
      endLine: 5,
    },
  ]);
});

test('normalizes PHP structure into the same evidence-located record contract', async () => {
  const { parseFiles } = await loadRegistry();
  const [controller, service] = await parseFiles([
    {
      path: 'app/Http/Controllers/Controller.php',
      tier: 'ast+fts',
      content: fixture('php/Controller.php'),
    },
    {
      path: 'app/Services/Service.php',
      tier: 'ast+fts',
      content: fixture('php/Service.php'),
    },
  ]);

  assert.deepEqual(Object.keys(controller).sort(), [
    'calls',
    'exports',
    'failure',
    'imports',
    'inheritance',
    'language',
    'path',
    'routeHints',
    'status',
    'symbols',
    'testHints',
  ]);
  assert.equal(controller.status, 'parsed');
  assert.equal(controller.language, 'php');
  assert.deepEqual(controller.imports, [
    {
      source: 'App\\Services\\UserService',
      names: ['UserService'],
      startLine: 5,
      endLine: 5,
    },
  ]);
  assert.deepEqual(controller.symbols, [
    {
      kind: 'class',
      name: 'UserController',
      startLine: 7,
      endLine: 13,
    },
    {
      kind: 'method',
      name: 'UserController.show',
      startLine: 9,
      endLine: 12,
    },
  ]);
  assert.deepEqual(controller.exports, [
    {
      kind: 'class',
      name: 'UserController',
      qualifiedName: 'App\\Http\\Controllers\\UserController',
      startLine: 7,
      endLine: 13,
    },
  ]);
  assert.deepEqual(controller.calls, [
    {
      name: 'service.loadUser',
      startLine: 11,
      endLine: 11,
    },
    {
      name: 'Route.get',
      startLine: 15,
      endLine: 15,
    },
  ]);
  assert.deepEqual(controller.inheritance, [
    {
      symbol: 'UserController',
      relation: 'extends',
      target: 'BaseController',
      startLine: 7,
      endLine: 7,
    },
  ]);
  assert.deepEqual(controller.routeHints, [
    {
      method: 'GET',
      path: '/users/{id}',
      handler: 'UserController.show',
      startLine: 15,
      endLine: 15,
    },
  ]);

  assert.deepEqual(service.symbols, [
    {
      kind: 'interface',
      name: 'Persistable',
      startLine: 5,
      endLine: 8,
    },
    {
      kind: 'method',
      name: 'Persistable.saveUser',
      startLine: 7,
      endLine: 7,
    },
    {
      kind: 'class',
      name: 'UserService',
      startLine: 10,
      endLine: 21,
    },
    {
      kind: 'method',
      name: 'UserService.loadUser',
      startLine: 12,
      endLine: 15,
    },
    {
      kind: 'method',
      name: 'UserService.saveUser',
      startLine: 17,
      endLine: 20,
    },
  ]);
  assert.deepEqual(service.inheritance, [
    {
      symbol: 'UserService',
      relation: 'extends',
      target: 'BaseService',
      startLine: 10,
      endLine: 10,
    },
    {
      symbol: 'UserService',
      relation: 'implements',
      target: 'Persistable',
      startLine: 10,
      endLine: 10,
    },
  ]);
  assert.deepEqual(service.calls, [
    {
      name: 'fetchUser',
      startLine: 14,
      endLine: 14,
    },
    {
      name: 'persistUser',
      startLine: 19,
      endLine: 19,
    },
  ]);
});

test('skips anonymous PHP class identities while traversing their bodies', async () => {
  const { parseFiles } = await loadRegistry();
  const [record] = await parseFiles([
    {
      path: 'app/Facades/Sms.php',
      tier: 'ast+fts',
      content: [
        '<?php',
        'use App\\Contracts\\BaseFake;',
        '$plain = new class {',
        '    public function run() { return plainHelper(); }',
        '};',
        '$extended = new class extends BaseFake {',
        '    public function run() { return extendedHelper(); }',
        '};',
        '',
      ].join('\n'),
    },
  ]);

  assert.equal(record.status, 'parsed');
  assert.deepEqual(record.symbols, []);
  assert.deepEqual(record.exports, []);
  assert.deepEqual(record.inheritance, []);
  assert.deepEqual(record.imports, [
    {
      source: 'App\\Contracts\\BaseFake',
      names: ['BaseFake'],
      startLine: 2,
      endLine: 2,
    },
  ]);
  assert.deepEqual(record.calls, [
    {
      name: 'plainHelper',
      startLine: 4,
      endLine: 4,
    },
    {
      name: 'extendedHelper',
      startLine: 7,
      endLine: 7,
    },
  ]);
});

test('links JavaScript and PHP tests to source files through import evidence', async () => {
  const { parseFiles } = await loadRegistry();
  const records = await parseFiles([
    {
      path: 'src/service.ts',
      tier: 'ast+fts',
      content: fixture('javascript/service.ts'),
    },
    {
      path: 'src/service.test.ts',
      tier: 'ast+fts',
      content: fixture('javascript/service.test.ts'),
    },
    {
      path: 'app/Services/Service.php',
      tier: 'ast+fts',
      content: fixture('php/Service.php'),
    },
    {
      path: 'tests/ControllerTest.php',
      tier: 'ast+fts',
      content: fixture('php/ControllerTest.php'),
    },
  ]);
  const javascriptTest = records.find((record) => record.path === 'src/service.test.ts');
  const phpTest = records.find((record) => record.path === 'tests/ControllerTest.php');

  assert.deepEqual(javascriptTest.testHints, [
    {
      kind: 'source-test',
      sourcePath: 'src/service.ts',
      testPath: 'src/service.test.ts',
      startLine: 1,
      endLine: 1,
    },
  ]);
  assert.deepEqual(phpTest.testHints, [
    {
      kind: 'source-test',
      sourcePath: 'app/Services/Service.php',
      testPath: 'tests/ControllerTest.php',
      startLine: 5,
      endLine: 5,
    },
  ]);
});

test('links PHP tests by fully qualified imports across duplicate basenames and aliases', async () => {
  const { parseFiles } = await loadRegistry();
  const records = await parseFiles([
    {
      path: 'app/A/Service.php',
      tier: 'ast+fts',
      content: '<?php namespace App\\A; final class Service {}\n',
    },
    {
      path: 'app/B/Service.php',
      tier: 'ast+fts',
      content: '<?php namespace App\\B; final class Service {}\n',
    },
    {
      path: 'tests/UnaliasedTest.php',
      tier: 'ast+fts',
      content: [
        '<?php namespace Tests;',
        'use App\\B\\Service;',
        'final class UnaliasedTest { public function test(): void { new Service(); } }',
        '',
      ].join('\n'),
    },
    {
      path: 'tests/AliasedTest.php',
      tier: 'ast+fts',
      content: [
        '<?php namespace Tests;',
        'use App\\B\\Service as TargetService;',
        'final class AliasedTest { public function test(): void { new TargetService(); } }',
        '',
      ].join('\n'),
    },
  ]);

  for (const testPath of [
    'tests/UnaliasedTest.php',
    'tests/AliasedTest.php',
  ]) {
    assert.deepEqual(
      records.find((record) => record.path === testPath).testHints,
      [{
        kind: 'source-test',
        sourcePath: 'app/B/Service.php',
        testPath,
        startLine: 2,
        endLine: 2,
      }],
    );
  }
});

test('bounds a malformed file failure and continues parsing the batch', async () => {
  const { parseFiles } = await loadRegistry();
  const [broken, service] = await parseFiles([
    {
      path: 'src/broken.ts',
      tier: 'ast+fts',
      content: fixture('malformed/broken.ts'),
    },
    {
      path: 'src/service.ts',
      tier: 'ast+fts',
      content: fixture('javascript/service.ts'),
    },
  ]);

  assert.equal(broken.status, 'failed');
  assert.deepEqual(broken.symbols, []);
  assert.deepEqual(broken.imports, []);
  assert.deepEqual(broken.exports, []);
  assert.deepEqual(broken.calls, []);
  assert.deepEqual(broken.inheritance, []);
  assert.deepEqual(broken.routeHints, []);
  assert.deepEqual(broken.testHints, []);
  assert.equal(broken.failure.kind, 'parse-error');
  assert.equal(broken.failure.startLine, 1);
  assert.equal(broken.failure.endLine, 1);
  assert.match(broken.failure.message, /Unexpected token/);
  assert.ok(broken.failure.message.length <= 240);
  assert.equal(broken.failure.message.includes(fixture('malformed/broken.ts')), false);

  assert.equal(service.status, 'parsed');
  assert.equal(
    service.symbols.some((symbol) => symbol.name === 'UserService'),
    true,
  );
});
