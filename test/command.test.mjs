import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildOptions, findCandidate, isAllToken, runPluginUpdate } from '../lib/command.js'

const t = (key, params = {}) => Object.keys(params).length > 0
  ? `${key}:${JSON.stringify(params)}`
  : key

const candidates = [
  { name: 'alpha', title: 'Alpha', version: '1.0.0', source: 'github:o/a', enabled: true, local: false, availability: 'profile' },
  { name: 'beta', title: 'Beta', version: '2.0.0', source: 'link:D:/beta', enabled: true, local: true, availability: 'profile' },
  { name: 'gamma', title: 'Gamma', version: '3.0.0', source: '^3.0.0', enabled: false, local: false, availability: 'profile' },
]

function deps(overrides = {}) {
  const runs = []
  return {
    t,
    profile: 'p',
    ask: async () => ({ answers: [{ id: 'plugin-update', selected: ['alpha'] }] }),
    listCandidates: async () => candidates,
    run: async (args) => {
      runs.push(args)
      return { code: 0, stdout: 'Done in 1s', stderr: '', timedOut: false, command: `dsh ${args.join(' ')}` }
    },
    toast: () => true,
    readVersion: name => name === 'alpha' ? '1.1.0' : undefined,
    patch: {
      status: () => ({ supported: true, patched: false, dshTuiVersion: '0.17.0' }),
      apply: () => ({ changed: true, dshTuiVersion: '0.17.0' }),
    },
    ...overrides,
    __runs: runs,
  }
}

test('bare update picks one plugin and runs pnpm --latest', async () => {
  const d = deps()
  const result = await runPluginUpdate('', d)
  assert.equal(result.ok, true)
  assert.deepEqual(d.__runs[0], ['plugin', '--profile', 'p', 'update', '--latest', 'alpha'])
  assert.ok(result.lines[0].startsWith('update-ok'))
  assert.ok(result.lines.some(line => line.includes('1.0.0 → 1.1.0')))
  assert.ok(result.lines.includes('restart-hint'))
})

test('picked "all" skips local links and includes disabled plugins', async () => {
  const d = deps({
    ask: async () => ({ answers: [{ id: 'plugin-update', selected: ['opt-all'] }] }),
  })
  const result = await runPluginUpdate('', d)
  assert.equal(result.ok, true)
  assert.deepEqual(d.__runs[0], ['plugin', '--profile', 'p', 'update', '--latest', 'alpha', 'gamma'])
})

test('explicit all and aliases resolve to every updatable plugin', async () => {
  for (const token of ['all', 'ALL', '全部', '全部更新', '*']) {
    const d = deps()
    const result = await runPluginUpdate(token, d)
    assert.equal(result.ok, true, token)
    assert.deepEqual(d.__runs[0].slice(5), ['alpha', 'gamma'], token)
  }
  assert.equal(isAllToken('all'), true)
  assert.equal(isAllToken('alpha'), false)
})

test('bare submit (empty selection) never means update-all', async () => {
  const d = deps({ ask: async () => ({ answers: [{ id: 'plugin-update', selected: [] }] }) })
  const result = await runPluginUpdate('', d)
  assert.equal(result.ok, true)
  assert.deepEqual(result.lines, ['cancelled'])
  assert.equal(d.__runs.length, 0)
})

test('Esc/cancellation is a normal outcome', async () => {
  const d = deps({
    ask: async () => {
      const error = new Error('cancelled')
      error.name = 'UserQuestionError'
      throw error
    },
  })
  const result = await runPluginUpdate('', d)
  assert.equal(result.ok, true)
  assert.deepEqual(result.lines, ['cancelled'])
})

test('local link plugin reports why it cannot update', async () => {
  const d = deps()
  const result = await runPluginUpdate('beta', d)
  assert.equal(result.ok, false)
  assert.deepEqual(result.lines, ['local-only:{"name":"beta"}'])
  assert.equal(d.__runs.length, 0)
})

test('unknown plugin reports the installed names', async () => {
  const d = deps()
  const result = await runPluginUpdate('nope', d)
  assert.equal(result.ok, false)
  assert.ok(result.lines[0].startsWith('unknown-target'))
  assert.ok(result.lines[0].includes('alpha, beta, gamma'))
  assert.equal(d.__runs.length, 0)
})

test('all-local profile has nothing to update', async () => {
  const d = deps({
    listCandidates: async () => [candidates[1]],
    ask: async () => ({ answers: [{ id: 'plugin-update', selected: ['opt-all'] }] }),
  })
  const result = await runPluginUpdate('', d)
  assert.equal(result.ok, false)
  assert.deepEqual(result.lines, ['nothing-updatable'])
  assert.equal(d.__runs.length, 0)
})

test('a failed pnpm run surfaces the tail and the manual command', async () => {
  const d = deps({
    run: async (args) => ({
      code: 1,
      stdout: '',
      stderr: 'ERR_PNPM_FETCH_404\n  GET https://registry.example/alpha: Not Found',
      timedOut: false,
      command: `dsh ${args.join(' ')}`,
    }),
  })
  const result = await runPluginUpdate('alpha', d)
  assert.equal(result.ok, false)
  assert.ok(result.lines[0].startsWith('update-failed'))
  assert.ok(result.lines.some(line => line.includes('ERR_PNPM_FETCH_404')))
  assert.ok(result.lines.some(line => line.startsWith('manual-hint')))
})

test('no plugins installed', async () => {
  const d = deps({ listCandidates: async () => [] })
  const result = await runPluginUpdate('', d)
  assert.equal(result.ok, false)
  assert.deepEqual(result.lines, ['no-plugins'])
})

test('no profile launch', async () => {
  const d = deps({ profile: '' })
  const result = await runPluginUpdate('', d)
  assert.equal(result.ok, false)
  assert.deepEqual(result.lines, ['no-profile'])
})

test('patch subcommand reports applied/already', async () => {
  const d = deps()
  const applied = await runPluginUpdate('patch', d)
  assert.equal(applied.ok, true)
  assert.ok(applied.lines[0].startsWith('patch-ok'))

  const already = deps({
    patch: {
      status: () => ({ supported: true, patched: true, dshTuiVersion: '0.17.0' }),
      apply: () => { throw new Error('should not run') },
    },
  })
  const result = await runPluginUpdate('patch', already)
  assert.equal(result.ok, true)
  assert.ok(result.lines[0].startsWith('patch-already'))
})

test('status lists plugins and patch state', async () => {
  const d = deps()
  const result = await runPluginUpdate('status', d)
  assert.equal(result.ok, true)
  assert.ok(result.lines[0].startsWith('status-title'))
  assert.ok(result.lines.includes('status-patch-off'))
  assert.equal(result.lines.length, 2 + candidates.length)
})

test('picker lists every plugin then update-all', () => {
  const options = buildOptions(candidates, t)
  assert.deepEqual(options.map(option => option.label), ['alpha', 'beta', 'gamma', 'opt-all'])
  assert.ok(options[1].description.includes('local-skip'))
  assert.ok(options[3].description.includes('"count":2'))
})

test('findCandidate accepts exact, case-insensitive and title matches', () => {
  assert.equal(findCandidate(candidates, 'alpha')?.name, 'alpha')
  assert.equal(findCandidate(candidates, 'ALPHA')?.name, 'alpha')
  assert.equal(findCandidate(candidates, 'Beta')?.name, 'beta')
  assert.equal(findCandidate(candidates, 'nope'), undefined)
})
