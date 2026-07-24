import os from "node:os";
import {
  isMainThread,
  parentPort,
  threadId,
  Worker,
} from "node:worker_threads";

import { parseFiles } from "./parsers/index.mjs";

export function defaultParserConcurrency() {
  return Math.min(4, Math.max(1, os.availableParallelism() - 1));
}

export function normalizeParserConcurrency(requested) {
  const ceiling = defaultParserConcurrency();
  if (requested === undefined) return ceiling;
  if (!Number.isInteger(requested) || requested <= 0) {
    throw new Error("parserConcurrency must be a positive integer");
  }
  return Math.min(requested, ceiling);
}

function workerExecArgv(execArgv = process.execArgv) {
  const compatible = [];
  for (let index = 0; index < execArgv.length; index += 1) {
    const argument = execArgv[index];
    if (argument === "--input-type") {
      index += 1;
      continue;
    }
    if (argument.startsWith("--input-type=")) continue;
    compatible.push(argument);
  }
  return compatible;
}

async function runWorkerTask(message) {
  try {
    const [record] = await parseFiles([message.file]);
    parentPort.postMessage({
      id: message.id,
      ok: true,
      record,
      threadId,
    });
  } catch (error) {
    parentPort.postMessage({
      id: message.id,
      ok: false,
      error: {
        name: error?.name || "Error",
        message: String(error?.message || error),
      },
      threadId,
    });
  }
}

if (!isMainThread && parentPort) {
  parentPort.on("message", runWorkerTask);
}

export function parseFilesInWorkerPool(files, options = {}) {
  const concurrency = normalizeParserConcurrency(options.concurrency);
  if (!Array.isArray(files))
    throw new Error("Atlas parser inputs must be an array");
  if (!files.length) {
    return Promise.resolve({
      records: [],
      concurrency,
      threadIds: [],
    });
  }

  const workerCount = Math.min(concurrency, files.length);
  const workers = Array.from(
    { length: workerCount },
    () =>
      new Worker(new URL(import.meta.url), {
        execArgv: workerExecArgv(),
      }),
  );

  return new Promise((resolve, reject) => {
    const records = new Array(files.length);
    const threadIds = new Set();
    let nextIndex = 0;
    let completed = 0;
    let settled = false;

    function stopWorkers() {
      return Promise.allSettled(workers.map((worker) => worker.terminate()));
    }

    function fail(error) {
      if (settled) return;
      settled = true;
      stopWorkers().finally(() => reject(error));
    }

    function complete() {
      if (settled || completed !== files.length) return;
      settled = true;
      stopWorkers().finally(() =>
        resolve({
          records,
          concurrency,
          threadIds: [...threadIds].sort((left, right) => left - right),
        }),
      );
    }

    function assign(worker) {
      if (nextIndex >= files.length) {
        complete();
        return;
      }
      const id = nextIndex;
      nextIndex += 1;
      worker.postMessage({ id, file: files[id] });
    }

    for (const worker of workers) {
      worker.on("message", (message) => {
        if (settled) return;
        if (!message.ok) {
          const error = new Error(message.error.message);
          error.name = message.error.name;
          fail(error);
          return;
        }
        records[message.id] = message.record;
        threadIds.add(message.threadId);
        completed += 1;
        assign(worker);
      });
      worker.on("error", fail);
      worker.on("exit", (code) => {
        if (!settled && completed < files.length && code !== 0) {
          fail(new Error(`Atlas parser worker exited with code ${code}`));
        }
      });
      assign(worker);
    }
  });
}
