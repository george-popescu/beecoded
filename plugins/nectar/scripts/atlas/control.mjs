import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

import { indexRepository } from './indexer.mjs';
import { isSecretFilename, mandatoryPathExclusionReason } from './paths.mjs';
import { applyAtlasChoice, getAtlasPreference } from './preferences.mjs';
import { openAtlasRetrieval } from './retrieval-store.mjs';
import { openAtlasStore } from './store.mjs';

function positiveThreshold(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 100;
}

export function assessAtlasBenefit(projectRoot, options = {}) {
  const threshold = positiveThreshold(
    options.autoMinFiles ?? process.env.NECTAR_ATLAS_AUTO_MIN_FILES,
  );
  const result = spawnSync('git', [
    '--no-optional-locks',
    '-c',
    'core.fsmonitor=false',
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    if (result.error?.code === 'ENOBUFS') {
      return {
        state: 'ready',
        recommended: true,
        eligibleFiles: null,
        threshold,
        reason: `Project file list exceeds the ${threshold}-file recommendation threshold`,
      };
    }
    return {
      state: 'unknown',
      recommended: false,
      eligibleFiles: null,
      threshold,
      reason: 'Git file count is unavailable',
    };
  }
  const eligibleFiles = result.stdout.split('\0').filter(Boolean)
    .filter((filePath) => (
      !mandatoryPathExclusionReason(filePath)
      && !isSecretFilename(filePath)
    ))
    .length;
  return {
    state: 'ready',
    recommended: eligibleFiles >= threshold,
    eligibleFiles,
    threshold,
    reason: eligibleFiles >= threshold
      ? `Project has ${eligibleFiles} eligible files`
      : `Project has fewer than ${threshold} eligible files`,
  };
}

export function atlasStatus(projectRoot, options = {}) {
  const preference = getAtlasPreference(projectRoot, options);
  if (preference.state !== 'ready') return preference;
  const recommendation = assessAtlasBenefit(preference.repository.root, options);
  const retrieval = openAtlasRetrieval(projectRoot, {
    ...options,
    verifyIntegrity: true,
  });
  const index = retrieval.state === 'ready'
    ? { state: 'ready', freshness: retrieval.freshness, snapshot: retrieval.snapshot }
    : { state: 'absent', code: retrieval.code, reason: retrieval.reason };
  retrieval.close?.();
  return {
    state: 'ready',
    preference,
    recommendation,
    prompt: {
      required: preference.shouldPrompt && recommendation.recommended,
      reason: recommendation.reason,
      choices: ['enable', 'not-now', 'never'],
    },
    index,
  };
}

export async function enableAtlas(projectRoot, options = {}) {
  const current = getAtlasPreference(projectRoot, options);
  if (current.state !== 'ready') return current;
  const index = await indexRepository(projectRoot, options);
  const preference = applyAtlasChoice(projectRoot, 'enable', options);
  return {
    state: 'enabled',
    preference,
    index,
  };
}

export async function refreshAtlas(projectRoot, options = {}) {
  return indexRepository(projectRoot, options);
}

export function chooseAtlas(projectRoot, choice, options = {}) {
  return applyAtlasChoice(projectRoot, choice, options);
}

export function clearAtlas(projectRoot, options = {}) {
  const status = getAtlasPreference(projectRoot, options);
  if (status.state !== 'ready') return status;
  if (!fs.existsSync(status.repository.cachePath)) {
    return { state: 'cleared', removed: false };
  }
  const store = openAtlasStore(status.repository);
  try {
    return {
      state: 'cleared',
      removed: store.clearWorktree(status.repository.worktreeId),
    };
  } finally {
    store.close();
  }
}
