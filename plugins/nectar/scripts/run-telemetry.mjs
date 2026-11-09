#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readTelemetry, readTelemetrySettings, recordNativeSnapshot, configureTelemetry, importTelemetry, exportTelemetry, pruneTelemetry, sendTelemetry,
  bindAttribution, summarizeAttribution, readPricing } from './telemetry/index.mjs';

const HELP = `Nectar telemetry (local metadata; collection is off until enabled)
  status [--project PATH] [--host codex|claude] [--session ID] [--json]
  enable | disable
  configure [--context true|false] [--band true|false] [--retention-days N|none] [--pricing-file PATH|none]
  link --host codex|claude --session ID --project PATH [--topic docs/work/TOPIC] [--skill nectar-NAME] [--scope session|next-interval]
  unlink --host codex|claude --session ID --project PATH
  summary --group topic|skill [--project PATH] [--host codex|claude] [--json]
  snapshot --host codex|claude --project PATH (bounded metadata JSON on stdin)
  import --host codex|claude --file PATH --project PATH [--pricing-file PATH]
  export --format json|csv|markdown [--project PATH] [--include-names]
  prune --before ISO_DATE
  send --url HTTPS_URL [--project PATH]
All commands accept --state-dir PATH. Webhooks use NECTAR_TELEMETRY_TOKEN only.
Import reads only the selected file and does not enable live collection.
Disable stops future collection, not retention; prune removes stored records.`;

export function parseTelemetryArguments(argv) {
  const [command = 'status', ...rest] = argv;
  const allowed = {
    status: ['project', 'host', 'session', 'json'], enable: [], disable: [], configure: ['context', 'band', 'retention-days', 'pricing-file'],
    link: ['host', 'session', 'project', 'topic', 'skill', 'scope', 'source'], unlink: ['host', 'session', 'project'],
    summary: ['group', 'project', 'host', 'json'],
    snapshot: ['host', 'project'], import: ['host', 'file', 'project', 'pricing-file'], export: ['format', 'project', 'include-names'],
    prune: ['before'], send: ['url', 'project'], help: [], '--help': [],
  };
  if (!Object.hasOwn(allowed, command)) throw new Error(`Unknown telemetry command: ${command}`);
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i].replace(/^--/, '');
    if (!rest[i].startsWith('--') || ![...allowed[command], 'state-dir'].includes(key) || Object.hasOwn(flags, key)) throw new Error(`Invalid or duplicate option: ${rest[i]}`);
    if (['json', 'include-names'].includes(key)) flags[key] = true;
    else {
      const next = rest[++i];
      if (!next || next.startsWith('--')) throw new Error(`Missing value for --${key}`);
      flags[key] = next;
    }
  }
  for (const key of { link: ['host', 'session', 'project'], unlink: ['host', 'session', 'project'], summary: ['group'],
    snapshot: ['host', 'project'], import: ['host', 'file', 'project'], export: ['format'], prune: ['before'], send: ['url'] }[command] ?? []) {
    if (!flags[key]) throw new Error(`--${key} is required`);
  }
  return { command, flags };
}

export async function runTelemetry(argv, { input } = {}) {
  const { command, flags } = parseTelemetryArguments(argv);
  const options = { stateDir: flags['state-dir'], projectRoot: flags.project };
  let result;
  switch (command) {
    case 'help': case '--help': return HELP;
    case 'status': result = readTelemetry({ ...options, host: flags.host, sessionId: flags.session }); break;
    case 'link': case 'unlink':
      if (command === 'link' && flags.topic === undefined && flags.skill === undefined) throw new Error('Specify --topic or --skill');
      result = bindAttribution({ host: flags.host, sessionId: flags.session, projectRoot: flags.project,
        topic: command === 'unlink' || flags.topic === 'none' ? null : flags.topic,
        skill: command === 'unlink' || flags.skill === 'none' ? null : flags.skill,
        scope: flags.scope, source: flags.source }, options); break;
    case 'summary': {
      const { segments } = readTelemetry({ ...options, host: flags.host });
      result = { group: flags.group, groups: summarizeAttribution(segments, { group: flags.group }),
        note: 'Attributed measurement intervals; unknown overlap and incomplete source coverage remain partial.' }; break;
    }
    case 'enable': case 'disable': result = configureTelemetry({ enabled: command === 'enable' }, options); break;
    case 'configure': {
      const patch = {};
      if (flags.context !== undefined) {
        if (!['true', 'false'].includes(flags.context)) throw new Error('--context must be true or false');
        patch.contextEnabled = flags.context === 'true';
      }
      if (flags.band !== undefined) {
        if (!['true', 'false'].includes(flags.band)) throw new Error('--band must be true or false');
        patch.bandEnabled = flags.band === 'true';
      }
      if (flags['retention-days'] !== undefined) patch.retentionDays = flags['retention-days'] === 'none' ? null : Number(flags['retention-days']);
      if (flags['pricing-file'] !== undefined) patch.pricing = flags['pricing-file'] === 'none' ? null : readPricing(flags['pricing-file']);
      if (!Object.keys(patch).length) throw new Error('Specify --context, --band or --retention-days');
      result = configureTelemetry(patch, options); break;
    }
    case 'snapshot': {
      if (!readTelemetrySettings(options).enabled) { result = { recorded: false, reason: 'collection-disabled' }; break; }
      let body = input ?? '';
      if (input === undefined) for await (const chunk of process.stdin) {
        body += chunk.toString('utf8');
        if (Buffer.byteLength(body) > 64 * 1024) throw new Error('Native snapshot exceeds 64 KiB');
      }
      if (Buffer.byteLength(body) > 64 * 1024) throw new Error('Native snapshot exceeds 64 KiB');
      let snapshot;
      try { snapshot = JSON.parse(body); } catch { throw new Error('Native snapshot must contain valid JSON'); }
      result = recordNativeSnapshot(snapshot, { ...options, host: flags.host }); break;
    }
    case 'import': result = await importTelemetry({ ...options, host: flags.host, file: flags.file, pricingFile: flags['pricing-file'] }); break;
    case 'export': return exportTelemetry({ ...options, format: flags.format, includeNames: !!flags['include-names'] });
    case 'prune': result = pruneTelemetry({ ...options, before: flags.before }); break;
    case 'send': result = await sendTelemetry({ ...options, url: flags.url }); break;
  }
  return JSON.stringify(result, null, 2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runTelemetry(process.argv.slice(2)).then(result => process.stdout.write(`${result}\n`)).catch(error => {
    // Never print HTTP headers, transcript records or raw provider errors containing credentials.
    process.stderr.write(`Nectar telemetry: ${error instanceof TypeError ? 'Invalid input or network request failed' : error.message}\n`);
    process.exitCode = 1;
  });
}
