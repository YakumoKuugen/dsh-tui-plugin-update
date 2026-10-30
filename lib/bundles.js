/**
 * What "all plugins" means for this command: the same set `/plugin list`
 * shows — profile-installed bundles, never the composition (`dsh-tui`) or the
 * official `@deepseek-ai/*` layers.
 *
 * The host's `pluginManager` is authoritative but optional (#183: consumers
 * soft-probe it). When it is absent (a non-DSH kernel, an older host), this
 * module reads the profile's own package.json instead, so the picker still
 * works and still excludes the same names.
 *
 * @module dsh-tui-plugin-update/bundles
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TUI_PACKAGE } from './profile.js'

/** Local specs pnpm cannot refresh from a registry/remote. */
const LOCAL_SPEC = /^(?:link:|file:|workspace:|portal:)/i

/** Whether a dependency spec points at local files rather than a remote source. */
export function isLocalSpec(spec) {
  return typeof spec === 'string' && LOCAL_SPEC.test(spec)
}

/** Whether a bundle is part of the composition rather than a user plugin. */
export function isCoreBundle(name) {
  return name === TUI_PACKAGE || name.startsWith('@deepseek-ai/')
}

/** Resolve a possibly-localized title field to one language. */
export function localizedTitle(value, lang, fallback) {
  if (typeof value === 'string' && value !== '') return value
  if (value !== null && typeof value === 'object') {
    const translated = value[lang]
    if (typeof translated === 'string' && translated !== '') return translated
    if (typeof value.zh === 'string' && value.zh !== '') return value.zh
    if (typeof value.en === 'string' && value.en !== '') return value.en
  }
  return fallback
}

/** One picker/update row from a `BundleInfo`. */
export function candidateFromBundle(bundle, lang = 'zh') {
  const source = typeof bundle.source === 'string' ? bundle.source : undefined
  return {
    name: bundle.name,
    title: localizedTitle(bundle.meta?.title, lang, bundle.name),
    version: typeof bundle.version === 'string' && bundle.version !== '' ? bundle.version : undefined,
    source,
    enabled: bundle.enabled !== false,
    local: isLocalSpec(source),
    availability: bundle.availability ?? (bundle.error === undefined ? 'profile' : 'missing'),
    error: bundle.error?.code,
  }
}

/**
 * Map `pluginManager.listBundles()` output to candidates. Filtering mirrors
 * dsh-TUI's `extraBundles`: installed profile dependencies only, minus the
 * composition's own packages.
 */
export function candidatesFromBundles(bundles, lang = 'zh') {
  if (!Array.isArray(bundles)) return []
  return bundles
    .filter(bundle => bundle !== null && typeof bundle === 'object'
      && bundle.installed === true
      && typeof bundle.name === 'string'
      && !isCoreBundle(bundle.name))
    .map(bundle => candidateFromBundle(bundle, lang))
    .sort(compareCandidates)
}

function compareCandidates(a, b) {
  return a.name.localeCompare(b.name)
}

/** Read a package's version and display title from the profile install tree. */
function readInstalledPackage(profilePath, name, readFile = readFileSync, exists = existsSync) {
  const root = join(profilePath, 'node_modules', ...name.split('/'))
  const readJson = (file) => {
    try {
      const parsed = JSON.parse(readFile(file, 'utf8'))
      return parsed !== null && typeof parsed === 'object' ? parsed : undefined
    } catch {
      return undefined
    }
  }
  const pkg = readJson(join(root, 'package.json'))
  const declaration = readJson(join(root, 'dsh-plugin.json'))
  return {
    root,
    present: exists(join(root, 'package.json')),
    packageJson: pkg,
    declaration,
  }
}

/**
 * Fallback candidate list straight from the profile manifest.
 *
 * A dependency counts as a plugin when the profile selects it as a bundle or
 * the installed package declares a bundle patch; that keeps helper libraries
 * out while still showing a disabled plugin (declared but not selected).
 * @param {{ dependencies?: Record<string, string>, dsh?: { profile?: { bundles?: string[] } } }} manifest
 * @param {string} profilePath
 */
export function candidatesFromManifest(manifest, profilePath, {
  lang = 'zh',
  readFile = readFileSync,
  exists = existsSync,
} = {}) {
  const dependencies = manifest !== null && typeof manifest === 'object' && manifest.dependencies !== null
    && typeof manifest.dependencies === 'object' && !Array.isArray(manifest.dependencies)
    ? manifest.dependencies
    : {}
  const bundles = Array.isArray(manifest?.dsh?.profile?.bundles)
    ? new Set(manifest.dsh.profile.bundles.filter(name => typeof name === 'string'))
    : new Set()

  const rows = []
  for (const [name, spec] of Object.entries(dependencies)) {
    if (isCoreBundle(name)) continue
    const installed = readInstalledPackage(profilePath, name, readFile, exists)
    const declaresBundle = installed.packageJson?.dsh?.bundle !== undefined
      || installed.declaration !== undefined
      || installed.packageJson?.dsh?.plugin !== undefined
    const selected = bundles.has(name)
    if (!selected && !declaresBundle) continue
    const title = localizedTitle(
      installed.declaration?.displayName ?? installed.declaration?.name,
      lang,
      name,
    )
    rows.push({
      name,
      title,
      version: typeof installed.packageJson?.version === 'string' ? installed.packageJson.version : undefined,
      source: typeof spec === 'string' ? spec : undefined,
      enabled: selected,
      local: isLocalSpec(spec),
      availability: installed.present ? 'profile' : 'missing',
      error: installed.present ? undefined : 'missing',
    })
  }
  return rows.sort(compareCandidates)
}

/**
 * Read a profile's package.json.
 * @returns {object | undefined}
 */
export function readProfileManifest(profilePath, readFile = readFileSync) {
  try {
    const parsed = JSON.parse(readFile(join(profilePath, 'package.json'), 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * The authoritative list when the host service exists; the manifest fallback
 * otherwise. Never throws: a broken profile answers an empty list.
 * @param {import('@deepseek-ai/cordis').Context | undefined} ctx
 * @param {string} profile
 * @param {string} home
 */
export async function listCandidates(ctx, profile, home, { lang = 'zh' } = {}) {
  const manager = ctx?.get?.('pluginManager', false)
  if (manager !== undefined && manager !== null && typeof manager.listBundles === 'function') {
    try {
      const bundles = await manager.listBundles()
      return candidatesFromBundles(bundles, lang)
    } catch {
      // Fall through to the manifest: a service failure should still leave a
      // usable picker rather than an error screen.
    }
  }
  const profilePath = join(home, 'profiles', profile)
  const manifest = readProfileManifest(profilePath)
  if (manifest === undefined) return []
  return candidatesFromManifest(manifest, profilePath, { lang })
}

/** Short human description of a candidate's source. */
export function describeSource(candidate) {
  const source = candidate.source ?? ''
  if (candidate.availability === 'missing') return 'missing'
  if (candidate.local) return 'local link'
  if (/^(?:github:|git\+|git:|https?:\/\/)/i.test(source)) return 'git'
  return 'registry'
}
