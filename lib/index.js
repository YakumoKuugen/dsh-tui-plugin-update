/**
 * dsh-tui-plugin-update — `/plugin update [name | all]` for dsh-TUI.
 *
 * Two entry points, one implementation:
 *
 * - `/plugin-update [name | all | patch | status]` is this plugin's own
 *   command, registered through dsh-commands and available as soon as the
 *   plugin activates.
 * - `/plugin update ...` is the alias the host patch routes here
 *   (`lib/patch.js`). dsh-TUI exposes no public subcommand seam for a built-in
 *   local command, so the patch is deliberately just a router; the picker,
 *   profile inspection and pnpm run all live in this module.
 *
 * @module dsh-tui-plugin-update
 */

import { join } from 'node:path'
import { setBridge } from './bridge.js'
import { listCandidates } from './bundles.js'
import { runPluginUpdate } from './command.js'
import { createT, detectLang } from './i18n.js'
import { applyHostPatch, patchStatus } from './patch.js'
import { dshHome, resolveProfileName } from './profile.js'
import { readInstalledVersion, runDsh } from './update.js'

export const name = 'dsh-tui-plugin-update'

/**
 * The real dependency graph. Everything that touches the host or the network
 * is a function here so the command module stays headless-testable.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function createDeps(ctx) {
  const lang = detectLang()
  const t = createT(lang)
  const profile = resolveProfileName()
  const home = dshHome()
  return {
    t,
    lang,
    profile,
    home,
    ask: request => {
      const userQuestions = ctx.get('userQuestions', false)
      if (userQuestions === undefined || userQuestions === null) {
        const error = new Error('userQuestions service unavailable')
        error.name = 'UserQuestionError'
        throw error
      }
      return userQuestions.ask(request)
    },
    listCandidates: targetProfile => listCandidates(ctx, targetProfile, home, { lang }),
    run: args => runDsh(args),
    toast: (text, options) => {
      try {
        return ctx.get('tuiToast', false)?.show(text, options) ?? false
      } catch {
        return false
      }
    },
    readVersion: targetName => {
      if (profile === undefined) return undefined
      return readInstalledVersion(join(home, 'profiles', profile), targetName)
    },
    patch: {
      status: () => patchStatus({ profile, home }),
      apply: () => applyHostPatch({ profile, home }),
    },
  }
}

/**
 * Wire the plugin: register the command, its completion tree, and the bridge
 * the patched host calls.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const commands = ctx.get('commands', false)
  if (commands === undefined || commands === null) return

  const deps = createDeps(ctx)
  const { t } = deps

  commands.register({
    name: 'plugin-update',
    description: t('cmd-desc'),
    input: { hint: '[<plugin> | all | patch | status]' },
    handler: async ({ rawInput }) => {
      const result = await runPluginUpdate(rawInput, deps)
      return {
        kind: result.ok ? 'success' : 'error',
        text: result.lines.join('\n'),
      }
    },
  })

  const trees = ctx.get('tuiCommandTrees', false)
  trees?.register({
    root: 'plugin-update',
    descriptions: {
      zh: '更新已安装插件（也可用 /plugin update）',
      en: 'Update installed plugins (also /plugin update)',
    },
    children: canonicalPath => {
      if (canonicalPath.length !== 1) return []
      return [
        { name: 'all', description: 'Update every installed plugin', descriptions: { zh: '全部更新' } },
        { name: 'patch', description: 'Install the /plugin update alias (restart needed)', descriptions: { zh: '写入 /plugin update 支持（需重启）' } },
        { name: 'status', description: 'Show plugin and patch status', descriptions: { zh: '查看插件与补丁状态' } },
      ]
    },
  })

  // The bridge returns lines, not a CommandResult: the patched host's
  // pluginReport() renders a transcript block.
  const bridge = target => runPluginUpdate(target, deps).then(result => result.lines)
  const disposeBridge = setBridge(bridge)
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => disposeBridge, 'dsh-tui-plugin-update/bridge')
  } else if (typeof ctx.on === 'function') {
    ctx.on('dispose', disposeBridge)
  }

  // A dsh-tui upgrade replaces the two patched files. Do not rewrite them
  // underneath a running frame (that can trigger HMR mid-session): remind the
  // person once, after boot settles, and let `/plugin-update patch` do the one
  // explicit write + restart.
  if (deps.profile !== undefined) {
    const timer = setTimeout(() => {
      try {
        const status = deps.patch.status()
        if (status.supported && !status.patched) {
          deps.toast(t('patch-needed', { version: status.dshTuiVersion ?? 'unknown' }), {
            color: 'warning',
            timeoutMs: 10000,
          })
        }
      } catch {
        // A read-only or missing install is not an error worth a toast.
      }
    }, 2500)
    timer.unref?.()
  }
}
