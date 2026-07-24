import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const workerModuleUrl = pathToFileURL(
  path.join(currentDirectory, "parse-worker.mjs"),
).href;

test("starts parser workers from an inline ESM host", () => {
  const script = `
    import { parseFilesInWorkerPool } from ${JSON.stringify(workerModuleUrl)};

    const result = await parseFilesInWorkerPool([{
      path: "src/inline-host.ts",
      tier: "ast+fts",
      content: "export const inlineWorkerToken = true;\\n",
    }], { concurrency: 1 });

    process.stdout.write(JSON.stringify({
      status: result.records[0].status,
      symbols: result.records[0].symbols.map((symbol) => symbol.name),
      workerThreadIds: result.threadIds,
    }));
  `;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", script],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.status, "parsed");
  assert.deepEqual(result.symbols, ["inlineWorkerToken"]);
  assert.equal(result.workerThreadIds.length, 1);
  assert.equal(Number.isInteger(result.workerThreadIds[0]), true);
  assert.equal(result.workerThreadIds[0] > 0, true);
});
