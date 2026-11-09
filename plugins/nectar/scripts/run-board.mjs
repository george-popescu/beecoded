#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildBoardData } from './board/data.mjs';

const HELP = `Generate a local, read-only snapshot of recorded work and usage.
nectar board [path] [--project <path>] [--output <file>] [--open] [--json]
Repeat --project for additional explicitly selected projects. --json writes only
to stdout. HTML is created at a new temporary path unless --output is supplied;
existing files are never overwritten. No tests, collection or imports are started.
--state-dir <path> selects a separate telemetry store for testing or portability.`;

export function parseBoardArguments(args, cwd = process.cwd()) {
  const options = { projectRoots: [], output: null, open: false, json: false, stateDir: undefined };
  let positional = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--open') options.open = true;
    else if (arg === '--json') options.json = true;
    else if (['--project', '--output', '--state-dir'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      if (arg === '--project') options.projectRoots.push(path.resolve(cwd, value));
      else options[arg === '--output' ? 'output' : 'stateDir'] = path.resolve(cwd, value);
    } else if (!arg.startsWith('-') && !positional) { options.projectRoots.push(path.resolve(cwd, arg)); positional = true; }
    else throw new Error(`Unknown Board argument: ${arg}`);
  }
  if (options.json && (options.open || options.output)) throw new Error('--json cannot be combined with --open or --output');
  if (!options.projectRoots.length) options.projectRoots.push(cwd);
  return options;
}

export async function runBoard(args, { cwd = process.cwd() } = {}) {
  const options = parseBoardArguments(args, cwd);
  if (options.help) return HELP;
  const data = buildBoardData(options);
  if (options.json) return JSON.stringify(data, null, 2);
  const { renderBoard } = await import('./board/render.mjs');
  const requested = options.output ?? path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-board-')), 'board.html');
  // Resolve platform aliases such as macOS /tmp, then create an exclusive new file.
  const output = path.join(fs.realpathSync(path.dirname(requested)), path.basename(requested));
  fs.writeFileSync(output, renderBoard(data), { flag: 'wx', mode: 0o600 });
  if (options.open) {
    const result = process.platform === 'win32'
      ? spawnSync('rundll32.exe', ['url.dll,FileProtocolHandler', output], { stdio: 'ignore' })
      : spawnSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [output], { stdio: 'ignore' });
    if (result.error || result.status !== 0) return `Board saved: ${output}\nCould not open the browser; open the file directly.`;
  }
  return `Board saved: ${output}\nSnapshot: ${data.generatedAt}. Recorded state is not a fresh verification.`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(await runBoard(process.argv.slice(2))); }
  catch (error) { console.error(`[nectar-board] ${error.message}`); process.exitCode = 1; }
}
