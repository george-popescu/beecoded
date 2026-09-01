#!/usr/bin/env node

import fs from 'node:fs';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  cancelPendingClosure,
  discoverCloseSupport,
  discoverCloseTopics,
  discoverReleaseBatch,
  finalizeClosureFromToken,
  inspectPendingClosure,
  prepareClosureFromToken,
  prepareReleaseBatchFromToken,
  recoverPendingClosure,
  sealPendingSupportFromToken,
} from './close-lifecycle.mjs';

function exact(args, count, usage) {
  if (args.length !== count) throw new Error(`usage: run-close.mjs ${usage}`);
}

export function runClose(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (command === 'discover') {
    exact(args, 0, 'discover');
    return discoverCloseTopics();
  }
  if (command === 'discover-support') {
    exact(args, 0, 'discover-support');
    return discoverCloseSupport();
  }
  if (command === 'discover-release-batch') {
    exact(args, 0, 'discover-release-batch');
    return discoverReleaseBatch();
  }
  if (command === 'inspect-pending') {
    exact(args, 0, 'inspect-pending');
    return inspectPendingClosure();
  }
  if (command === 'prepare-token') {
    if (args.length < 1) throw new Error('usage: run-close.mjs prepare-token <topic-token> [support-token ...]');
    return prepareClosureFromToken({ topicToken: args[0], supportTokens: args.slice(1) });
  }
  if (command === 'prepare-release-batch-token') {
    if (args.length < 1) throw new Error('usage: run-close.mjs prepare-release-batch-token <batch-token> [support-token ...]');
    return prepareReleaseBatchFromToken({ batchToken: args[0], supportTokens: args.slice(1) });
  }
  if (command === 'cancel-token') {
    exact(args, 1, 'cancel-token <pending-token>');
    return cancelPendingClosure({ pendingToken: args[0] });
  }
  if (command === 'seal-support-token') {
    exact(args, 1, 'seal-support-token <pending-token>');
    return sealPendingSupportFromToken({ pendingToken: args[0] });
  }
  if (command === 'finalize-token') {
    exact(args, 1, 'finalize-token <pending-token>');
    return finalizeClosureFromToken({ pendingToken: args[0] });
  }
  if (command === 'recover-token') {
    exact(args, 1, 'recover-token <pending-token>');
    return recoverPendingClosure({ pendingToken: args[0] });
  }
  throw new Error('usage: run-close.mjs discover|discover-support|discover-release-batch|inspect-pending|prepare-token|prepare-release-batch-token|seal-support-token|cancel-token|finalize-token|recover-token');
}

if (process.argv[1]
  && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.stdout.write(`${JSON.stringify(runClose(process.argv.slice(2)))}\n`);
  } catch (error) {
    process.stderr.write(`[nectar-close] ${error.message}\n`);
    process.exitCode = 1;
  }
}
