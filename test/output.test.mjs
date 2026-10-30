import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { cleanOutput, isUpToDate, tailLines } from '../lib/output.js'
import { displayCommand, resolveDshInvocation, runDsh, shellQuote, updateArgs } from '../lib/update.js'

test('cleanOutput strips ANSI, OSC and control characters', () => {
  const text = '\u001b[31mred\u001b[0m \u001b]8;;https://x\u0007link\u001b]8;;\u0007\u0007\u0000ok'
  assert.equal(cleanOutput(text), 'red linkok')
})

test('tailLines drops progress noise, dedupes and caps', () => {
  const text = [
    'Progress: resolved 1, reused 0, downloaded 0, added 0',
    'a',
    'a',
    'b',
    '',
    'c',
  ].join('\n')
  assert.deepEqual(tailLines(text, { maxLines: 2 }), ['b', 'c'])
  assert.deepEqual(tailLines('x'.repeat(10), { maxCells: 4 }), ['xxxx…'])
})

test('isUpToDate recognizes pnpm wording', () => {
  assert.equal(isUpToDate('Already up to date'), true)
  assert.equal(isUpToDate('Already up-to-date'), true)
  assert.equal(isUpToDate('+ alpha 1.1.0'), false)
})

test('updateArgs pins the official CLI shape', () => {
  assert.deepEqual(updateArgs('p', ['a', 'b']), [
    'plugin', '--profile', 'p', 'update', '--latest', 'a', 'b',
  ])
  assert.deepEqual(updateArgs('p', ['a'], { latest: false }), [
    'plugin', '--profile', 'p', 'update', 'a',
  ])
})

test('shellQuote quotes only when needed', () => {
  assert.deepEqual(shellQuote(['plain', 'with space', 'a"b']), ['plain', '"with space"', '"a""b"'])
})

test('resolveDshInvocation reuses the running dsh bin through node', () => {
  const invocation = resolveDshInvocation({
    argv: ['node', 'C:\\x\\@deepseek-ai\\dsh\\lib\\bin.js', '--profile', 'p'],
    execPath: 'C:\\node\\node.exe',
  })
  assert.equal(invocation.file, 'C:\\node\\node.exe')
  assert.deepEqual(invocation.prefix, ['C:\\x\\@deepseek-ai\\dsh\\lib\\bin.js'])
})

test('resolveDshInvocation falls back to the platform shim', () => {
  const win = resolveDshInvocation({ argv: ['node', 'script.mjs'], platform: 'win32' })
  assert.equal(win.file, 'cmd.exe')
  assert.deepEqual(win.prefix, ['/d', '/s', '/c'])
  const posix = resolveDshInvocation({ argv: ['node', 'script.mjs'], platform: 'linux' })
  assert.equal(posix.file, 'dsh')
})

test('displayCommand is a readable retry hint', () => {
  assert.equal(displayCommand(updateArgs('p', ['a'])), 'dsh plugin --profile p update --latest a')
})

test('runDsh captures stdout/stderr and the exit code', async () => {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = () => true
  const result = await runDsh(['plugin', 'update'], {
    spawnImpl: () => {
      process.nextTick(() => {
        child.stdout.write('hello\n')
        child.stderr.write('oops\n')
        child.stdout.end()
        child.stderr.end()
        child.emit('close', 0)
      })
      return child
    },
    platform: 'linux',
    timeoutMs: 0,
  })
  assert.equal(result.code, 0)
  assert.equal(result.stdout, 'hello\n')
  assert.equal(result.stderr, 'oops\n')
  assert.equal(result.timedOut, false)
})

test('runDsh keeps the tail when output exceeds the cap', async () => {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = () => true
  const result = await runDsh(['plugin', 'update'], {
    spawnImpl: () => {
      process.nextTick(() => {
        for (let i = 0; i < 200; i++) child.stdout.write(`${'x'.repeat(1000)}\n`)
        child.stdout.write('THE-END\n')
        child.stdout.end()
        child.stderr.end()
        child.emit('close', 0)
      })
      return child
    },
    platform: 'linux',
    timeoutMs: 0,
  })
  assert.equal(result.code, 0)
  assert.ok(result.stdout.length <= 128 * 1024)
  assert.ok(result.stdout.trimEnd().endsWith('THE-END'))
})

test('runDsh settles a spawn failure instead of throwing', async () => {
  const result = await runDsh(['plugin', 'update'], {
    spawnImpl: () => { throw new Error('no dsh') },
    platform: 'linux',
    timeoutMs: 0,
  })
  assert.equal(result.code, 1)
  assert.equal(result.timedOut, false)
})
