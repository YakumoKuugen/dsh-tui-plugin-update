#!/usr/bin/env node
/**
 * Low-level host-patch CLI:
 *
 *   node scripts/patch.mjs status --profile dsh-tui
 *   node scripts/patch.mjs apply  --profile dsh-tui
 *   node scripts/patch.mjs remove --profile dsh-tui
 */

import { applyHostPatch, patchStatus, readPatchState, removeHostPatch } from '../lib/patch.js'
import { helpText, parseArgs } from './cli.mjs'

async function main() {
  const [command = 'status', ...rest] = process.argv.slice(2)
  if (command === '--help' || command === '-h' || command === 'help') {
    console.log([
      'Usage: node scripts/patch.mjs <status|apply|remove> [--profile <name>] [--home <dir>] [--dry-run]',
      '',
      helpText('patch'),
    ].join('\n'))
    return 0
  }
  const options = parseArgs(rest)
  if (options.help) {
    console.log(helpText('patch'))
    return 0
  }
  const args = { profile: options.profile, home: options.home, dryRun: options.dryRun }

  if (command === 'status') {
    const status = patchStatus(args)
    console.log(JSON.stringify({
      profile: options.profile,
      dshTuiDir: status.dir,
      dshTuiVersion: status.dshTuiVersion,
      supported: status.supported,
      patched: status.patched,
      missing: status.missing,
      state: readPatchState(args),
    }, null, 2))
    return 0
  }
  if (command === 'apply') {
    const result = applyHostPatch(args)
    console.log(JSON.stringify(result, null, 2))
    if (result.changed) console.log('Restart dsh-tui to load the patched modules.')
    return 0
  }
  if (command === 'remove') {
    const result = removeHostPatch(args)
    console.log(JSON.stringify(result, null, 2))
    return 0
  }
  console.error(`unknown command: ${command}`)
  return 1
}

main().then(code => process.exit(code), error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
