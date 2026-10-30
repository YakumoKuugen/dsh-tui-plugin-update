/**
 * Shared argument parsing and process helpers for the maintenance scripts.
 * These run outside the TUI (node scripts/…), so they use `dsh`/`dsh.cmd`
 * through the same invocation rule as the in-TUI updater.
 *
 * @module dsh-tui-plugin-update/scripts/cli
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshInvocation, shellQuote } from '../lib/update.js'

export const PACKAGE_NAME = 'dsh-tui-plugin-update'
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Parse `--profile`, `--home`, `--dry-run`, and script-specific flags. */
export function parseArgs(argv = process.argv.slice(2), { flags = [] } = {}) {
  const options = {
    profile: undefined,
    home: process.env.DSH_HOME || join(homedir(), '.dsh'),
    dryRun: false,
    help: false,
  }
  const knownFlags = new Set(['dry-run', 'help', ...flags])
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--profile') {
      const value = argv[++i]
      if (value === undefined || value === '' || value.startsWith('-')) throw new Error('--profile needs a name')
      options.profile = value
    } else if (arg.startsWith('--profile=')) {
      const value = arg.slice('--profile='.length)
      if (value === '') throw new Error('--profile needs a name')
      options.profile = value
    } else if (arg === '--home') {
      const value = argv[++i]
      if (value === undefined || value === '') throw new Error('--home needs a directory')
      options.home = resolve(value)
    } else if (arg.startsWith('--home=')) {
      options.home = resolve(arg.slice('--home='.length))
    } else if (arg.startsWith('--')) {
      const name = arg.slice(2)
      if (!knownFlags.has(name)) throw new Error(`unknown option --${name}`)
      options[camel(name)] = true
    } else {
      throw new Error(`unexpected argument: ${arg}`)
    }
  }
  if (options.profile === undefined) {
    options.profile = process.env.DSH_PROFILE || 'dsh-tui'
  }
  return options
}

function camel(name) {
  return name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
}

export function helpText(name, extra = '') {
  return [
    `Usage: node scripts/${name}.mjs [--profile <name>] [--home <dir>] [--dry-run]${extra}`,
    '',
    '  --profile <name>  dsh profile to operate on (default: $DSH_PROFILE or dsh-tui)',
    '  --home <dir>      DSH home (default: $DSH_HOME or ~/.dsh)',
    '  --dry-run         print the steps without changing files',
  ].join('\n')
}

export function profileDir(options) {
  return join(options.home, 'profiles', options.profile)
}

export function readManifest(options) {
  const file = join(profileDir(options), 'package.json')
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

export function hasDependency(options) {
  const manifest = readManifest(options)
  return manifest?.dependencies !== null
    && typeof manifest?.dependencies === 'object'
    && Object.hasOwn(manifest.dependencies, PACKAGE_NAME)
}

export function assertProfile(options) {
  const dir = profileDir(options)
  if (!existsSync(join(dir, 'package.json'))) {
    throw new Error(`profile "${options.profile}" is not initialized (${dir})`)
  }
  return dir
}

function invocationArgs(args) {
  const invocation = resolveDshInvocation()
  const spawnArgs = [...invocation.prefix]
  if (invocation.commandPrefix !== undefined) {
    spawnArgs.push(`${invocation.commandPrefix} ${shellQuote(args).join(' ')}`)
  } else {
    spawnArgs.push(...args)
  }
  return { file: invocation.file, args: spawnArgs, display: ['dsh', ...args.map(shellQuote)].join(' ') }
}

/** Run `dsh <args>` with inherited stdio; resolves the exit code. */
export function runDshInherit(args) {
  const { file, args: spawnArgs, display } = invocationArgs(args)
  console.log(`$ ${display}`)
  return new Promise(resolvePromise => {
    const child = spawn(file, spawnArgs, { stdio: 'inherit', windowsHide: false })
    child.on('error', error => {
      console.error(`failed to start: ${error.message}`)
      resolvePromise(1)
    })
    child.on('close', code => resolvePromise(code ?? 1))
  })
}

/** `dsh plugin --profile <name> add <spec>` */
export function addArgs(profile, spec = REPO_ROOT) {
  return ['plugin', '--profile', profile, 'add', spec]
}

/** `dsh plugin --profile <name> remove <name>` */
export function removeArgs(profile, name = PACKAGE_NAME) {
  return ['plugin', '--profile', profile, 'remove', name]
}
