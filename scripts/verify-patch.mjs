#!/usr/bin/env node
/**
 * End-to-end check of the host patch, without touching the running install:
 *
 *   1. copy the profile's dsh-tui `lib` + `package.json` into a temp profile,
 *      with a junction to the real `node_modules` (external deps resolve),
 *   2. apply the same patch the installer writes,
 *   3. import the patched ESM modules and exercise
 *      - `parsePluginArgs('update alpha')`
 *      - `pluginReport('update', …)` with and without the bridge
 *      - the `/plugin` and `/plugin update` completion rows.
 *
 *   node scripts/verify-patch.mjs --profile dsh-tui
 */

import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { applyHostPatch, COMPLETIONS_FILE, PLUGINS_INFO_FILE, patchStatus } from '../lib/patch.js'
import { BRIDGE_SYMBOL } from '../lib/bridge.js'
import { helpText, parseArgs } from './cli.mjs'

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(helpText('verify-patch'))
    return 0
  }
  const home = mkdtempSync(join(tmpdir(), 'dsh-pu-verify-'))
  const profile = 'verify'
  const profilePath = join(home, 'profiles', profile)
  const tuiDir = join(profilePath, 'node_modules', '@deepseek-harness-tui', 'dsh-tui')
  const realStatus = patchStatus({ profile: options.profile, home: options.home })
  if (!realStatus.supported) {
    console.error(`dsh-tui ${realStatus.dshTuiVersion ?? 'unknown'} is not patchable: ${realStatus.missing.join(', ')}`)
    return 1
  }
  const realDir = realStatus.dir
  try {
    mkdirSync(tuiDir, { recursive: true })
    cpSync(join(realDir, 'lib'), join(tuiDir, 'lib'), { recursive: true })
    cpSync(join(realDir, 'tui-profile'), join(tuiDir, 'tui-profile'), { recursive: true })
    cpSync(join(realDir, 'package.json'), join(tuiDir, 'package.json'))

    // dsh-tui's dependencies are hoisted to the profile's node_modules. Link
    // every sibling package there so the copied modules resolve exactly as the
    // running install does, without copying hundreds of MB.
    const realModules = resolve(realDir, '..', '..')
    const tempModules = join(profilePath, 'node_modules')
    for (const entry of readdirSync(realModules, { withFileTypes: true })) {
      if (entry.name === '@deepseek-harness-tui' || entry.name.startsWith('.')) continue
      symlinkSync(join(realModules, entry.name), join(tempModules, entry.name), entry.isDirectory() ? 'junction' : 'file')
    }
    // The host-provided peers (`@deepseek-ai/dsh-*`, cordis) come from the dsh
    // CLI installation, not the profile. Link them too so the copied modules
    // resolve like the running process does.
    const globalDshModules = join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules')
    if (existsSync(globalDshModules)) {
      for (const entry of readdirSync(globalDshModules, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || existsSync(join(tempModules, entry.name))) continue
        symlinkSync(join(globalDshModules, entry.name), join(tempModules, entry.name), entry.isDirectory() ? 'junction' : 'file')
      }
    }
    // The bundled @dsh-std / vendor packages live inside dsh-tui itself.
    const nestedModules = join(tuiDir, 'node_modules')
    mkdirSync(nestedModules, { recursive: true })
    for (const entry of readdirSync(join(realDir, 'node_modules'), { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      symlinkSync(join(realDir, 'node_modules', entry.name), join(nestedModules, entry.name), entry.isDirectory() ? 'junction' : 'file')
    }

    const patched = applyHostPatch({ profile, home })
    assert.equal(patched.changed, true)
    assert.equal(patchStatus({ profile, home }).patched, true)

    const pluginsInfo = await import(pathToFileURL(join(tuiDir, PLUGINS_INFO_FILE)).href)
    assert.deepEqual(pluginsInfo.parsePluginArgs('update alpha'), { kind: 'update', target: 'alpha' })
    assert.deepEqual(pluginsInfo.parsePluginArgs('update'), { kind: 'update', target: '' })

    globalThis[BRIDGE_SYMBOL] = async target => [`bridged:${target}`]
    const routed = await pluginsInfo.pluginReport('update alpha', {}, undefined)
    assert.deepEqual(routed, ['bridged:alpha'])

    delete globalThis[BRIDGE_SYMBOL]
    const missing = await pluginsInfo.pluginReport('update alpha', {}, undefined)
    assert.equal(missing.length, 2)
    assert.ok(missing[0].includes('/plugin update'))

    const completions = await import(pathToFileURL(join(tuiDir, COMPLETIONS_FILE)).href)
    const complete = completions.createCommandCompletions({
      state: () => ({ commandList: [{ name: 'plugin', description: 'plugins' }] }),
      plugin: {
        warmPluginNames() {},
        pluginNames: () => [{ name: 'alpha', description: 'Alpha' }],
      },
      model: {
        warmModelNodes() {},
        warmPresetOptions() {},
        warmEffortLevels() {},
        modelNodes: () => [],
        presetOptions: () => [],
      },
      workspaceCommands: () => [],
      commandTrees: { children: () => [] },
    })
    const rootRows = complete('/plugin ')
    assert.ok(rootRows.some(row => row.commandLine === '/plugin update'), JSON.stringify(rootRows))
    const childRows = complete('/plugin update ')
    assert.ok(childRows.some(row => row.commandLine === '/plugin update all'), JSON.stringify(childRows))
    assert.ok(childRows.some(row => row.commandLine === '/plugin update alpha'), JSON.stringify(childRows))

    console.log('verify-patch: ok')
    console.log('  parsePluginArgs  → update')
    console.log('  pluginReport     → bridge → lines')
    console.log('  completions      → update, all, plugin names')
    return 0
  } finally {
    delete globalThis[BRIDGE_SYMBOL]
    rmSync(home, { recursive: true, force: true })
  }
}

main().then(code => process.exit(code), error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})
