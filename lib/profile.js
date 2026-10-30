/**
 * Profile and dsh-home locations. The TUI was launched by `dsh --profile
 * <name>`, so argv is the authoritative source (matching dsh-TUI's own
 * resolveDshProfileName); the env var is only a fallback for wrappers.
 *
 * @module dsh-tui-plugin-update/profile
 */

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const TUI_PACKAGE = '@deepseek-harness-tui/dsh-tui'

/**
 * The profile this process was booted with.
 * @param {readonly string[]} [argv]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | undefined}
 */
export function resolveProfileName(argv = process.argv, env = process.env) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--profile') {
      const value = argv[i + 1]
      if (value !== undefined && value !== '' && !value.startsWith('-')) return value
      return undefined
    }
    if (arg.startsWith('--profile=')) {
      const value = arg.slice('--profile='.length)
      return value !== '' ? value : undefined
    }
  }
  return typeof env.DSH_PROFILE === 'string' && env.DSH_PROFILE !== '' ? env.DSH_PROFILE : undefined
}

/** DSH home: $DSH_HOME over ~/.dsh. */
export function dshHome(env = process.env) {
  return typeof env.DSH_HOME === 'string' && env.DSH_HOME !== '' ? env.DSH_HOME : join(homedir(), '.dsh')
}

/** Absolute profile directory. */
export function profileDir(profile, home = dshHome()) {
  return join(home, 'profiles', profile)
}

/**
 * The dsh-TUI package this profile actually loads.
 * @param {{ profile?: string, home?: string, fromUrl?: string | URL }} [options]
 * @returns {string | undefined}
 */
export function resolveDshTuiDir({ profile, home = dshHome(), fromUrl = import.meta.url } = {}) {
  const candidates = []
  if (profile !== undefined && profile !== '') {
    candidates.push(join(profileDir(profile, home), 'node_modules', '@deepseek-harness-tui', 'dsh-tui'))
  }
  try {
    const require = createRequire(fromUrl)
    candidates.push(dirname(require.resolve(`${TUI_PACKAGE}/package.json`)))
  } catch {
    // Not resolvable from the plugin (a bare checkout): the profile candidate is
    // the only honest answer.
  }
  for (const dir of candidates) {
    if (existsSync(join(dir, 'package.json'))) return dir
  }
  return undefined
}
