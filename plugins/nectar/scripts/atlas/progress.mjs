export const ATLAS_PROGRESS_STAGES = Object.freeze([
  'scanning',
  'classifying',
  'parsing',
  'graph',
  'persistence',
]);

export const ATLAS_PROGRESS_COUNT_KEYS = Object.freeze([
  'astFts',
  'ftsOnly',
  'metadataOnly',
  'reused',
  'skipped',
  'failed',
]);

const PROGRESS_STAGES = new Set(ATLAS_PROGRESS_STAGES);
const COUNT_KEYS = new Set(ATLAS_PROGRESS_COUNT_KEYS);
const ERROR_MESSAGE_LIMIT = 500;
const TERMINAL_CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g;
const OSC_SEQUENCE = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;
const CSI_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]/g;

function humanText(value) {
  return String(value)
    .replaceAll(OSC_SEQUENCE, '')
    .replaceAll(CSI_SEQUENCE, '')
    .replace(/\s+/g, ' ')
    .replaceAll(TERMINAL_CONTROLS, '')
    .trim();
}

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function initialCounts() {
  return Object.fromEntries(ATLAS_PROGRESS_COUNT_KEYS.map((key) => [key, 0]));
}

function progressPercentage(completed, total) {
  if (total === 0) return 0;
  return Math.min(100, Math.round((completed / total) * 100));
}

function boundedError(error) {
  const source = error instanceof Error
    ? error
    : new Error(typeof error === 'string' ? error : 'Atlas indexing failed');
  return {
    name: humanText(source.name || 'Error'),
    message: humanText(source.message).slice(0, ERROR_MESSAGE_LIMIT),
  };
}

function definedEntries(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

export function createAtlasProgress({
  total = 0,
  onEvent = () => {},
} = {}) {
  let sequence = 0;
  let finished = false;
  let completed = 0;
  let currentTotal = nonNegativeInteger(total, 'total');
  let counts = initialCounts();

  if (typeof onEvent !== 'function') {
    throw new Error('onEvent must be a function');
  }

  function ensureActive() {
    if (finished) throw new Error('Atlas progress is already finished');
  }

  function applyProgress({
    completed: nextCompleted = completed,
    total: nextTotal = currentTotal,
    counts: nextCounts = {},
  } = {}) {
    nonNegativeInteger(nextCompleted, 'completed');
    nonNegativeInteger(nextTotal, 'total');
    if (nextCompleted < completed) throw new Error('completed cannot decrease');
    if (nextTotal < currentTotal) throw new Error('total cannot decrease');

    const mergedCounts = { ...counts };
    for (const [key, value] of Object.entries(nextCounts)) {
      if (!COUNT_KEYS.has(key)) throw new Error(`Unknown Atlas progress count: ${key}`);
      nonNegativeInteger(value, key);
      if (value < counts[key]) throw new Error(`${key} cannot decrease`);
      mergedCounts[key] = value;
    }

    completed = nextCompleted;
    currentTotal = nextTotal;
    counts = mergedCounts;
  }

  function event(stage, type, terminal, extra = {}) {
    const value = {
      type,
      sequence: ++sequence,
      stage,
      terminal,
      progress: {
        completed,
        total: currentTotal,
        percent: progressPercentage(completed, currentTotal),
      },
      counts: { ...counts },
      ...extra,
    };
    onEvent(value);
    return value;
  }

  function update(stage, options = {}) {
    ensureActive();
    if (!PROGRESS_STAGES.has(stage)) {
      throw new Error(`Unknown Atlas progress stage: ${stage}`);
    }
    const { details, ...progress } = options;
    applyProgress(progress);
    return event(
      stage,
      'atlas-progress',
      false,
      details === undefined ? {} : { details },
    );
  }

  function finish(stage, options, error) {
    ensureActive();
    const {
      completed: nextCompleted,
      total: nextTotal,
      counts: nextCounts,
      commit,
      dirtyFiles,
      durationMs,
    } = options;
    const resolvedTotal = nextTotal ?? currentTotal;
    const resolvedCompleted = nextCompleted
      ?? (stage === 'complete' ? resolvedTotal : completed);
    applyProgress({
      completed: resolvedCompleted,
      total: resolvedTotal,
      ...(nextCounts === undefined ? {} : { counts: nextCounts }),
    });
    finished = true;

    const summary = definedEntries({
      status: stage === 'complete' ? 'complete' : 'failed',
      commit,
      dirtyFiles,
      durationMs,
      ...(stage === 'failed' ? { error: boundedError(error) } : {}),
    });
    return event(stage, 'atlas-summary', true, { summary });
  }

  return {
    update,
    complete(options = {}) {
      return finish('complete', options);
    },
    fail(error, options = {}) {
      return finish('failed', options, error);
    },
  };
}

function formatCounts(counts) {
  return [
    `ast+fts=${counts.astFts}`,
    `fts-only=${counts.ftsOnly}`,
    `metadata-only=${counts.metadataOnly}`,
    `reused=${counts.reused}`,
    `skipped=${counts.skipped}`,
    `failed=${counts.failed}`,
  ].join(' ');
}

function formatTextEvent(event) {
  const { completed, total, percent } = event.progress;
  const parts = [
    'atlas',
    event.stage,
    `${completed}/${total}`,
    `${percent}%`,
    formatCounts(event.counts),
  ];

  if (event.type === 'atlas-summary') {
    const { durationMs, commit, dirtyFiles, error } = event.summary;
    if (durationMs !== undefined) parts.push(`duration=${durationMs}ms`);
    if (commit !== undefined) parts.push(`commit=${commit}`);
    if (dirtyFiles !== undefined) {
      parts.push(`dirty=${Array.isArray(dirtyFiles) ? dirtyFiles.length : dirtyFiles}`);
    }
    if (error !== undefined) parts.push(`error=${error.name}:${error.message}`);
  }

  return parts.join(' ');
}

export function createAtlasProgressRenderer({
  stream = process.stderr,
  format = 'text',
} = {}) {
  if (!stream || typeof stream.write !== 'function') {
    throw new Error('stream must provide a write function');
  }
  if (!['json', 'text'].includes(format)) {
    throw new Error('format must be text or json');
  }

  return function renderAtlasProgress(event) {
    if (format === 'json') {
      stream.write(`${JSON.stringify(event)}\n`);
      return;
    }

    const line = formatTextEvent(event);
    if (stream.isTTY === true) {
      stream.write(`\r${line}\u001b[K${event.terminal ? '\n' : ''}`);
      return;
    }
    stream.write(`${line}\n`);
  };
}
