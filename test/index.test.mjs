import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, createDeps, name } from '../lib/index.js'
import { BRIDGE_SYMBOL } from '../lib/bridge.js'

function fakeCtx({ bundles = [], ask } = {}) {
  const registered = []
  const trees = []
  const effects = []
  const toasts = []
  const services = {
    commands: { register: definition => { registered.push(definition); return () => {} } },
    userQuestions: {
      ask: ask ?? (async () => ({ answers: [] })),
    },
    tuiCommandTrees: { register: provider => { trees.push(provider); return () => {} } },
    tuiToast: { show: (text, options) => { toasts.push({ text, options }); return true } },
    pluginManager: { listBundles: async () => bundles },
  }
  return {
    ctx: {
      get: (key, fallback) => services[key] ?? fallback,
      effect: execute => {
        const dispose = execute()
        effects.push(dispose)
        return dispose
      },
      on: () => () => {},
    },
    registered,
    trees,
    effects,
    toasts,
  }
}

const pluginBundles = [
  {
    name: 'alpha',
    installed: true,
    enabled: true,
    version: '1.0.0',
    source: 'github:o/a',
    availability: 'profile',
  },
  {
    name: 'beta',
    installed: true,
    enabled: true,
    version: '2.0.0',
    source: 'link:D:/beta',
    availability: 'profile',
  },
]

test('apply registers /plugin-update, its tree and the bridge', () => {
  const { ctx, registered, trees, effects } = fakeCtx({ bundles: pluginBundles })
  const previousProfile = process.env.DSH_PROFILE
  delete process.env.DSH_PROFILE
  try {
    apply(ctx)
    assert.equal(name, 'dsh-tui-plugin-update')
    assert.equal(registered.length, 1)
    assert.equal(registered[0].name, 'plugin-update')
    assert.match(registered[0].input.hint, /all/)
    assert.equal(trees.length, 1)
    assert.equal(trees[0].root, 'plugin-update')
    assert.equal(typeof globalThis[BRIDGE_SYMBOL], 'function')
    assert.equal(effects.length, 1)
  } finally {
    if (previousProfile !== undefined) process.env.DSH_PROFILE = previousProfile
    globalThis[BRIDGE_SYMBOL] = undefined
  }
})

test('bridge routes /plugin update to the same flow and never spawns for a local link', async () => {
  const { ctx, effects } = fakeCtx({ bundles: pluginBundles })
  const previousProfile = process.env.DSH_PROFILE
  process.env.DSH_PROFILE = 'dsh-tui'
  try {
    apply(ctx)
    const bridge = globalThis[BRIDGE_SYMBOL]
    assert.equal(typeof bridge, 'function')
    const lines = await bridge('beta')
    assert.ok(lines[0].includes('beta'), JSON.stringify(lines))
    assert.ok(lines[0].includes('本地') || lines[0].startsWith('local-only'))
    assert.equal(effects.length, 1)
    effects[0]()
    assert.equal(globalThis[BRIDGE_SYMBOL], undefined)
  } finally {
    if (previousProfile === undefined) delete process.env.DSH_PROFILE
    else process.env.DSH_PROFILE = previousProfile
    globalThis[BRIDGE_SYMBOL] = undefined
  }
})

test('createDeps exposes profile, patch and toast seams', () => {
  const { ctx } = fakeCtx({ bundles: pluginBundles })
  const previousProfile = process.env.DSH_PROFILE
  process.env.DSH_PROFILE = 'dsh-tui'
  try {
    const deps = createDeps(ctx)
    assert.equal(deps.profile, 'dsh-tui')
    assert.equal(deps.lang, 'zh')
    assert.equal(typeof deps.toast('x'), 'boolean')
    assert.equal(typeof deps.patch.status().supported, 'boolean')
  } finally {
    if (previousProfile === undefined) delete process.env.DSH_PROFILE
    else process.env.DSH_PROFILE = previousProfile
  }
})

test('apply is inert without the commands service', () => {
  const ctx = { get: () => undefined }
  assert.doesNotThrow(() => apply(ctx))
})
