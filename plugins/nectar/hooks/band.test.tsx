import { expect, test } from 'claude-code/testing'
import { register } from './band'

function handler(selected = 'ui.render') {
  let render: any
  register(((event: string, matcher: unknown, callback: unknown) => {
    if (event === selected) render = callback ?? matcher
    return { catch() {} }
  }) as any, {})
  return render
}

test('disabled or unavailable telemetry preserves other UI without collecting anything', async () => {
  for (const result of [{ settings: { enabled: true, bandEnabled: false } }, null]) {
    let calls = 0
    const id = result === null ? 'unavailable' : 'session'
    const $: any = { session: { id: async () => id, cwd: async () => '/fixture' },
      clock: { now: async () => 10 }, plugin: { root: '/runtime' },
      process: { run: async (args: string[]) => {
        calls++
        expect(args.slice(2)).toEqual(['status', '--project', '/fixture', '--host', 'claude', '--session', id, '--json'])
        if (result === null) throw new Error('unavailable')
        return { exitCode: 0, stdout: JSON.stringify(result) }
      } } }
    let nextCalls = 0
    const below = { existing: true }
    const out = await handler()($, { props: {} }, async () => { nextCalls++; return below })
    expect(out).toBe(below)
    expect(nextCalls).toBe(1)
    expect(calls).toBe(1)
  }
})

test('survey takes precedence and does not start any process', async () => {
  const below = { existing: true }
  expect(await handler()({}, { props: { hasSurvey: true } }, async () => below)).toBe(below)
})

test('enabled strip selects the exact session and never presents unknown cost as zero', async () => {
  const $: any = { session: { id: async () => 'selected', cwd: async () => '/fixture' },
    clock: { now: async () => 10 }, plugin: { root: '/runtime' },
    ui: { resolve: () => ({ Box: 'Box', Text: 'Text', Button: 'Button' }) },
    process: { run: async () => ({ exitCode: 0, stdout: JSON.stringify({ settings: { enabled: true }, sessions: [
      { host: 'claude', sessionId: 'other', cost: { usd: 99, kind: 'reported' } },
      { host: 'claude', sessionId: 'selected', cost: { usd: null, kind: 'unavailable' }, activeMs: null, usage: { total: 12 } },
    ] }) }) } }
  const event: any = { component: 'AbovePrompt', surface: 'terminal', props: { hasSurvey: false, bodyColumns: 100, maxRows: 4 } }
  const out = await handler()($, event, async () => null)
  expect(out).not.toBeNull()
  const rendered = JSON.stringify(out)
  expect(rendered).toContain('cost unavailable')
  expect(rendered).not.toContain('$0.00')
  expect(rendered).not.toContain('$99.00')
})

test('native snapshots deduplicate turn events, omit child totals and never retain answer text', async () => {
  const snapshots: any[] = []
  let hostCost = 0
  const $: any = { session: { id: async () => 'selected', cwd: async () => '/fixture', usage: async () => ({ cost: { usd: hostCost } }) },
    clock: { now: async () => 1000 }, plugin: { root: '/runtime' },
    process: { run: async (args: string[], init: any) => {
      if (args[2] === 'snapshot') { snapshots.push(JSON.parse(init.stdin)); return { exitCode: 0, stdout: '{}' } }
      return { exitCode: 0, stdout: JSON.stringify({ settings: { enabled: true, bandEnabled: false }, sessions: [] }) }
    } } }
  const collect = handler('turn.complete')
  const event = { turnId: 'turn-1', durationMs: 12, answer: 'PRIVATE_ANSWER', usage: {
    model: 'claude-model', input_tokens: 4, output_tokens: 3, cache_read_input_tokens: 2, cache_creation_input_tokens: 1 } }
  await handler('turn.start')($, {}, async () => ({}))
  hostCost = 1.25
  await collect($, event, async () => 'unchanged')
  await collect($, event, async () => 'unchanged')
  await collect($, { ...event, turnId: 'child-1', agentId: 'child' }, async () => 'unchanged')
  expect(snapshots.length).toBe(1)
  expect(snapshots[0].usage.total).toBe(10)
  expect(snapshots[0].cost.usd).toBe(1.25)
  expect(snapshots[0].activeMs).toBe(12)
  expect(snapshots[0].measurementId).toContain('claude:selected:')
  expect(JSON.stringify(snapshots)).not.toContain('PRIVATE_ANSWER')
})

test('new native windows subtract earlier host spend instead of charging it again', async () => {
  const snapshots: any[] = []
  let hostCost = 12
  let now = 1000
  const $: any = { session: { id: async () => 'resumed-window', cwd: async () => '/fixture', usage: async () => ({ cost: { usd: hostCost } }) },
    clock: { now: async () => now }, plugin: { root: '/runtime' },
    process: { run: async (args: string[], init: any) => {
      if (args[2] === 'snapshot') { snapshots.push(JSON.parse(init.stdin)); return { exitCode: 0, stdout: '{}' } }
      return { exitCode: 0, stdout: JSON.stringify({ settings: { enabled: true }, sessions: [] }) }
    } } }
  await handler('turn.start')($, {}, async () => ({}))
  hostCost = 12.5; now = 2000
  await handler('turn.complete')($, { turnId: 'r1', durationMs: 1000, usage: { model: 'claude-model', input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }, async () => ({}))
  expect(snapshots[0].cost.usd).toBe(.5)
  hostCost = .2; now = 3000
  await handler('turn.complete')($, { turnId: 'r2', durationMs: 1000 }, async () => ({}))
  expect(snapshots[1].cost.usd).toBeNull()
})

test('collection epoch rebases counters even without a disabled callback', async () => {
  const snapshots: any[] = []
  let cost = 0, epoch = 1, now = 1000
  const $: any = { session: { id: async () => 'epoch-probe', cwd: async () => '/fixture', usage: async () => ({cost:{usd:cost}}) },
    clock: { now: async () => now }, plugin:{root:'/runtime'}, process:{run:async(args:string[],init:any)=>{
      if(args[2]==='snapshot'){snapshots.push(JSON.parse(init.stdin));return{exitCode:0,stdout:'{}'}}
      return{exitCode:0,stdout:JSON.stringify({settings:{enabled:true,collectionEpoch:epoch},sessions:[]})}
    }} }
  const start=handler('turn.start'), complete=handler('turn.complete')
  const event=(id:string)=>({turnId:id,durationMs:1000,usage:{model:'claude-model',input_tokens:50,output_tokens:50,cache_read_input_tokens:0,cache_creation_input_tokens:0}})
  await start($,{},async()=>({}));cost=1;now=2000;await complete($,event('first'),async()=>({}))
  cost=6;epoch=3;now=4000
  await start($,{},async()=>({}));cost=7;now=5000;await complete($,event('second'),async()=>({}))
  expect(snapshots.map(s=>s.cost.usd)).toEqual([1,1])
  expect(snapshots.map(s=>s.usage.total)).toEqual([100,100])
  expect(snapshots[1].collectionEpoch).toBe(3)
  epoch=5;cost=12;now=6000;await complete($,event('crossing'),async()=>({}))
  expect(snapshots.length).toBe(2)
})

test('skill activation binds only its name and leaves the expanded prompt unchanged', async () => {
  const calls: string[][] = []
  const $: any = { session: { id: async () => 'skill-session', cwd: async () => '/fixture' }, clock: { now: async () => 10001 },
    plugin: { root: '/runtime' }, process: { run: async (args: string[]) => {
      calls.push(args)
      return { exitCode: 0, stdout: JSON.stringify({ settings: { enabled: true }, sessions: [] }) }
    } } }
  const result = { text: 'PRIVATE_EXPANDED_SKILL' }
  const out = await handler('skill.prompt')($, { skill: 'nectar:nectar-review', text: 'PRIVATE_EXPANDED_SKILL' }, async () => result)
  expect(out).toBe(result)
  expect(calls.at(-1)).toEqual(['node', '/runtime/scripts/run-telemetry.mjs', 'link', '--host', 'claude', '--project', '/fixture', '--session', 'skill-session', '--skill', 'nectar-review', '--scope', 'next-interval', '--source', 'skill-event'])
  expect(JSON.stringify(calls)).not.toContain('PRIVATE_EXPANDED_SKILL')
})

test('no underlying AbovePrompt provider and collection off still permit a visible strip', async () => {
  const $: any = { session: { id: async () => 'selected', cwd: async () => '/fixture' }, clock: { now: async () => 10000 },
    plugin: { root: '/runtime' }, ui: { resolve: () => ({ Box: 'Box', Text: 'Text', Button: 'Button' }) },
    process: { run: async () => ({ exitCode: 0, stdout: JSON.stringify({ settings: { enabled: false, bandEnabled: true }, sessions: [] }) }) } }
  const out = await handler()($, { props: {} }, async () => { throw new Error('No provider') })
  expect(JSON.stringify(out)).toContain('collection off')
})
