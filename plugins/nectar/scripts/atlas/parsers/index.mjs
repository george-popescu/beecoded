import path from 'node:path';

const DEFAULT_LOADERS = Object.freeze({
  javascript: () => import('./javascript.mjs'),
  php: () => import('./php.mjs'),
});

function languageForPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (['.js', '.jsx', '.ts', '.tsx'].includes(extension)) return 'javascript';
  if (extension === '.php') return 'php';
  return null;
}

export function parserIdentityForPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (['.js', '.jsx', '.ts', '.tsx'].includes(extension)) {
    return `javascript:babel8:computed-v2:${extension.slice(1)}`;
  }
  if (extension === '.php') return 'php:php-parser3';
  return null;
}

function skippedRecord(file, language, reason) {
  return {
    path: file.path,
    language,
    status: 'skipped',
    reason,
    symbols: [],
    imports: [],
    exports: [],
    calls: [],
    inheritance: [],
    routeHints: [],
    testHints: [],
    failure: null,
  };
}

function failedRecord(file, language, error) {
  const line = error?.loc?.line ?? error?.lineNumber ?? null;
  return {
    path: file.path,
    language,
    status: 'failed',
    symbols: [],
    imports: [],
    exports: [],
    calls: [],
    inheritance: [],
    routeHints: [],
    testHints: [],
    failure: {
      kind: 'parse-error',
      message: String(error?.message || error).slice(0, 240),
      startLine: line,
      endLine: line,
    },
  };
}

function isTestPath(filePath) {
  return /(?:^|\/)__tests__(?:\/|$)/.test(filePath)
    || /\.(?:test|spec)\.[^.]+$/i.test(filePath)
    || /Test\.php$/i.test(filePath);
}

function javascriptSourcePath(testRecord, importedSource, sourcePaths) {
  if (!importedSource.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(testRecord.path), importedSource));
  const candidates = path.posix.extname(base)
    ? [base]
    : [
        base,
        ...['.js', '.jsx', '.ts', '.tsx'].map((extension) => `${base}${extension}`),
        ...['.js', '.jsx', '.ts', '.tsx'].map((extension) => `${base}/index${extension}`),
      ];
  return candidates.find((candidate) => sourcePaths.has(candidate)) || null;
}

export function attachTestRelationships(records, { additionalSources = [] } = {}) {
  const sourceRecords = records.filter(
    (record) => record.status === 'parsed' && !isTestPath(record.path),
  );
  const sourcePaths = new Set([
    ...sourceRecords.map((record) => record.path),
    ...additionalSources.map((source) => source.path),
  ]);
  const phpSymbols = new Map();
  for (const source of sourceRecords.filter((record) => record.language === 'php')) {
    for (const exported of source.exports) {
      const identity = exported.qualifiedName || exported.name;
      if (!phpSymbols.has(identity)) phpSymbols.set(identity, source.path);
    }
  }
  for (const source of additionalSources.filter((record) => record.language === 'php')) {
    for (const exported of source.exports || []) {
      const identity = exported.qualifiedName || exported.name;
      if (!phpSymbols.has(identity)) phpSymbols.set(identity, source.path);
    }
  }

  for (const record of records.filter(
    (candidate) => candidate.status === 'parsed' && isTestPath(candidate.path),
  )) {
    for (const imported of record.imports) {
      let sourcePath = null;
      if (record.language === 'javascript') {
        sourcePath = javascriptSourcePath(record, imported.source, sourcePaths);
      } else if (record.language === 'php') {
        sourcePath = phpSymbols.get(imported.source)
          || imported.names
            .map((name) => phpSymbols.get(name))
            .find(Boolean)
          || null;
      }
      if (!sourcePath) continue;
      if (record.testHints.some((hint) => hint.sourcePath === sourcePath)) continue;
      record.testHints.push({
        kind: 'source-test',
        sourcePath,
        testPath: record.path,
        startLine: imported.startLine,
        endLine: imported.endLine,
      });
    }
  }
}

export async function parseFiles(files, { loaders = DEFAULT_LOADERS } = {}) {
  const loaded = new Map();
  const records = [];

  for (const file of files) {
    const language = languageForPath(file.path);
    if (file.tier !== 'ast+fts') {
      records.push(skippedRecord(file, language, 'tier-not-ast'));
      continue;
    }
    if (!language) {
      records.push(skippedRecord(file, null, 'unsupported-language'));
      continue;
    }

    if (!loaded.has(language)) loaded.set(language, Promise.resolve(loaders[language]()));
    const parser = await loaded.get(language);
    try {
      records.push(await parser.parseFile(file));
    } catch (error) {
      records.push(failedRecord(file, language, error));
    }
  }

  attachTestRelationships(records);
  return records;
}
