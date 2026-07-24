export const KIBIBYTE = 1024;
export const MEBIBYTE = 1024 * KIBIBYTE;

export const CLASSIFICATION_SAMPLE_BYTES = 64 * KIBIBYTE;

export const CONTENT_TIERS = Object.freeze({
  AST_FTS: 'ast+fts',
  FTS_ONLY: 'fts-only',
  METADATA_ONLY: 'metadata-only',
});

export const DEFAULT_DISCOVERY_POLICY = Object.freeze({
  astMaxBytes: 512 * KIBIBYTE,
  ftsMaxBytes: 2 * MEBIBYTE,
  sampleBytes: CLASSIFICATION_SAMPLE_BYTES,
});

export const MANDATORY_EXCLUDED_DIRECTORIES = Object.freeze(new Set([
  '.cache',
  '.gradle',
  '.mypy_cache',
  '.nectar',
  '.next',
  '.nyc_output',
  '.parcel-cache',
  '.pytest_cache',
  '.turbo',
  '.vite',
  '__pycache__',
  'build',
  'cache',
  'caches',
  'coverage',
  'dist',
  'generated',
  'node_modules',
  'target',
  'vendor',
]));

export const LOCKFILE_NAMES = Object.freeze(new Set([
  'bun.lock',
  'bun.lockb',
  'cargo.lock',
  'composer.lock',
  'gemfile.lock',
  'go.sum',
  'npm-shrinkwrap.json',
  'package-lock.json',
  'pipfile.lock',
  'pnpm-lock.yaml',
  'podfile.lock',
  'poetry.lock',
  'yarn.lock',
]));
