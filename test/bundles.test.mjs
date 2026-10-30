import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  candidatesFromBundles,
  candidatesFromManifest,
  describeSource,
  isCoreBundle,
  isLocalSpec,
  localizedTitle,
  readProfileManifest,
} from '../lib/bundles.js'

test('core bundles are never candidates', () => {
  assert.equal(isCoreBundle('@deepseek-harness-tui/dsh-tui'), true)
  assert.equal(isCoreBundle('@deepseek-ai/dsh-base'), true)
  assert.equal(isCoreBundle('dsh-tui-market'), false)
})

test('local specs are recognized', () => {
  assert.equal(isLocalSpec('link:D:/Project/x'), true)
  assert.equal(isLocalSpec('file:../x'), true)
  assert.equal(isLocalSpec('workspace:*'), true)
  assert.equal(isLocalSpec('github:o/r'), false)
  assert.equal(isLocalSpec('^1.2.3'), false)
})

test('candidatesFromBundles filters, localizes and sorts', () => {
  const rows = candidatesFromBundles([
    { name: '@deepseek-harness-tui/dsh-tui', installed: true, enabled: true },
    { name: '@deepseek-ai/dsh-base', installed: true, enabled: true },
    {
      name: 'zeta',
      installed: true,
      enabled: false,
      version: '2.0.0',
      source: 'link:D:/z',
      availability: 'profile',
      meta: { title: { zh: '泽塔', en: 'Zeta' } },
    },
    {
      name: 'alpha',
      installed: true,
      enabled: true,
      version: '1.0.0',
      source: 'github:o/a',
      availability: 'profile',
      meta: { title: 'Alpha' },
    },
    { name: 'not-installed', installed: false, enabled: true },
  ], 'zh')
  assert.deepEqual(rows.map(row => row.name), ['alpha', 'zeta'])
  assert.equal(rows[0].title, 'Alpha')
  assert.equal(rows[1].title, '泽塔')
  assert.equal(rows[1].enabled, false)
  assert.equal(rows[1].local, true)
  assert.equal(describeSource(rows[1]), 'local link')
})

test('localizedTitle falls back through language, zh, en and the default', () => {
  assert.equal(localizedTitle({ en: 'E', zh: '中' }, 'en', 'x'), 'E')
  assert.equal(localizedTitle({ zh: '中' }, 'en', 'x'), '中')
  assert.equal(localizedTitle({ en: 'E' }, 'zh', 'x'), 'E')
  assert.equal(localizedTitle(undefined, 'zh', 'x'), 'x')
})

test('candidatesFromManifest includes selected and declared bundles, excludes helpers', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-pu-manifest-'))
  const profilePath = join(home, 'profiles', 'p')
  try {
    mkdirSync(join(profilePath, 'node_modules', 'alpha'), { recursive: true })
    mkdirSync(join(profilePath, 'node_modules', 'beta'), { recursive: true })
    mkdirSync(join(profilePath, 'node_modules', 'helper'), { recursive: true })
    writeFileSync(join(profilePath, 'node_modules', 'alpha', 'package.json'), JSON.stringify({
      name: 'alpha', version: '1.2.3', dsh: { bundle: { patch: './cordis.patch.yml' } },
    }))
    writeFileSync(join(profilePath, 'node_modules', 'alpha', 'dsh-plugin.json'), JSON.stringify({
      name: 'alpha', displayName: 'Alpha Plugin',
    }))
    writeFileSync(join(profilePath, 'node_modules', 'beta', 'package.json'), JSON.stringify({
      name: 'beta', version: '4.5.6', dsh: { bundle: { patch: './cordis.patch.yml' } },
    }))
    writeFileSync(join(profilePath, 'node_modules', 'helper', 'package.json'), JSON.stringify({
      name: 'helper', version: '0.0.1',
    }))
    const manifest = {
      dependencies: {
        alpha: 'github:o/alpha',
        beta: '^4.0.0',
        helper: '^0.0.1',
        '@deepseek-ai/dsh-base': '1.0.0',
      },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'alpha'] } },
    }
    writeFileSync(join(profilePath, 'package.json'), JSON.stringify(manifest))
    const read = readProfileManifest(profilePath)
    assert.deepEqual(read, manifest)

    const rows = candidatesFromManifest(read, profilePath, { lang: 'en' })
    // alpha: selected; beta: declares a bundle but is disabled; helper: plain dependency.
    assert.deepEqual(rows.map(row => row.name), ['alpha', 'beta'])
    assert.equal(rows[0].title, 'Alpha Plugin')
    assert.equal(rows[0].enabled, true)
    assert.equal(rows[0].version, '1.2.3')
    assert.equal(rows[0].local, false)
    assert.equal(rows[1].enabled, false)
    assert.equal(rows[1].version, '4.5.6')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('manifest fallback keeps a selected bundle whose files are missing', () => {
  const rows = candidatesFromManifest({
    dependencies: { ghost: 'github:o/ghost' },
    dsh: { profile: { bundles: ['ghost'] } },
  }, join(tmpdir(), 'does-not-exist-dsh-pu'), { lang: 'zh' })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].availability, 'missing')
  assert.equal(describeSource(rows[0]), 'missing')
})
