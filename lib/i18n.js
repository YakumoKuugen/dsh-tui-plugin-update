/**
 * dsh-tui-plugin-update i18n — zh (default) / en, flat dict with {{name}}
 * placeholders.
 *
 * Language resolution follows the dsh-TUI surface this plugin lives in:
 * `DSH_TUI_LANG` (pinned at TUI start) over `CC_TUI_LANG`, then the persisted
 * `/lang` choice in ~/.dsh-tui/lang.json, else zh.
 *
 * @module dsh-tui-plugin-update/i18n
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const dict = {
  'cmd-desc': {
    zh: '更新已安装插件：/plugin update [插件名 | all]，不带参数时打开选择列表',
    en: 'Update installed plugins: /plugin update [name | all]; bare opens a picker',
  },
  'tree-all': { zh: '全部更新', en: 'Update all installed plugins' },
  'tree-patch': { zh: '写入 /plugin update 支持（需重启）', en: 'Install the /plugin update alias (restart needed)' },
  'tree-status': { zh: '查看插件与补丁状态', en: 'Show plugin and patch status' },
  'tree-name': { zh: '更新指定插件', en: 'Update one plugin' },

  'no-profile': {
    zh: '/plugin update 仅在 `dsh --profile <名称>` 启动的实例中可用',
    en: '/plugin update is only available in a `dsh --profile <name>` launch',
  },
  'usage': {
    zh: '用法  /plugin update [插件名 | all | patch | status]',
    en: 'Usage  /plugin update [name | all | patch | status]',
  },
  'cancelled': { zh: '已取消', en: 'Cancelled' },

  'question': { zh: '选择要更新的插件', en: 'Pick a plugin to update' },
  'question-detail': {
    zh: '共 {{count}} 个已安装插件 · 更新会改动 profile 依赖，可能需要重启 dsh-tui',
    en: '{{count}} installed plugin(s) · updating rewrites profile dependencies; a dsh-tui restart may be required',
  },
  'local-skip': { zh: '本地链接，跳过更新', en: 'local link, skipped' },
  'state-off': { zh: '未启用', en: 'disabled' },
  'opt-all': { zh: '⬆ 全部更新', en: '⬆ Update all' },
  'opt-all-desc': {
    zh: '更新全部 {{count}} 个可更新插件（本地 link 插件会跳过）',
    en: 'Update all {{count}} updatable plugin(s); local link/file plugins are skipped',
  },

  'no-plugins': {
    zh: '当前 profile 没有安装第三方插件。用 /plugin install <包名|路径|Git URL> 安装。',
    en: 'No third-party plugins are installed in this profile. Use /plugin install <package|path|git url>.',
  },
  'unknown-target': {
    zh: '未找到插件「{{name}}」。已安装：{{names}}',
    en: 'Plugin "{{name}}" is not installed. Installed: {{names}}',
  },
  'local-only': {
    zh: '「{{name}}」是本地 link/file 插件，没有可拉取的远程版本。',
    en: '"{{name}}" is a local link/file plugin; it has no remote version to pull.',
  },
  'nothing-updatable': {
    zh: '没有可更新的插件（全部是本地 link/file 依赖）。',
    en: 'Nothing to update: every installed plugin is a local link/file dependency.',
  },
  'updating': { zh: '正在更新 {{count}} 个插件…', en: 'Updating {{count}} plugin(s)…' },

  'update-ok': {
    zh: '✅ 已更新 {{count}} 个插件（profile: {{profile}}）',
    en: '✅ Updated {{count}} plugin(s) (profile: {{profile}})',
  },
  'update-uptodate': { zh: '已是最新版本', en: 'Already up to date' },
  'update-failed': {
    zh: '❌ 更新失败（退出码 {{code}}）',
    en: '❌ Update failed (exit code {{code}})',
  },
  'restart-hint': {
    zh: '重启 dsh-tui 后新版本生效（部分插件会由热重载自动接管）。',
    en: 'Restart dsh-tui to load the new versions (hot reload may apply some of them).',
  },
  'manual-hint': {
    zh: '可手动重试：{{command}}',
    en: 'Retry manually: {{command}}',
  },

  'patch-ok': {
    zh: '✅ 已写入 /plugin update 支持（dsh-tui {{version}}）。重启 dsh-tui 后生效。',
    en: '✅ Installed the /plugin update alias (dsh-tui {{version}}). Restart dsh-tui to apply.',
  },
  'patch-already': {
    zh: '✅ /plugin update 支持已就位（dsh-tui {{version}}）。',
    en: '✅ The /plugin update alias is already in place (dsh-tui {{version}}).',
  },
  'patch-failed': {
    zh: '❌ 写入失败：{{reason}}',
    en: '❌ Patch failed: {{reason}}',
  },
  'patch-needed': {
    zh: 'dsh-tui {{version}} 的 /plugin update 别名还没写入：运行 /plugin-update patch，然后重启 dsh-tui。',
    en: 'The /plugin update alias is missing for dsh-tui {{version}}: run /plugin-update patch, then restart dsh-tui.',
  },
  'patch-unsupported': {
    zh: '当前 dsh-tui {{version}} 的代码结构与补丁锚点不匹配；/plugin-update 仍可单独使用。',
    en: 'dsh-tui {{version}} does not match the patch anchors; /plugin-update still works on its own.',
  },
  'status-title': {
    zh: 'dsh-tui-plugin-update · profile {{profile}} · dsh-tui {{version}}',
    en: 'dsh-tui-plugin-update · profile {{profile}} · dsh-tui {{version}}',
  },
  'status-patch-on': { zh: '/plugin update 别名：已写入', en: '/plugin update alias: installed' },
  'status-patch-off': { zh: '/plugin update 别名：未写入（运行 /plugin-update patch）', en: '/plugin update alias: not installed (run /plugin-update patch)' },
  'status-plugin-line': {
    zh: '  {{name}} {{version}} · {{source}}{{state}}',
    en: '  {{name}} {{version}} · {{source}}{{state}}',
  },
  'status-state-off': { zh: ' · 未启用', en: ' · disabled' },
  'status-empty': { zh: '  （没有第三方插件）', en: '  (no third-party plugins)' },
}

const LANGS = new Set(['zh', 'en'])

function isLang(value) {
  return typeof value === 'string' && LANGS.has(value)
}

/**
 * Resolve the active language: env vars first (the TUI pins DSH_TUI_LANG at
 * start), then the persisted /lang choice, else zh.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {(path: string) => string} [readFile] - injectable for tests.
 */
export function detectLang(env = process.env, readFile = readFileSync) {
  if (isLang(env.DSH_TUI_LANG)) return env.DSH_TUI_LANG
  if (isLang(env.CC_TUI_LANG)) return env.CC_TUI_LANG
  try {
    const parsed = JSON.parse(readFile(join(homedir(), '.dsh-tui', 'lang.json'), 'utf8'))
    if (parsed !== null && typeof parsed === 'object' && isLang(parsed.lang)) return parsed.lang
  } catch {
    // No readable lang pref — fall through to the default.
  }
  return 'zh'
}

/**
 * Translate `key` in `lang`, substituting {{name}} placeholders. Missing keys
 * render the key itself so a typo is visible instead of silently blank.
 * @param {string} lang
 */
export function createT(lang) {
  return (key, params = {}) => {
    const entry = dict[key]
    const template = entry?.[lang] ?? entry?.zh ?? key
    return template.replace(/\{\{(\w+)\}\}/g, (match, name) =>
      name in params ? String(params[name]) : match)
  }
}

export const t = createT(detectLang())

export { dict }
