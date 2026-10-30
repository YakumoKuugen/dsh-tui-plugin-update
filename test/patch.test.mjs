import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  applyHostPatch,
  COMPLETIONS_FILE,
  inspectDshTui,
  patchCommandCompletions,
  patchPluginsInfo,
  patchStatus,
  PLUGINS_INFO_FILE,
  readPatchState,
  removeHostPatch,
  REPORT_MARKER,
  COMPLETIONS_MARKER,
  unpatchCommandCompletions,
  unpatchPluginsInfo,
} from '../lib/patch.js'

const PROFILE = 'dsh-tui'

function dshTuiDir() {
  const home = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '', '.dsh')
  return join(home, 'profiles', PROFILE, 'node_modules', '@deepseek-harness-tui', 'dsh-tui')
}

const realDir = dshTuiDir()
const hasReal = existsSync(join(realDir, PLUGINS_INFO_FILE)) && existsSync(join(realDir, COMPLETIONS_FILE))

function syntaxOk(source, name) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pu-syntax-'))
  const file = join(dir, `${name}.mjs`)
  try {
    writeFileSync(file, source, 'utf8')
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('patch/unpatch plugins-info is exact and idempotent', { skip: !hasReal }, () => {
  const original = readFileSync(join(realDir, PLUGINS_INFO_FILE), 'utf8')
  const patched = patchPluginsInfo(original)
  assert.equal(patched.changed, true)
  assert.match(patched.source, /if \(sub === 'update'\)/)
  assert.ok(patched.source.includes(REPORT_MARKER))
  assert.ok(patched.source.includes("kind: 'update'"))
  syntaxOk(patched.source, 'plugins-info')

  const again = patchPluginsInfo(patched.source)
  assert.equal(again.changed, false)
  assert.equal(again.source, patched.source)

  const restored = unpatchPluginsInfo(patched.source)
  assert.equal(restored.changed, true)
  assert.equal(restored.source, original)
})

test('patch/unpatch completions is exact and idempotent', { skip: !hasReal }, () => {
  const original = readFileSync(join(realDir, COMPLETIONS_FILE), 'utf8')
  const patched = patchCommandCompletions(original)
  assert.equal(patched.changed, true)
  assert.ok(patched.source.includes(COMPLETIONS_MARKER))
  assert.ok(patched.source.includes("name: 'update', description: 'Update installed plugins'"))
  assert.ok(patched.source.includes("name: 'all'"))
  syntaxOk(patched.source, 'completions')

  const again = patchCommandCompletions(patched.source)
  assert.equal(again.changed, false)

  const restored = unpatchCommandCompletions(patched.source)
  assert.equal(restored.changed, true)
  assert.equal(restored.source, original)
})

test('inspectDshTui recognizes the current install', { skip: !hasReal }, () => {
  const status = inspectDshTui(realDir)
  assert.equal(status.supported, true)
  assert.equal(status.patched, false)
  assert.deepEqual(status.missing, [])
})

test('apply/remove on a copied install writes, verifies and restores', { skip: !hasReal }, () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-pu-home-'))
  const dir = join(home, 'profiles', 'p', 'node_modules', '@deepseek-harness-tui', 'dsh-tui')
  const packageJson = join(realDir, 'package.json')
  try {
    mkdirSync(join(dir, 'lib/types/dsh-adapter/channel'), { recursive: true })
    cpSync(packageJson, join(dir, 'package.json'), { recursive: false, force: true })
    for (const rel of [PLUGINS_INFO_FILE, COMPLETIONS_FILE]) {
      cpSync(join(realDir, rel), join(dir, rel), { recursive: false, force: true })
    }
    const originals = Object.fromEntries([PLUGINS_INFO_FILE, COMPLETIONS_FILE]
      .map(rel => [rel, readFileSync(join(dir, rel), 'utf8')]))

    const first = applyHostPatch({ profile: 'p', home })
    assert.equal(first.changed, true)
    assert.equal(patchStatus({ profile: 'p', home }).patched, true)
    assert.equal(readPatchState({ profile: 'p', home }).plugin, 'dsh-tui-plugin-update')

    const second = applyHostPatch({ profile: 'p', home })
    assert.equal(second.changed, false)

    const removed = removeHostPatch({ profile: 'p', home })
    assert.equal(removed.changed, true)
    assert.equal(readFileSync(join(dir, PLUGINS_INFO_FILE), 'utf8'), originals[PLUGINS_INFO_FILE])
    assert.equal(readFileSync(join(dir, COMPLETIONS_FILE), 'utf8'), originals[COMPLETIONS_FILE])
    assert.equal(patchStatus({ profile: 'p', home }).patched, false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
