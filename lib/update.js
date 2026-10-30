/**
 * Run the official `dsh plugin update` path. The dsh CLI forwards the
 * remaining arguments to pnpm inside the profile directory and wraps the run
 * with its compatibility check and profile lock — the same machinery
 * `dsh plugin add` uses. We deliberately do not reimplement pnpm here.
 *
 * `--latest` is what makes this a plugin UPDATE rather than a range-respecting
 * `pnpm update`: an exact pin (`@scope/pkg@1.2.3`) or a git spec must move to
 * the newest release/commit. The dsh wrapper still refuses a result that the
 * running DSH version cannot load.
 *
 * @module dsh-tui-plugin-update/update
 */

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const UPDATE_TIMEOUT_MS = 300_000
export const OUTPUT_LIMIT = 128 * 1024

/** cmd.exe joins spawn arguments with spaces; quote anything that could split. */
export function shellQuote(args) {
  return args.map(arg => (/[ \t"^&|<>()]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg))
}

/**
 * How to invoke the same dsh CLI that launched this TUI.
 *
 * `process.argv[1]` is `…/@deepseek-ai/dsh/lib/bin.js` under a profile boot, so
 * running it through the current node binary is exact and needs no PATH/shim
 * guess. A source checkout or a test runner falls back to the `dsh` shim.
 */
export function resolveDshInvocation({
  argv = process.argv,
  env = process.env,
  platform = process.platform,
  execPath = process.execPath,
} = {}) {
  const bin = argv[1]
  if (typeof bin === 'string' && /[\\/]dsh[\\/]lib[\\/]bin\.js$/i.test(bin)) {
    return { file: execPath, prefix: [bin], shell: false }
  }
  if (typeof env.DSH_BIN === 'string' && env.DSH_BIN !== '') {
    return { file: env.DSH_BIN, prefix: [], shell: false }
  }
  if (platform === 'win32') {
    return { file: 'cmd.exe', prefix: ['/d', '/s', '/c'], shell: false, commandPrefix: 'dsh' }
  }
  return { file: 'dsh', prefix: [], shell: false }
}

/**
 * The pnpm arguments, in the vocabulary `dsh plugin` forwards.
 * @param {string} profile
 * @param {readonly string[]} names
 */
export function updateArgs(profile, names, { latest = true } = {}) {
  return [
    'plugin',
    '--profile',
    profile,
    'update',
    ...(latest ? ['--latest'] : []),
    ...names,
  ]
}

/** Human-readable command line for hints. */
export function displayCommand(args) {
  return ['dsh', ...shellQuote(args)].join(' ')
}

function appendBounded(bucket, chunk) {
  const text = chunk.toString('utf8')
  if (text === '') return
  bucket.push(text)
  let total = bucket.reduce((sum, part) => sum + part.length, 0)
  while (total > OUTPUT_LIMIT && bucket.length > 1) {
    const first = bucket[0]
    const excess = total - OUTPUT_LIMIT
    if (first.length <= excess) {
      bucket.shift()
      total -= first.length
    } else {
      bucket[0] = first.slice(excess)
      total -= excess
    }
  }
  if (total > OUTPUT_LIMIT && bucket.length === 1) {
    bucket[0] = bucket[0].slice(-OUTPUT_LIMIT)
  }
}

/**
 * Run `dsh <args>` without throwing.
 * @param {readonly string[]} args
 * @param {{
 *   spawnImpl?: typeof spawn,
 *   platform?: NodeJS.Platform,
 *   timeoutMs?: number,
 *   argv?: readonly string[],
 *   env?: NodeJS.ProcessEnv,
 *   execPath?: string,
 * }} [options]
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string, timedOut: boolean, command: string }>}
 */
export function runDsh(args, {
  spawnImpl = spawn,
  platform = process.platform,
  timeoutMs = UPDATE_TIMEOUT_MS,
  argv = process.argv,
  env = process.env,
  execPath = process.execPath,
} = {}) {
  return new Promise(resolve => {
    const invocation = resolveDshInvocation({ argv, env, platform, execPath })
    let file = invocation.file
    let spawnArgs = [...invocation.prefix]
    if (invocation.commandPrefix !== undefined) {
      spawnArgs.push(`${invocation.commandPrefix} ${shellQuote(args).join(' ')}`)
    } else {
      spawnArgs.push(...args)
    }

    const stdout = []
    const stderr = []
    let settled = false
    let timedOut = false
    let child
    let timer

    const finish = (code) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      resolve({
        code: code ?? null,
        stdout: stdout.join(''),
        stderr: stderr.join(''),
        timedOut,
        command: displayCommand(args),
      })
    }

    timer = timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true
        try {
          child?.kill('SIGTERM')
        } catch {
          // The child already exited.
        }
        // A wedged tree still needs an answer; give the normal close path a
        // moment, then settle as a timeout.
        setTimeout(() => finish(null), 2_000).unref?.()
      }, timeoutMs)
      : undefined

    try {
      child = spawnImpl(file, spawnArgs, {
        cwd: undefined,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      finish(1)
      return
    }

    child.stdout?.on('data', chunk => appendBounded(stdout, chunk))
    child.stderr?.on('data', chunk => appendBounded(stderr, chunk))
    child.on('error', () => finish(1))
    child.on('close', code => finish(code))
  })
}

/** Read one installed package's version after an update. */
export function readInstalledVersion(profilePath, name, readFile = readFileSync) {
  try {
    const parsed = JSON.parse(readFile(join(profilePath, 'node_modules', ...name.split('/'), 'package.json'), 'utf8'))
    return typeof parsed?.version === 'string' ? parsed.version : undefined
  } catch {
    return undefined
  }
}
