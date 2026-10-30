#!/usr/bin/env node
/**
 * Install the plugin into a profile and teach the profile's dsh-tui copy the
 * `/plugin update` alias.
 *
 * The TUI does not need to be running for this; it must be restarted afterwards
 * so the patched dsh-tui modules load. Run it from a terminal:
 *
 *   node scripts/install.mjs --profile dsh-tui
 */

import { applyHostPatch, patchStatus } from '../lib/patch.js'
import { addArgs, assertProfile, helpText, parseArgs, PACKAGE_NAME, profileDir, REPO_ROOT, runDshInherit } from './cli.mjs'

async function main() {
  const options = parseArgs(process.argv.slice(2), { flags: ['no-add', 'no-patch'] })
  if (options.help) {
    console.log(helpText('install', ' [--no-add] [--no-patch]'))
    return 0
  }
  assertProfile(options)
  console.log(`profile: ${options.profile} (${profileDir(options)})`)

  if (options.noAdd) {
    console.log('skip: plugin install (--no-add)')
  } else if (options.dryRun) {
    console.log(`would run: dsh plugin --profile ${options.profile} add ${REPO_ROOT}`)
  } else {
    // Re-running `dsh plugin add` refreshes a local link/file dependency and is
    // the supported way to (re)select the bundle.
    const code = await runDshInherit(addArgs(options.profile))
    if (code !== 0) {
      console.error(`\ninstalling ${PACKAGE_NAME} failed (exit ${code}); the host patch was not written`)
      return code
    }
  }

  if (options.noPatch) {
    console.log('skip: /plugin update alias (--no-patch); use /plugin-update for now')
    return 0
  }

  const before = patchStatus({ profile: options.profile, home: options.home })
  if (!before.supported) {
    console.error(`\ncannot patch dsh-tui ${before.dshTuiVersion ?? 'unknown'}: ${before.missing.join(', ')}`)
    console.error('The plugin is installed and /plugin-update still works; /plugin update needs a compatible dsh-tui.')
    return 1
  }
  const result = applyHostPatch({ profile: options.profile, home: options.home, dryRun: options.dryRun })
  console.log(result.changed
    ? `${options.dryRun ? 'would patch' : 'patched'} dsh-tui ${result.dshTuiVersion} → /plugin update`
    : `already patched dsh-tui ${result.dshTuiVersion} → /plugin update`)

  console.log([
    '',
    'Done. Restart dsh-tui, then:',
    '  /plugin update            # picker: every plugin + 全部更新',
    '  /plugin update <name>     # update one plugin',
    '  /plugin update all        # update every plugin',
    '',
    'After a dsh-tui upgrade the alias is gone again; run /plugin-update patch (or this installer) and restart.',
  ].join('\n'))
  return 0
}

main().then(code => process.exit(code), error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
