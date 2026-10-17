import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evalEnvironment } from './process.mjs';

const owned = new Set();
let registered = false;
const selectionKeys = new Set(['model', 'model_provider', 'model_reasoning_effort',
  'model_reasoning_summary', 'model_verbosity', 'service_tier']);

function register(root) {
  owned.add(root);
  if (registered) return;
  registered = true;
  const cleanup = () => {
    for (const directory of owned) fs.rmSync(directory, { recursive: true, force: true });
    owned.clear();
  };
  process.once('exit', cleanup);
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    process.once(signal, () => { cleanup(); process.exit(code); });
  }
}

function normalFile(file) {
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Evaluation host input must be a regular file.');
  return fs.readFileSync(file, 'utf8');
}

// Retain only scalar model choices. Do not carry profiles, instructions, hooks,
// skills, plugins, trust records, MCPs or provider commands into either arm.
export function selectCodexConfig(content = '') {
  const selected = [];
  const values = {};
  let section = '';
  let multiline = null;
  for (const line of content.split(/\r?\n/)) {
    if (multiline) {
      if (line.includes(multiline)) multiline = null;
      continue;
    }
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^\s*\[/.test(line)) { section = line.trim(); continue; }
    const match = line.match(/^\s*([a-z_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const delimiter = match[2].startsWith('"""') ? '"""' : match[2].startsWith("'''") ? "'''" : null;
    if (delimiter && !match[2].slice(3).includes(delimiter)) multiline = delimiter;
    if (section) continue;
    if (match[1] === 'profile') throw new Error('Isolated evaluation requires explicit scalar model settings rather than an active profile.');
    if (!selectionKeys.has(match[1])) continue;
    if (!/^"[^"\r\n]*"\s*(?:#.*)?$/.test(match[2])) {
      throw new Error('Evaluation model settings must be simple quoted strings.');
    }
    selected.push(`${match[1]} = ${match[2]}`);
    values[match[1]] = match[2].match(/^"([^"]*)"/)[1];
  }
  if (values.model_provider && values.model_provider !== 'openai') {
    throw new Error('Isolated evaluation does not yet support custom providers; no fallback model was selected.');
  }
  return { text: selected.join('\n') + '\n', settings: values };
}

export function createCodexIsolation({ source = process.env, temporaryRoot = os.tmpdir() } = {}) {
  // Separate from result directories: even keepTemp cannot retain credentials.
  const root = fs.mkdtempSync(path.join(temporaryRoot, 'nectar-eval-auth-'));
  fs.chmodSync(root, 0o700);
  register(root);
  const cleanup = () => {
    if (!owned.has(root)) return;
    fs.rmSync(root, { recursive: true, force: true });
    owned.delete(root);
  };
  try {
    const original = source.CODEX_HOME || path.join(source.HOME || os.homedir(), '.codex');
    const config = selectCodexConfig(normalFile(path.join(original, 'config.toml')) || '');
    const home = path.join(root, 'home');
    const codex = path.join(home, '.codex');
    fs.mkdirSync(codex, { recursive: true, mode: 0o700 });
    const auth = normalFile(path.join(original, 'auth.json'));
    const secrets = [];
    const collect = (value) => {
      if (typeof value === 'string' && value.length > 8) secrets.push(value);
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    if (auth !== null) {
      let parsed;
      try { parsed = JSON.parse(auth); } catch { throw new Error('Evaluation authentication file is invalid JSON.'); }
      collect(parsed);
    }
    if (auth !== null) fs.writeFileSync(path.join(codex, 'auth.json'), auth, { mode: 0o600 });
    fs.writeFileSync(path.join(codex, 'config.toml'), config.text, { mode: 0o600 });
    const env = evalEnvironment(source);
    // Explicit env passthrough cannot restore global agent configuration.
    for (const key of Object.keys(env)) {
      if (/^(?:CODEX|CLAUDE|XDG|ERA|NECTAR)_/.test(key) || key === 'HOME') delete env[key];
    }
    Object.assign(env, { HOME: home, CODEX_HOME: codex,
      CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
      XDG_CONFIG_HOME: path.join(home, '.config'), XDG_CACHE_HOME: path.join(home, '.cache') });
    for (const [key, value] of Object.entries(env)) {
      if (/TOKEN|SECRET|PASSWORD|API_KEY/.test(key) && value.length > 8) secrets.push(value);
    }
    const redact = (value) => secrets.reduce((text, secret) => text.replaceAll(secret, '<redacted>'), String(value || ''));
    return { env, settings: config.settings, redact, cleanup };
  } catch (error) { cleanup(); throw error; }
}

export function verificationEnvironment(root) {
  // No tokens, Node startup options, user config or ambient agent credentials.
  return { PATH: process.env.PATH || '', LANG: 'C', HOME: root,
    CODEX_HOME: path.join(root, '.codex'), XDG_CONFIG_HOME: path.join(root, '.config') };
}
