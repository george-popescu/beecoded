#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { containsSymlink, isSecretFilename, mandatoryPathExclusionReason } from './atlas/paths.mjs';
import { redactDiagnostic } from './diagnostics.mjs';

const MAX_FILE_BYTES = 256 * 1024;
const MAX_FILES = 5000;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 1000;
const SOURCE = /\.(?:[cm]?[jt]sx?|php|py|rb|go|rs|java|kt|kts|swift|cs|[ch](?:pp)?|cc|m|mm|sh|bash|zsh|ps1|sql|lua|r|vue|svelte|html?|css|scss|sass|less|ya?ml|toml)$/i;
const MARKER = /^\s*(?:\/\/|#|\/\*+|\*|<!--|--)\s*(TODO|FIXME|shortcut)\b\s*:?\s*(.*?)\s*(?:\*\/|-->)?\s*$/i;

function readSource(root, relative) {
  if (mandatoryPathExclusionReason(relative) || relative.split(/[\\/]/).some(isSecretFilename)) return { skipped: 'excluded' };
  try {
    if (containsSymlink(root, relative)) return { skipped: 'symlink' };
    if (!fs.lstatSync(path.join(root, relative)).isFile()) return { skipped: 'not-file' };
    const fd = fs.openSync(path.join(root, relative), fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile()) return { skipped: 'not-file' };
      if (stat.size > MAX_FILE_BYTES) return { skipped: 'oversized' };
      const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
      const length = fs.readSync(fd, buffer, 0, buffer.length, 0);
      if (length > MAX_FILE_BYTES) return { skipped: 'oversized' };
      if (buffer.subarray(0, length).includes(0)) return { skipped: 'binary' };
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)), bytes: length };
    } finally { fs.closeSync(fd); }
  } catch { return { skipped: 'unreadable' }; }
}

function safeText(value) {
  return redactDiagnostic(value).replace(/\b(?:sk-[\w-]{16,}|gh[pousr]_[\w]{20,})\b/g, '<redacted>').slice(0, 500);
}

export function inspectDebt(projectRoot) {
  const requested = path.resolve(projectRoot);
  const stat = fs.lstatSync(requested);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Debt needs a normal project directory.');
  const root = fs.realpathSync(requested);
  const listed = spawnSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'], {
    cwd: root, encoding: 'utf8', timeout: 10_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (listed.error || listed.status !== 0) throw new Error('Could not obtain a bounded Git file inventory; select a Git worktree.');
  const files = [...new Set(listed.stdout.split('\0').filter(Boolean))].sort();
  const entries = [];
  const skipped = {};
  let bytesRead = 0;
  let filesRead = 0;
  let truncated = files.length > MAX_FILES;
  const skip = reason => { skipped[reason] = (skipped[reason] || 0) + 1; };
  const append = entry => {
    if (entries.length < MAX_ENTRIES) entries.push(entry);
    else truncated = true;
  };
  for (const relative of files.slice(0, MAX_FILES)) {
    if (!SOURCE.test(relative)) { skip('unsupported-format'); continue; }
    if (bytesRead + MAX_FILE_BYTES > MAX_TOTAL_BYTES) { truncated = true; break; }
    const source = readSource(root, relative);
    if (source.skipped) { skip(source.skipped); continue; }
    bytesRead += source.bytes;
    filesRead++;
    for (const [index, line] of source.text.split(/\r?\n/).entries()) {
      const match = line.match(MARKER);
      if (!match) continue;
      const text = safeText(match[2]);
      append({ origin: 'comment', path: relative, line: index + 1, marker: match[1].toLowerCase(), text,
        limit: text.match(/\blimit:\s*([^;]+)/i)?.[1]?.trim() || null,
        revisit: text.match(/\b(?:revisit|upgrade) when:\s*([^;]+)/i)?.[1]?.trim() || null });
    }
  }
  const backlogPath = 'docs/work/backlog.md';
  if (fs.existsSync(path.join(root, backlogPath))) {
    const backlog = readSource(root, backlogPath);
    if (backlog.skipped) skip(`backlog-${backlog.skipped}`);
    else for (const [index, line] of backlog.text.split(/\r?\n/).entries()) {
      if (/^-\s+\S/.test(line)) append({ origin: 'backlog', path: backlogPath, line: index + 1, marker: null, text: safeText(line.slice(2)), limit: null, revisit: null });
    }
  }
  return { version: 1, projectRoot: root, entries, filesRead, bytesRead, skipped, truncated,
    limitations: ['Candidates are not confirmed defects or a complete debt inventory.', 'Recognizes leading comment markers only; inline comments and unsupported languages may be missed.', 'Ignored source, secret filenames, symlinks, binaries and oversized files are excluded; the named backlog is read separately.', 'Limits: 5000 files, 256 KiB per file, 16 MiB source content, 1000 entries.'] };
}

export function runDebt({ argv = [], cwd = process.cwd() } = {}) {
  const args = argv[0] === 'debt' ? argv.slice(1) : argv;
  if (args.includes('--help') || args.includes('-h')) return { exitCode: 0, output: 'Usage: nectar debt [path] [--json]\nRead recorded comment candidates and the existing backlog; no writes.' };
  const paths = args.filter(arg => arg !== '--json');
  if (paths.length > 1 || paths.some(arg => arg.startsWith('-'))) return { exitCode: 2, output: '[nectar-debt] Expected one optional path and --json.' };
  try {
    const report = inspectDebt(path.resolve(cwd, paths[0] || '.'));
    return { exitCode: 0, report, output: args.includes('--json') ? JSON.stringify(report, null, 2) : [
      `Recorded candidates: ${report.entries.length}${report.truncated ? ' (bounded scan truncated)' : ''}`,
      ...report.entries.map(entry => `${entry.path}:${entry.line} [${entry.origin}${entry.marker ? `/${entry.marker}` : ''}] ${entry.text}`),
      ...report.limitations,
    ].join('\n') };
  } catch (error) { return { exitCode: 2, output: `[nectar-debt] ${redactDiagnostic(error.message)}` }; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runDebt({ argv: process.argv.slice(2) });
  console.log(result.output);
  process.exitCode = result.exitCode;
}
