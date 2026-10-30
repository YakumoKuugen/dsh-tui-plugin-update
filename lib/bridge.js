/**
 * The one process-wide bridge between the host's built-in `/plugin` command
 * and this plugin.
 *
 * dsh-TUI has no public seam for adding a subcommand to a built-in local
 * command: `/plugin` is a Chat-side switch, not a `ctx.commands` definition.
 * The host patch (`lib/patch.js`) therefore only teaches `pluginReport()` to
 * forward `update` here, and all of the real work — the picker, profile
 * inspection, pnpm invocation, result rendering — stays in this plugin.
 *
 * A `Symbol.for` key (not a string) keeps the bridge out of every ordinary
 * property lookup and lets both sides agree without importing each other.
 *
 * @module dsh-tui-plugin-update/bridge
 */

export const BRIDGE_KEY = 'dsh-tui-plugin-update.bridge'
export const BRIDGE_SYMBOL = Symbol.for(BRIDGE_KEY)

/**
 * @typedef {(target: string) => Promise<string[]>} PluginUpdateBridge
 */

/**
 * Publish the bridge for the patched host.
 * @param {PluginUpdateBridge} handler
 * @returns {() => void} disposer that removes exactly this handler.
 */
export function setBridge(handler) {
  globalThis[BRIDGE_SYMBOL] = handler
  return () => {
    if (globalThis[BRIDGE_SYMBOL] === handler) delete globalThis[BRIDGE_SYMBOL]
  }
}

/** Read the bridge, if the plugin is active in this process. */
export function getBridge() {
  const handler = globalThis[BRIDGE_SYMBOL]
  return typeof handler === 'function' ? handler : undefined
}
