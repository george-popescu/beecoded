import { spawn, spawnSync } from 'node:child_process';

const activeProcessTrees = new Set();
let cleanupHooksInstalled = false;

function killProcessTree(tree, signal) {
  if (!tree?.pid) return;
  if (process.platform !== 'win32' && tree.ownsProcessGroup) {
    try {
      process.kill(-tree.pid, signal);
      return;
    } catch {}
  }
  if (process.platform === 'win32') {
    const args = ['/pid', String(tree.pid), '/T'];
    if (signal === 'SIGKILL') args.push('/F');
    const result = spawnSync('taskkill', args, {
      stdio: 'ignore',
      windowsHide: true,
    });
    if (!result.error) return;
  }
  try { tree.child.kill(signal); } catch {}
}

function cleanupActiveProcessTrees() {
  for (const tree of activeProcessTrees) killProcessTree(tree, 'SIGKILL');
}

function installCleanupHooks() {
  if (cleanupHooksInstalled) return;
  cleanupHooksInstalled = true;
  process.once('exit', cleanupActiveProcessTrees);
  process.once('SIGINT', () => {
    cleanupActiveProcessTrees();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    cleanupActiveProcessTrees();
    process.exit(143);
  });
}

const SAFE_ENVIRONMENT_NAMES = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'NO_COLOR',
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
];

export function evalEnvironment(source = process.env) {
  const environment = {};
  const explicitlyAllowed = String(source.PLUGIN_EVAL_PASSTHROUGH_ENV || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  for (const name of [...SAFE_ENVIRONMENT_NAMES, ...explicitlyAllowed]) {
    if (source[name] !== undefined) environment[name] = source[name];
  }
  return environment;
}

export function runCommand(binary, args, options = {}) {
  const {
    encoding = 'utf8',
    input,
    maxBuffer = 10 * 1024 * 1024,
    timeout = 10 * 60 * 1000,
    killGraceMs = 1_000,
    ...spawnOptions
  } = options;

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let error = null;
    let settled = false;
    let child;
    let outputCapped = false;
    let timeoutTimer = null;
    let hardKillTimer = null;
    let ownsProcessGroup = false;
    let processTree = null;
    let terminating = false;
    let pendingClose = null;

    const finish = (status, signal = null) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (hardKillTimer && !terminating) clearTimeout(hardKillTimer);
      if (processTree) activeProcessTrees.delete(processTree);
      resolve({ status, signal, stdout, stderr, error });
    };
    const terminate = () => {
      if (terminating) return;
      terminating = true;
      outputCapped = true;
      killProcessTree(processTree, 'SIGTERM');
      hardKillTimer = setTimeout(() => {
        killProcessTree(processTree, 'SIGKILL');
        hardKillTimer = null;
        if (pendingClose) finish(pendingClose.status, pendingClose.signal);
      }, killGraceMs);
    };
    const append = (stream, chunk) => {
      if (outputCapped) return;
      const next = stream === 'stdout' ? stdout + chunk : stderr + chunk;
      if (Buffer.byteLength(next, encoding) > maxBuffer) {
        if (!error) {
          error = new Error(`${stream} maxBuffer length exceeded`);
          error.code = 'ENOBUFS';
        }
        outputCapped = true;
        terminate();
        return;
      }
      if (stream === 'stdout') stdout = next;
      else stderr = next;
    };

    try {
      ownsProcessGroup = process.platform !== 'win32' && spawnOptions.detached !== false;
      child = spawn(binary, args, {
        ...spawnOptions,
        detached: ownsProcessGroup,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (child.pid) {
        processTree = { child, pid: child.pid, ownsProcessGroup };
        activeProcessTrees.add(processTree);
        installCleanupHooks();
      }
    } catch (spawnError) {
      error = spawnError;
      finish(null);
      return;
    }

    child.stdout.setEncoding(encoding);
    child.stderr.setEncoding(encoding);
    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    // A CLI may reject arguments and exit before consuming a large prompt.
    // Its exit status/stderr are authoritative; an EPIPE while closing stdin
    // must not become an unhandled stream error that crashes the whole suite.
    child.stdin.on('error', () => {});
    child.on('error', (spawnError) => {
      if (!error) error = spawnError;
    });
    child.on('close', (status, signal) => {
      if (terminating && hardKillTimer) {
        pendingClose = { status, signal };
        return;
      }
      finish(status, signal);
    });

    if (Number.isFinite(timeout) && timeout > 0) {
      timeoutTimer = setTimeout(() => {
        if (!error) {
          error = new Error(`process timed out after ${timeout}ms`);
          error.code = 'ETIMEDOUT';
        }
        outputCapped = true;
        terminate();
      }, timeout);
    }
    if (input === undefined || input === null) child.stdin.end();
    else child.stdin.end(input, encoding);
  });
}
