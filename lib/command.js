/**
 * `/plugin update` / `/plugin-update` command flow.
 *
 * Every dependency (ask, candidate list, runner, patch control) is injected,
 * so node:test drives the whole flow headless with a scripted picker.
 *
 * @module dsh-tui-plugin-update/command
 */

import { resolveProfileName } from './profile.js'
import { describeSource } from './bundles.js'
import { displayCommand, updateArgs } from './update.js'
import { isUpToDate, tailLines } from './output.js'

const ALL_TOKENS = new Set(['all', '*', '全部', '全部更新'])

/** Whether a typed target means "every plugin". */
export function isAllToken(value) {
  return ALL_TOKENS.has(String(value ?? '').trim().toLowerCase())
}

/** One readable row for a candidate. */
export function describeCandidate(candidate, t = key => key) {
  const parts = []
  if (candidate.title !== undefined && candidate.title !== candidate.name) parts.push(candidate.title)
  if (candidate.version !== undefined) parts.push(`v${candidate.version}`)
  parts.push(describeSource(candidate))
  if (candidate.local) parts.push(t('local-skip'))
  if (candidate.enabled === false) parts.push(t('state-off'))
  return parts.join(' · ')
}

/** Picker rows: every installed plugin, then the "update all" action. */
export function buildOptions(candidates, t) {
  const updatable = candidates.filter(candidate => !candidate.local && candidate.availability !== 'missing')
  return [
    ...candidates.map(candidate => ({
      label: candidate.name,
      description: describeCandidate(candidate, t),
    })),
    {
      label: t('opt-all'),
      description: t('opt-all-desc', { count: updatable.length }),
    },
  ]
}

/** Resolve a typed target against the candidate rows. */
export function findCandidate(candidates, target) {
  const wanted = String(target ?? '').trim()
  if (wanted === '') return undefined
  return candidates.find(candidate => candidate.name === wanted)
    ?? candidates.find(candidate => candidate.name.toLowerCase() === wanted.toLowerCase())
    ?? candidates.find(candidate => candidate.title === wanted)
}

function updatableNames(candidates) {
  return candidates
    .filter(candidate => !candidate.local && candidate.availability !== 'missing')
    .map(candidate => candidate.name)
}

function namesFor(candidates) {
  return candidates.length === 0 ? '—' : candidates.map(candidate => candidate.name).join(', ')
}

function formatVersions(names, candidates, deps) {
  const byName = new Map(candidates.map(candidate => [candidate.name, candidate]))
  const lines = []
  for (const name of names) {
    const before = byName.get(name)?.version
    let after
    try {
      after = deps.readVersion?.(name)
    } catch {
      after = undefined
    }
    if (after !== undefined && before !== undefined && after !== before) {
      lines.push(`  ${name}  ${before} → ${after}`)
    } else if (after !== undefined) {
      lines.push(`  ${name}  ${after}`)
    } else {
      lines.push(`  ${name}${before === undefined ? '' : `  ${before}`}`)
    }
  }
  return lines
}

/**
 * Run one update (or a `patch` / `status` subcommand).
 *
 * @param {string} rawInput - Text after the command/subcommand name.
 * @param {{
 *   t: (key: string, params?: Record<string, unknown>) => string,
 *   lang?: string,
 *   profile?: string,
 *   home?: string,
 *   ask: (request: object) => Promise<{ answers: { id: string, selected: string[], custom?: string }[] }>,
 *   listCandidates: (profile: string) => Promise<object[]>,
 *   run: (args: readonly string[]) => Promise<{ code: number | null, stdout: string, stderr: string, timedOut: boolean, command: string }>,
 *   toast?: (text: string, options?: object) => void,
 *   readVersion?: (name: string) => string | undefined,
 *   patch: { status: () => object, apply: () => object },
 * }} deps
 * @returns {Promise<{ ok: boolean, lines: string[] }>}
 */
export async function runPluginUpdate(rawInput, deps) {
  const { t } = deps
  const input = String(rawInput ?? '').trim()
  const sub = input.split(/\s+/)[0]?.toLowerCase() ?? ''

  try {
    if (sub === 'patch') return runPatch(deps)
    if (sub === 'status') return await runStatus(deps)

    const profile = deps.profile === undefined ? resolveProfileName() : deps.profile
    if (profile === undefined || profile === '') return { ok: false, lines: [t('no-profile')] }

    const candidates = await deps.listCandidates(profile)
    if (candidates.length === 0) return { ok: false, lines: [t('no-plugins')] }

    let target = input
    if (target === '') {
      let answer
      try {
        answer = await deps.ask({
          questions: [{
            id: 'plugin-update',
            header: '/plugin update',
            question: t('question'),
            detail: t('question-detail', { count: candidates.length }),
            options: buildOptions(candidates, t),
            hideCustomInput: true,
          }],
        })
      } catch (error) {
        if (error !== null && typeof error === 'object' && error.name === 'UserQuestionError') {
          return { ok: true, lines: [t('cancelled')] }
        }
        throw error
      }
      const selected = answer?.answers?.find(item => item.id === 'plugin-update')?.selected ?? []
      const custom = answer?.answers?.find(item => item.id === 'plugin-update')?.custom?.trim() ?? ''
      // A bare submit (no row picked, no typed name) is a cancel, never an
      // accidental "all".
      if (selected.length === 0 && custom === '') return { ok: true, lines: [t('cancelled')] }
      target = selected[0] ?? custom
      // The picker's "update all" row is a label, not a typed token.
      if (target === t('opt-all')) target = 'all'
    }

    let names
    if (isAllToken(target)) {
      names = updatableNames(candidates)
      if (names.length === 0) return { ok: false, lines: [t('nothing-updatable')] }
    } else {
      const candidate = findCandidate(candidates, target)
      if (candidate === undefined) {
        return { ok: false, lines: [t('unknown-target', { name: target, names: namesFor(candidates) })] }
      }
      if (candidate.local || candidate.availability === 'missing') {
        return { ok: false, lines: [t('local-only', { name: candidate.name })] }
      }
      names = [candidate.name]
    }

    deps.toast?.(t('updating', { count: names.length }), { timeoutMs: 8000 })
    const args = updateArgs(profile, names)
    const result = await deps.run(args)

    if (result.code !== 0) {
      const lines = [t('update-failed', { code: result.code ?? '—' })]
      const tail = tailLines(`${result.stdout}\n${result.stderr}`)
      if (tail.length > 0) lines.push(...tail.map(line => `  ${line}`))
      lines.push(t('manual-hint', { command: result.command ?? displayCommand(args) }))
      return { ok: false, lines }
    }

    const lines = [t('update-ok', { count: names.length, profile })]
    lines.push(...formatVersions(names, candidates, deps))
    if (isUpToDate(`${result.stdout}\n${result.stderr}`)) lines.push(`  ${t('update-uptodate')}`)
    lines.push(t('restart-hint'))
    return { ok: true, lines }
  } catch (error) {
    return {
      ok: false,
      lines: [t('update-failed', { code: '—' }), `  ${error instanceof Error ? error.message : String(error)}`],
    }
  }
}

function runPatch(deps) {
  const { t } = deps
  const profile = deps.profile === undefined ? resolveProfileName() : deps.profile
  if (profile === undefined || profile === '') return { ok: false, lines: [t('no-profile')] }
  try {
    const status = deps.patch.status()
    if (!status.supported) {
      return {
        ok: false,
        lines: [t('patch-unsupported', { version: status.dshTuiVersion ?? 'unknown' })],
      }
    }
    if (status.patched) return { ok: true, lines: [t('patch-already', { version: status.dshTuiVersion ?? 'unknown' })] }
    const result = deps.patch.apply()
    return {
      ok: true,
      lines: [t('patch-ok', { version: result.dshTuiVersion ?? status.dshTuiVersion ?? 'unknown' })],
    }
  } catch (error) {
    return {
      ok: false,
      lines: [t('patch-failed', { reason: error instanceof Error ? error.message : String(error) })],
    }
  }
}

function runStatus(deps) {
  const { t } = deps
  const profile = deps.profile === undefined ? resolveProfileName() : deps.profile
  if (profile === undefined || profile === '') return { ok: false, lines: [t('no-profile')] }
  const status = deps.patch.status()
  const lines = [t('status-title', {
    profile,
    version: status.dshTuiVersion ?? 'unknown',
  })]
  lines.push(status.patched ? t('status-patch-on') : t('status-patch-off'))
  return deps.listCandidates(profile).then(candidates => {
    if (candidates.length === 0) {
      lines.push(t('status-empty'))
      return { ok: true, lines }
    }
    for (const candidate of candidates) {
      lines.push(t('status-plugin-line', {
        name: candidate.name,
        version: candidate.version === undefined ? '' : `v${candidate.version}`,
        source: describeSource(candidate),
        state: candidate.enabled === false ? t('status-state-off') : '',
      }))
    }
    return { ok: true, lines }
  })
}
