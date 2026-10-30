import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = name => JSON.parse(readFileSync(join(root, name), 'utf8'))

test('manifest, legacy plugin file and package.json agree', () => {
  const pkg = read('package.json')
  const manifest = read('dsh-plugin.json')
  const legacy = read('dsh.plugin.json')
  assert.equal(pkg.name, 'dsh-tui-plugin-update')
  assert.equal(manifest.id, pkg.name)
  assert.equal(manifest.version, pkg.version)
  assert.equal(legacy.version, pkg.version)
  assert.equal(legacy.entry, manifest.facets.host.entry)
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(existsSync(join(root, manifest.facets.host.entry)))
  assert.ok(existsSync(join(root, 'cordis.patch.yml')))
})

test('package ships the dsh-tui plugin icon and exports it', () => {
  const pkg = read('package.json')
  assert.equal(pkg.icon, './assets/icon.svg')
  assert.equal(pkg.exports['./icon'], pkg.icon)
  assert.ok(pkg.files.includes('assets/icon.svg'), 'npm pack must include the icon')
  const iconPath = join(root, pkg.icon)
  assert.ok(existsSync(iconPath), `${pkg.icon} must exist`)
  const svg = readFileSync(iconPath, 'utf8')
  assert.match(svg, /<svg[^>]*viewBox="0 0 36 36"/u)
  assert.match(svg, /role="img"/u)
  assert.match(svg, /<title[^>]*>dsh-tui-plugin-update<\/title>/u)
})

test('README marks the package as a dsh-TUI plugin', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8')
  // Ecosystem listing asks for a dsh-TUI backlink; the ecosystem plugins put
  // that line directly under the title.
  assert.match(readme, /https:\/\/github\.com\/ccch1mneyyy\/dsh-TUI/u)
  assert.match(readme, /https:\/\/dshtui\.com/u)
})

test('commands.invoke scope is the declared command id and matches the parser', () => {
  const manifest = read('dsh-plugin.json')
  const command = manifest.contributes.commands[0]
  const permission = manifest.permissions.find(entry => entry.name === 'commands.invoke')
  assert.ok(permission)
  assert.equal(permission.name, 'commands.invoke')
  assert.equal(permission.scope, command.id)
  // Mirrors dsh-tui's normalizePermissionScope grammar for commands.invoke.
  assert.match(permission.scope, /^[a-z][a-z0-9]*(?:[.-][a-z0-9][a-z0-9-]*)+$/u)
})

test('bundle patch inserts the row this package declares', () => {
  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /id: dsh-tui-plugin-update/)
  assert.match(patch, /name: dsh-tui-plugin-update/)
  assert.match(patch, /commands/)
  assert.match(patch, /userQuestions/)
})
