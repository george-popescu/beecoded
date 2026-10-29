#!/usr/bin/env node
// Opt-in paired review comparison. Same request, fixtures, model and graders;
// the baseline actor receives no Nectar instructions. No public artifacts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCodexCase } from '../plugins/nectar/scripts/evals/codex.mjs';
import { loadContracts } from '../plugins/nectar/scripts/evals/contracts.mjs';
import { runCommand } from '../plugins/nectar/scripts/evals/process.mjs';
import { selectCodexConfig } from '../plugins/nectar/scripts/evals/isolation.mjs';

export async function compareInspection({ binary = 'codex', repetitions = 2, execute = runCommand,
  caseIds = null, variants = ['baseline', 'skill'] } = {}) {
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 3
    || !variants.length || variants.some(v => !['baseline', 'skill'].includes(v))) throw new Error('Invalid comparison selection');
  const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../plugins/nectar');
  const cases = loadContracts(path.join(pluginRoot, 'evals/contracts')).filter(c => c.id.startsWith('inspection-') && (!caseIds || caseIds.includes(c.id)));
  if (!cases.length) throw new Error('No comparison cases selected');
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'nectar-inspection-comparison-'));
  const results = [];
  console.log(`Comparison evidence: ${output}`);
  for (let repetition = 1; repetition <= repetitions; repetition++) {
    for (const contract of cases) {
      const order = repetition % 2 ? [...variants] : [...variants].reverse();
      for (const variant of order) {
        let metrics;
        const result = await runCodexCase({ contract, pluginRoot, command: binary,
          execute: async (command, args, options) => {
            const actor = args.includes('--json');
            const input = actor && variant === 'baseline'
              ? `The working directory contains the supplied review files.\n\n${contract.prompt}`
              : options.input;
            const start = performance.now();
            const response = await execute(command, args, { ...options, input });
            if (actor) {
              const events = String(response.stdout || '').split('\n').flatMap(line => {
                try { return [JSON.parse(line)]; } catch { return []; }
              });
              const commands = events.filter(e => e.type === 'item.completed' && e.item?.type === 'command_execution');
              metrics = { actorMs: performance.now() - start, commandCount: commands.length,
                usage: events.findLast(e => e.type === 'turn.completed')?.usage || null,
                settings: selectCodexConfig(fs.readFileSync(path.join(options.env.CODEX_HOME, 'config.toml'), 'utf8')).settings };
            }
            return response;
          },
        });
        const row = { caseId: contract.id, repetition, variant, metrics, ...result };
        results.push(row);
        fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n');
        console.log(JSON.stringify({ case: contract.id, repetition, variant, status: result.status, metrics }));
        if (result.status === 'unavailable') return { output, results };
      }
    }
  }
  return { output, results };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const binary = process.argv[2] || 'codex';
  const result = await compareInspection({ binary });
  process.exitCode = result.results.every(r => r.passed) ? 0 : 1;
}
