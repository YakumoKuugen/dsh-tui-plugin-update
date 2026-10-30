/**
 * The host patch that puts `update` inside dsh-TUI's built-in `/plugin`.
 *
 * Why a patch at all: `/plugin` is a Chat-side `switch` plus a report
 * function, not a `ctx.commands` definition, and dsh-TUI publishes no seam for
 * adding a subcommand to a built-in local command. The patch is deliberately
 * tiny and semantic:
 *
 *   1. `parsePluginArgs` learns the `update` token (so the report path does
 *      not classify it as unknown).
 *   2. `pluginReport` forwards an `update` call to the bridge this plugin
 *      publishes. The picker, profile inspection and pnpm run all stay in the
 *      plugin — the host only routes.
 *   3. The slash-completion tree lists `update` and the installed plugin names.
 *
 * Every edit is anchored to code that is identical in dsh-TUI 0.16.1 and
 * 0.17.0. When a future release moves an anchor the patcher refuses instead of
 * writing a half-patch; `/plugin-update` keeps working on its own either way.
 * All edits are idempotent and reversible.
 *
 * @module dsh-tui-plugin-update/patch
 */

import { mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome, resolveDshTuiDir } from './profile.js'

export const PLUGINS_INFO_FILE = 'lib/types/dsh-adapter/plugins-info.js'
export const COMPLETIONS_FILE = 'lib/types/dsh-adapter/channel/command-completions.js'
export const STATE_DIR = '.dsh-plugin-update'
export const STATE_FILE = 'patch-state.json'

export const REPORT_MARKER = 'dsh-tui-plugin-update: route /plugin update'
export const COMPLETIONS_MARKER = 'dsh-tui-plugin-update: /plugin update <name|all>'

const PARSE_ANCHOR = `    if (sub === 'disable')
        return { kind: 'disable', target: rest.join(' ') };
    return { kind: 'unknown', sub: sub ?? '' };`

const PARSE_PATCHED = `    if (sub === 'disable')
        return { kind: 'disable', target: rest.join(' ') };
    if (sub === 'update')
        return { kind: 'update', target: rest.join(' ') };
    return { kind: 'unknown', sub: sub ?? '' };`

const REPORT_ANCHOR = `export async function pluginReport(args, deps, manager) {
    return [...pluginsInfoLines(args, deps), ...await pluginServiceLines(args, deps, manager)];
}`

const REPORT_PATCHED = `export async function pluginReport(args, deps, manager) {
    // dsh-tui-plugin-update: route /plugin update to the plugin's own flow.
    const parsed = parsePluginArgs(args);
    if (parsed.kind === 'update') {
        const bridge = globalThis[Symbol.for('dsh-tui-plugin-update.bridge')];
        if (typeof bridge === 'function') {
            try {
                return await bridge(parsed.target);
            }
            catch (error) {
                return [\`/plugin update failed: \${error instanceof Error ? error.message : String(error)}\`];
            }
        }
        return [
            '/plugin update 需要 dsh-tui-plugin-update 插件：请先启用或安装它。',
            'The /plugin update flow requires the dsh-tui-plugin-update plugin; enable or install it first.',
        ];
    }
    return [...pluginsInfoLines(args, deps), ...await pluginServiceLines(args, deps, manager)];
}`

const COMPLETIONS_STATIC_ANCHOR = `                    { name: 'check', description: 'Validate a plugin manifest without installing it', descriptionKey: 'sugg-plugin-check-desc' },`

const COMPLETIONS_STATIC_PATCHED = `                    { name: 'update', description: 'Update installed plugins', descriptions: { zh: '更新已安装的插件', en: 'Update installed plugins' } },
                    { name: 'check', description: 'Validate a plugin manifest without installing it', descriptionKey: 'sugg-plugin-check-desc' },`

const COMPLETIONS_DYNAMIC_ANCHOR = `            return commandTrees?.children(path) ?? [];`

const COMPLETIONS_DYNAMIC_PATCHED = `            // dsh-tui-plugin-update: /plugin update <name|all>
            if (path.length === 2 && path[0] === 'plugin' && path[1] === 'update') {
                deps.plugin?.warmPluginNames();
                return [
                    { name: 'all', description: 'Update every installed plugin', descriptions: { zh: '全部更新', en: 'Update all' } },
                    ...(deps.plugin?.pluginNames() ?? []),
                ];
            }
            return commandTrees?.children(path) ?? [];`

function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`anchor not found: ${label}`)
  return source.replace(from, to)
}

/** Patch `plugins-info.js` in memory. */
export function patchPluginsInfo(source) {
  let output = source
  let changed = false
  if (!output.includes(REPORT_MARKER)) {
    output = replaceOnce(output, REPORT_ANCHOR, REPORT_PATCHED, 'plugins-info/pluginReport')
    changed = true
  }
  if (!output.includes("if (sub === 'update')")) {
    output = replaceOnce(output, PARSE_ANCHOR, PARSE_PATCHED, 'plugins-info/parsePluginArgs')
    changed = true
  }
  return { source: output, changed }
}

/** Revert `plugins-info.js` in memory. */
export function unpatchPluginsInfo(source) {
  let output = source
  let changed = false
  if (output.includes(REPORT_MARKER)) {
    output = replaceOnce(output, REPORT_PATCHED, REPORT_ANCHOR, 'plugins-info/pluginReport (patched)')
    changed = true
  }
  if (output.includes("if (sub === 'update')")) {
    output = replaceOnce(output, PARSE_PATCHED, PARSE_ANCHOR, 'plugins-info/parsePluginArgs (patched)')
    changed = true
  }
  return { source: output, changed }
}

/** Patch `command-completions.js` in memory. */
export function patchCommandCompletions(source) {
  let output = source
  let changed = false
  if (!output.includes(COMPLETIONS_MARKER)) {
    output = replaceOnce(output, COMPLETIONS_DYNAMIC_ANCHOR, COMPLETIONS_DYNAMIC_PATCHED, 'completions/commandTrees')
    changed = true
  }
  if (!output.includes("name: 'update', description: 'Update installed plugins'")) {
    output = replaceOnce(output, COMPLETIONS_STATIC_ANCHOR, COMPLETIONS_STATIC_PATCHED, 'completions/plugin rows')
    changed = true
  }
  return { source: output, changed }
}

/** Revert `command-completions.js` in memory. */
export function unpatchCommandCompletions(source) {
  let output = source
  let changed = false
  if (output.includes(COMPLETIONS_MARKER)) {
    output = replaceOnce(output, COMPLETIONS_DYNAMIC_PATCHED, COMPLETIONS_DYNAMIC_ANCHOR, 'completions/commandTrees (patched)')
    changed = true
  }
  if (output.includes("name: 'update', description: 'Update installed plugins'")) {
    output = replaceOnce(output, COMPLETIONS_STATIC_PATCHED, COMPLETIONS_STATIC_ANCHOR, 'completions/plugin rows (patched)')
    changed = true
  }
  return { source: output, changed }
}

function writeAtomic(file, content) {
  const tmp = `${file}.dsh-plugin-update.tmp`
  writeFileSync(tmp, content, 'utf8')
  try {
    renameSync(tmp, file)
  } catch {
    // Windows can refuse the rename while an editor holds the target; the
    // fallback is still much narrower than an in-place write window.
    writeFileSync(file, content, 'utf8')
    try {
      unlinkSync(tmp)
    } catch {
      // Best effort only.
    }
  }
}

function statePath(profile, home) {
  return join(home, 'profiles', profile, STATE_DIR, STATE_FILE)
}

function writeState(profile, home, state) {
  if (profile === undefined || profile === '') return
  try {
    const dir = join(home, 'profiles', profile, STATE_DIR)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  } catch {
    // A state file is diagnostics, never a precondition for the patch.
  }
}

function readState(profile, home) {
  if (profile === undefined || profile === '') return undefined
  try {
    const parsed = JSON.parse(readFileSync(statePath(profile, home), 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

/** The two files, with their anchor checks and current state. */
export function inspectDshTui(dir) {
  const packageJson = (() => {
    try {
      return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    } catch {
      return undefined
    }
  })()
  const read = (rel) => {
    try {
      return readFileSync(join(dir, rel), 'utf8')
    } catch {
      return undefined
    }
  }
  const pluginsInfo = read(PLUGINS_INFO_FILE)
  const completions = read(COMPLETIONS_FILE)
  const missing = []
  if (pluginsInfo === undefined) missing.push(`${PLUGINS_INFO_FILE} (missing)`)
  if (completions === undefined) missing.push(`${COMPLETIONS_FILE} (missing)`)
  const patched = pluginsInfo?.includes(REPORT_MARKER) === true
    && completions?.includes(COMPLETIONS_MARKER) === true

  if (!patched) {
    if (pluginsInfo !== undefined) {
      if (!pluginsInfo.includes(REPORT_ANCHOR) && !pluginsInfo.includes(REPORT_MARKER)) {
        missing.push(`${PLUGINS_INFO_FILE} (pluginReport anchor)`)
      }
      if (!pluginsInfo.includes(PARSE_ANCHOR) && !pluginsInfo.includes(PARSE_PATCHED)) {
        missing.push(`${PLUGINS_INFO_FILE} (parsePluginArgs anchor)`)
      }
    }
    if (completions !== undefined) {
      if (!completions.includes(COMPLETIONS_DYNAMIC_ANCHOR) && !completions.includes(COMPLETIONS_DYNAMIC_PATCHED)) {
        missing.push(`${COMPLETIONS_FILE} (commandTrees anchor)`)
      }
      if (!completions.includes(COMPLETIONS_STATIC_ANCHOR) && !completions.includes(COMPLETIONS_STATIC_PATCHED)) {
        missing.push(`${COMPLETIONS_FILE} (plugin completion anchor)`)
      }
    }
  }

  return {
    dir,
    dshTuiVersion: typeof packageJson?.version === 'string' ? packageJson.version : undefined,
    supported: missing.length === 0 || patched,
    patched,
    missing,
  }
}

/** Locate and inspect the dsh-TUI copy this profile loads. */
export function patchStatus({ profile, home = dshHome() } = {}) {
  const dir = resolveDshTuiDir({ profile, home })
  if (dir === undefined) {
    return {
      supported: false,
      patched: false,
      dshTuiVersion: undefined,
      dir: undefined,
      missing: ['@deepseek-harness-tui/dsh-tui not found'],
    }
  }
  return inspectDshTui(dir)
}

/**
 * Apply both edits to the profile's dsh-TUI copy.
 * @returns {{ changed: boolean, dshTuiVersion?: string, dir: string, files: string[] }}
 */
export function applyHostPatch({ profile, home = dshHome(), dryRun = false } = {}) {
  const dir = resolveDshTuiDir({ profile, home })
  if (dir === undefined) throw new Error('dsh-tui package not found for this profile')
  const status = inspectDshTui(dir)
  if (!status.supported) {
    throw new Error(`dsh-tui ${status.dshTuiVersion ?? 'unknown'} is not patchable: ${status.missing.join(', ')}`)
  }
  if (status.patched) {
    return { changed: false, dshTuiVersion: status.dshTuiVersion, dir, files: [] }
  }

  const edits = [
    { rel: PLUGINS_INFO_FILE, patch: patchPluginsInfo },
    { rel: COMPLETIONS_FILE, patch: patchCommandCompletions },
  ]
  const files = []
  const pending = []
  for (const edit of edits) {
    const file = join(dir, edit.rel)
    const source = readFileSync(file, 'utf8')
    const result = edit.patch(source)
    if (!result.changed) continue
    pending.push({ file, source: result.source })
    files.push(edit.rel)
  }

  if (!dryRun) {
    for (const entry of pending) writeAtomic(entry.file, entry.source)
    const after = inspectDshTui(dir)
    if (!after.patched) throw new Error('patch verification failed: markers not found after write')
    writeState(profile, home, {
      plugin: 'dsh-tui-plugin-update',
      dshTuiVersion: after.dshTuiVersion,
      patchedAt: new Date().toISOString(),
      files,
    })
  }

  return { changed: pending.length > 0, dshTuiVersion: status.dshTuiVersion, dir, files }
}

/**
 * Remove both edits, restoring the original source.
 * @returns {{ changed: boolean, dshTuiVersion?: string, dir: string, files: string[] }}
 */
export function removeHostPatch({ profile, home = dshHome(), dryRun = false } = {}) {
  const dir = resolveDshTuiDir({ profile, home })
  if (dir === undefined) throw new Error('dsh-tui package not found for this profile')
  const status = inspectDshTui(dir)
  const edits = [
    { rel: PLUGINS_INFO_FILE, unpatch: unpatchPluginsInfo },
    { rel: COMPLETIONS_FILE, unpatch: unpatchCommandCompletions },
  ]
  const files = []
  const pending = []
  for (const edit of edits) {
    const file = join(dir, edit.rel)
    let source
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const result = edit.unpatch(source)
    if (!result.changed) continue
    pending.push({ file, source: result.source })
    files.push(edit.rel)
  }

  if (!dryRun) {
    for (const entry of pending) writeAtomic(entry.file, entry.source)
    if (profile !== undefined && profile !== '') {
      try {
        rmSync(statePath(profile, home), { force: true })
      } catch {
        // Leaving a stale diagnostic file is harmless.
      }
    }
  }

  return { changed: pending.length > 0, dshTuiVersion: status.dshTuiVersion, dir, files }
}

/** Last successful patch record, if this profile kept one. */
export function readPatchState({ profile, home = dshHome() } = {}) {
  return readState(profile, home)
}

/** Exposed for tests: the exact strings the patcher writes and reverses. */
export const anchors = {
  PARSE_ANCHOR,
  PARSE_PATCHED,
  REPORT_ANCHOR,
  REPORT_PATCHED,
  COMPLETIONS_STATIC_ANCHOR,
  COMPLETIONS_STATIC_PATCHED,
  COMPLETIONS_DYNAMIC_ANCHOR,
  COMPLETIONS_DYNAMIC_PATCHED,
}
