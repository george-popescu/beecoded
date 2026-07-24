function finiteNonNegative(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a finite non-negative number`);
  }
  return value;
}

function normalizePath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\/+/, '');
}

function estimateContextTokens(characters) {
  return Math.ceil(characters / 4);
}

export function evaluateAtlasPacket({
  packet,
  expectedPaths = [],
  elapsedMs,
  baselineFilesRead,
  baselineContextCharacters,
  incrementalRefreshMs = null,
  firstRelevantMs = undefined,
}) {
  if (!packet || !Array.isArray(packet.evidence)) {
    throw new TypeError('packet must contain an evidence array');
  }
  const duration = finiteNonNegative(elapsedMs, 'elapsedMs');
  const baselineFiles = finiteNonNegative(baselineFilesRead, 'baselineFilesRead');
  const baselineCharacters = finiteNonNegative(
    baselineContextCharacters,
    'baselineContextCharacters',
  );
  const refreshDuration = incrementalRefreshMs === null
    ? null
    : finiteNonNegative(incrementalRefreshMs, 'incrementalRefreshMs');
  const expected = new Set(expectedPaths.map(normalizePath).filter(Boolean));
  const evidencePaths = packet.evidence.map((entry) => normalizePath(entry.path));
  const uniqueEvidencePaths = new Set(evidencePaths.filter(Boolean));
  const relevant = expected.size === 0
    ? new Set()
    : new Set(evidencePaths.filter((filePath) => expected.has(filePath)));
  const packetCharacters = JSON.stringify(packet).length;
  const measuredFirstRelevant = firstRelevantMs === undefined
    ? (relevant.size > 0 ? duration : null)
    : firstRelevantMs === null
      ? null
      : finiteNonNegative(firstRelevantMs, 'firstRelevantMs');
  const estimatedPacketTokens = estimateContextTokens(packetCharacters);

  return {
    recallAtK: expected.size === 0 ? null : relevant.size / expected.size,
    firstRelevantMs: relevant.size > 0 ? measuredFirstRelevant : null,
    evidenceCount: packet.evidence.length,
    packetCharacters,
    estimatedPacketTokens,
    estimatedFilesAvoided: Math.max(baselineFiles - uniqueEvidencePaths.size, 0),
    incrementalRefreshMs: refreshDuration,
    truncated: Boolean(packet.truncated),
    fallback: Boolean(packet.fallback || packet.state === 'fallback'),
  };
}

export function createAtlasEvaluationReport({
  caseId,
  expectedPaths,
  baseline,
  atlas,
}) {
  if (typeof caseId !== 'string' || !caseId.trim()) {
    throw new TypeError('caseId must be a non-empty string');
  }
  if (typeof baseline?.succeeded !== 'boolean' || typeof atlas?.succeeded !== 'boolean') {
    throw new TypeError('baseline and atlas runs require a succeeded boolean');
  }
  const baselineFirstRelevant = baseline.firstRelevantMs === null
    ? null
    : finiteNonNegative(baseline.firstRelevantMs, 'baseline.firstRelevantMs');
  const atlasMetrics = evaluateAtlasPacket({
    packet: atlas.packet,
    expectedPaths,
    elapsedMs: atlas.elapsedMs,
    baselineFilesRead: baseline.filesRead,
    baselineContextCharacters: baseline.contextCharacters,
    incrementalRefreshMs: atlas.incrementalRefreshMs ?? null,
    firstRelevantMs: atlas.firstRelevantMs,
  });
  const atlasFilesRead = finiteNonNegative(atlas.filesRead, 'atlas.filesRead');
  const atlasContextCharacters = finiteNonNegative(
    atlas.contextCharacters,
    'atlas.contextCharacters',
  );
  const baselineFilesRead = finiteNonNegative(baseline.filesRead, 'baseline.filesRead');
  const baselineContextCharacters = finiteNonNegative(
    baseline.contextCharacters,
    'baseline.contextCharacters',
  );
  const baselineEstimatedContextTokens = estimateContextTokens(
    baselineContextCharacters,
  );
  const atlasEstimatedContextTokens = estimateContextTokens(
    atlasContextCharacters,
  );

  return {
    schema: 1,
    tokenEstimation: {
      approximate: true,
      method: 'ceil(characters / 4)',
    },
    caseId: caseId.trim(),
    expectedPaths: [...new Set(expectedPaths.map(normalizePath).filter(Boolean))].sort(),
    baseline: {
      ...(baseline.method ? { method: String(baseline.method) } : {}),
      succeeded: baseline.succeeded,
      firstRelevantMs: baselineFirstRelevant,
      ...(Number.isFinite(baseline.matchedFiles)
        ? { matchedFiles: baseline.matchedFiles }
        : {}),
      filesRead: baselineFilesRead,
      ...(Number.isFinite(baseline.retrievalCharacters)
        ? { retrievalCharacters: baseline.retrievalCharacters }
        : {}),
      ...(Number.isFinite(baseline.sourceVerificationCharacters)
        ? { sourceVerificationCharacters: baseline.sourceVerificationCharacters }
        : {}),
      contextCharacters: baselineContextCharacters,
      estimatedContextTokens: baselineEstimatedContextTokens,
    },
    atlas: {
      succeeded: atlas.succeeded,
      filesRead: atlasFilesRead,
      ...(Number.isFinite(atlas.sourceVerificationCharacters)
        ? { sourceVerificationCharacters: atlas.sourceVerificationCharacters }
        : {}),
      contextCharacters: atlasContextCharacters,
      estimatedContextTokens: atlasEstimatedContextTokens,
      ...atlasMetrics,
    },
    comparison: {
      sameTaskOutcome: baseline.succeeded === atlas.succeeded,
      firstRelevantMsSaved: baselineFirstRelevant === null
        || atlasMetrics.firstRelevantMs === null
        ? null
        : baselineFirstRelevant - atlasMetrics.firstRelevantMs,
      filesReadSaved: baselineFilesRead - atlasFilesRead,
      contextCharactersSaved: baselineContextCharacters - atlasContextCharacters,
      estimatedContextTokensSaved: (
        baselineEstimatedContextTokens - atlasEstimatedContextTokens
      ),
    },
  };
}
