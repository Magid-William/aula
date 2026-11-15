import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, existsSync, lstatSync, readlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { ROOT } from '../release-common.mjs'

const script = readFileSync(join(ROOT, 'scripts/release-local.sh'), 'utf8')

function fixture(t, linked = true) {
  const root = mkdtempSync(join(tmpdir(), 'aula-release-preflight-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'scripts'))
  mkdirSync(join(root, 'tools'))
  mkdirSync(join(root, 'other-worktree-node-modules'))
  writeFileSync(join(root, 'other-worktree-node-modules', 'keep'), 'untouched dependencies')
  if (linked) symlinkSync(join(root, 'other-worktree-node-modules'), join(root, 'node_modules'))
  else mkdirSync(join(root, 'node_modules'))
  mkdirSync(join(root, 'release/0.2.5'), { recursive: true })
  writeFileSync(join(root, 'release/0.2.5/keep'), 'verified artifacts')
  writeFileSync(join(root, 'scripts/release-local.sh'), script)
  // El primer Node es la lectura de versión: se detiene ahí si el guard permite continuar.
  // Nunca llega a scripts de firma, claves, compilación, borrado de salidas ni herramientas de red.
  const log = join(root, 'tool-called')
  writeFileSync(join(root, 'tools/node'), '#!/bin/sh\nprintf "node\\n" >> "$AULA_TEST_TOOL_LOG"\nexit 73\n', { mode: 0o755 })
  const run = (...args) => spawnSync('/bin/bash', [join(root, 'scripts/release-local.sh'), ...args], {
    env: { ...process.env, PATH: join(root, 'tools') + ':' + process.env.PATH, AULA_TEST_TOOL_LOG: log }, encoding: 'utf8'
  })
  return { root, log, run }
}

test('desktop builds reject linked node_modules before version tools, credentials or output cleanup', (t) => {
  for (const args of [[], ['--only', 'mac'], ['--only', 'win'], ['--only', 'linux'], ['--only', 'android', '--only', 'mac'], ['--only', 'mac', '--skip-checks']]) {
    const f = fixture(t), result = f.run(...args)
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /node_modules es un enlace simbólico/)
    assert.match(result.stderr, /unlink node_modules; después ejecuta npm ci en este worktree/)
    assert.equal(lstatSync(join(f.root, 'node_modules')).isSymbolicLink(), true)
    assert.equal(readlinkSync(join(f.root, 'node_modules')), join(f.root, 'other-worktree-node-modules'))
    assert.equal(existsSync(f.log), false, 'must reject before invoking Node or the signing preflight')
    assert.equal(readFileSync(join(f.root, 'release/0.2.5/keep'), 'utf8'), 'verified artifacts')
    assert.equal(readFileSync(join(f.root, 'other-worktree-node-modules/keep'), 'utf8'), 'untouched dependencies')
  }
})

test('the dependency guard permits upload, Android-only builds, and a real local node_modules directory', (t) => {
  for (const args of [['--upload'], ['--upload', '--only', 'mac'], ['--only', 'android']]) {
    const f = fixture(t), result = f.run(...args)
    assert.equal(result.status, 73, result.stderr)
    assert.equal(readFileSync(f.log, 'utf8'), 'node\n')
    assert.doesNotMatch(result.stderr, /enlace simbólico/)
  }
  const f = fixture(t, false), result = f.run('--only', 'mac')
  assert.equal(result.status, 73, result.stderr)
  assert.equal(readFileSync(f.log, 'utf8'), 'node\n')
})

test('the final release message expands safely under nounset in an available UTF-8 locale', () => {
  const locales = spawnSync('/usr/bin/locale', ['-a'], { encoding: 'utf8' })
  assert.equal(locales.status, 0, locales.stderr)
  const locale = locales.stdout.split('\n').find(name => /^(?:C|en_US)\.(?:utf-?8)$/i.test(name))
    ?? locales.stdout.split('\n').find(name => /utf-?8/i.test(name))
  assert.ok(locale, 'UTF-8 locale required to exercise the macOS Bash variable-name regression')
  const last = script.split('\n').find(line => line.startsWith('say "Siguiente paso:'))
  assert.ok(last)
  const result = spawnSync('/bin/bash', ['-c', 'set -euo pipefail\nOUT=release/0.2.5\nPUB_OWNER=luumlabs\nPUB_REPO=aula\nsay() { printf "%s\\n" "$*"; }\n' + last], {
    env: { ...process.env, LC_ALL: locale, LANG: locale }, encoding: 'utf8'
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /release\/0\.2\.5/)
  assert.match(result.stdout, /--upload --repo luumlabs\/aula»/)
  // Las otras dos rutas de diagnóstico tenían el mismo delimitador ambiguo junto a TITLE y TARGET.
  assert.doesNotMatch(script, /\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7f]/)
})
