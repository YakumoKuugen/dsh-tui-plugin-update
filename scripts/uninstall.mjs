#!/usr/bin/env node
/**
 * Remove the `/plugin update` alias and uninstall the plugin from a profile.
 *
 *   node scripts/uninstall.mjs --profile dsh-tui
 */

import { removeHostPatch } from '../lib/patch.js'
import { assertProfile, hasDependency, helpText, parseArgs, profileDir, removeArgs, runDshInherit } from './cli.mjs'

async function main() {
  const options = parseArgs(process.argv.slice(2), { flags: ['no-remove'] })
  if (options.help) {
    console.log(helpText('uninstall', ' [--no-remove]'))
    return 0
  }
  assertProfile(options)
  console.log(`profile: ${options.profile} (${profileDir(options)})`)

  try {
    const result = removeHostPatch({ profile: options.profile, home: options.home, dryRun: options.dryRun })
    console.log(result.changed
      ? `${options.dryRun ? 'would restore' : 'restored'} dsh-tui ${result.dshTuiVersion} (removed /plugin update alias)`
      : `dsh-tui ${result.dshTuiVersion} was not patched`)
  } catch (error) {
    console.error(`restoring dsh-tui failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (options.noRemove) {
    console.log('skip: plugin removal (--no-remove)')
    return 0
  }
  if (!hasDependency(options) && !options.dryRun) {
    console.log('plugin is not a profile dependency; nothing to remove')
    return 0
  }
  const code = options.dryRun ? 0 : await runDshInherit(removeArgs(options.profile))
  console.log(code === 0 ? '\nDone. Restart dsh-tui.' : `\nremoving the plugin failed (exit ${code})`)
  return code
}

main().then(code => process.exit(code), error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
