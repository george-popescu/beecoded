import type { Register } from 'claude-code'

const cache = new Map<string, { at: number; result: any }>()
const observed = new Map<string, any>()
const startTotals = (startedAt: number, costBaseline: number | null, collectionEpoch = 0) => ({
  startedAt: new Date(startedAt).toISOString(), costBaseline, collectionEpoch, activeMs: 0, turns: new Set<string>(),
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, models: new Set<string>(), missingUsage: false,
})
const status = async ($: any, fresh = false) => {
    const id = await $.session.id()
    const cwd = await $.session.cwd()
    const key = `${id}\0${cwd}`
    const now = await $.clock.now()
    let entry = cache.get(key)
    if (fresh || !entry || now - entry.at > 3000) {
      const result = await $.process.run(['node', `${$.plugin.root}/scripts/run-telemetry.mjs`, 'status',
        '--project', cwd, '--host', 'claude', '--session', id, '--json'], { timeoutMs: 1500 })
      if (result.exitCode !== 0) throw new Error('Telemetry unavailable')
      entry = { at: now, result: JSON.parse(result.stdout) }
      if (cache.size >= 16) cache.delete(cache.keys().next().value!)
      cache.set(key, entry)
    }
    return { id, cwd, key, now, ...entry.result }
  }

export const register: Register = on => {
  on('turn.start', async ($, e, next) => {
    try {
      const current = await status($, true)
      if (!current.settings.enabled) { observed.delete(current.key); return next(e) }
      if (!observed.has(current.key) || observed.get(current.key).collectionEpoch !== (current.settings.collectionEpoch ?? 0)) {
        const usage = await $.session.usage()
        const baseline = typeof usage.cost?.usd === 'number' && Number.isFinite(usage.cost.usd) ? usage.cost.usd : null
        if (observed.size >= 16) observed.delete(observed.keys().next().value!)
        observed.set(current.key, startTotals(current.now, baseline, current.settings.collectionEpoch ?? 0))
      }
    } catch { /* Missing a start sample means the later cost remains unknown. */ }
    return next(e)
  })
  on('skill.prompt', async ($, e, next) => {
    const result = await next(e)
    const skill = e.skill.split(':').at(-1) ?? ''
    if (!/^nectar-[a-z-]+$/.test(skill)) return result
    try {
      const current = await status($, true)
      if (!current.settings.enabled) { observed.delete(current.key); return result }
      await $.process.run(['node', `${$.plugin.root}/scripts/run-telemetry.mjs`, 'link',
        '--host', 'claude', '--project', current.cwd, '--session', current.id, '--skill', skill,
        '--scope', 'next-interval', '--source', 'skill-event'], { timeoutMs: 1500 })
    } catch { /* Observing an activation never changes the skill prompt. */ }
    return result
  })
  // Native observed metadata only; never scrape prompts or estimate model prices.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result
    try {
      const current = await status($, true)
      if (!current.settings.enabled) { observed.delete(current.key); return result }
      let totals = observed.get(current.key)
      if (totals && totals.collectionEpoch !== (current.settings.collectionEpoch ?? 0)) {
        observed.delete(current.key)
        return result // The turn straddled a collection boundary; do not assign its counters.
      }
      if (!totals) {
        totals = startTotals(current.now - e.durationMs, null, current.settings.collectionEpoch ?? 0)
        if (observed.size >= 16) observed.delete(observed.keys().next().value!)
        observed.set(current.key, totals)
      }
      if (totals.turns.has(e.turnId)) return result
      totals.turns.add(e.turnId)
      totals.activeMs += e.durationMs
      if (e.usage) {
        for (const [key, field] of Object.entries({ input: 'input_tokens', output: 'output_tokens', cacheRead: 'cache_read_input_tokens', cacheWrite: 'cache_creation_input_tokens' })) {
          const value = (e.usage as any)[field]
          if (typeof value !== 'number' || value < 0) totals.missingUsage = true
          else totals.usage[key] += value
        }
        totals.models.add(e.usage.model)
      } else totals.missingUsage = true
      const usage = totals.missingUsage ? { input: null, output: null, cacheRead: null, cacheWrite: null, total: null }
        : { ...totals.usage, total: Object.values(totals.usage).reduce((sum: number, n: any) => sum + n, 0) }
      const hostUsage = await $.session.usage()
      const hostCost = hostUsage.cost?.usd
      const usd = totals.costBaseline !== null && typeof hostCost === 'number' && hostCost >= totals.costBaseline
        ? hostCost - totals.costBaseline : null
      const snapshot = { sessionId: current.id, startedAt: totals.startedAt, updatedAt: new Date(current.now).toISOString(),
        collectionEpoch: totals.collectionEpoch,
        measurementId: `claude:${current.id}:${totals.startedAt}`,
        model: e.usage?.model ?? null, models: [...totals.models], turns: totals.turns.size, usage,
        cost: { usd, kind: usd === null ? 'unavailable' : 'reported', source: 'claude.session.usage.delta' },
        activeMs: totals.activeMs, wallMs: current.now - Date.parse(totals.startedAt),
        durationKind: 'turn-elapsed', usageScope: 'unknown', evidence: [] }
      await $.process.run(['node', `${$.plugin.root}/scripts/run-telemetry.mjs`, 'snapshot', '--host', 'claude', '--project', current.cwd],
        { stdin: JSON.stringify(snapshot), timeoutMs: 1500 })
      cache.delete(current.key)
    } catch { /* Optional metadata never changes the turn's result. */ }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e).catch(() => undefined)
    if (e.props.hasSurvey) return below
    try {
      const current = await status($)
      if (current.settings?.bandEnabled === false) return below
      const session = current.sessions?.find((row: any) => row.host === 'claude' && row.sessionId === current.id)
      const cost = session?.cost?.usd
      const activeMs = session?.activeMs
      const tokens = session?.usage?.total
      const { Box, Text, Button } = $.ui.resolve(e)
      const review = () => $.command.run({ command: 'nectar-review' })
      const audit = () => $.command.run({ command: 'nectar-audit' })
      const copyBoard = () => $.ui.copy({ text: 'nectar board', surface: e.surface })
      return <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text>Nectar · {current.settings.enabled ? 'recorded' : 'collection off'}</Text>
          <Text>{typeof cost === 'number' ? `$${cost.toFixed(2)} ${session.cost.kind}` : 'cost unavailable'}</Text>
          {typeof activeMs === 'number' && <Text>{(activeMs / 60000).toFixed(1)} min observed</Text>}
          {typeof tokens === 'number' && <Text>{tokens.toLocaleString()} tokens observed</Text>}
          <Button plain label="Review" onPress={review} />
          <Button plain label="Audit" onPress={audit} />
          <Button plain label="Copy Board command" onPress={copyBoard} />
        </Box>
        {below}
      </Box>
    } catch { return below }
  })
}
