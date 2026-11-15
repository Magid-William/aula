import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { ROOT, BUNDLE_ID, DEVELOPER_TEAM } from '../release-common.mjs'
import { verifyMacZip, checkMacArtifactNames, checkArchiveEntries, checkDeveloperDetails, LEGACY_REQUIREMENT, DEVELOPER_REQUIREMENT } from '../release-mac-verify.mjs'

const details = `CodeDirectory v=20500 size=123 flags=0x10000(runtime) hashes=5\nAuthority=Developer ID Application: Aula (${DEVELOPER_TEAM})\nTimestamp=Nov 15, 2026 at 10:00:00 AM\nTeamIdentifier=${DEVELOPER_TEAM}`
function fixture(t, version, changes = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aula-zip-test-')), zip = join(dir, 'final.zip'), calls = []
  writeFileSync(zip, 'synthetic zip: extraction is injected')
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const f = { dir, zip, calls, extracted: null }
  f.execute = (cmd, args) => {
    calls.push([cmd, args])
    if (changes.fail?.(cmd, args)) throw new Error('native verification failed')
    if (cmd.endsWith('/unzip')) return changes.entries ?? 'Aula.app/\nAula.app/Contents/Info.plist'
    if (cmd.endsWith('/ditto')) {
      f.extracted = args.at(-1)
      mkdirSync(join(f.extracted, 'Aula.app/Contents/Frameworks/Aula Helper.app/Contents'), { recursive: true })
      mkdirSync(join(f.extracted, 'Aula.app/Contents/Resources/bin'), { recursive: true })
      if (!changes.noSidecar) writeFileSync(join(f.extracted, 'Aula.app/Contents/Resources/bin/aula-tsnet'), 'sidecar', { mode: 0o755 })
      return ''
    }
    if (cmd.endsWith('/PlistBuddy')) {
      if (args[1].includes('Identifier')) return changes.bundle ?? BUNDLE_ID
      if (args[1].includes('ShortVersion')) return changes.version ?? version
      return 'Aula'
    }
    if (cmd.endsWith('/lipo')) return changes.archs ?? 'x86_64 arm64'
    if (cmd.endsWith('/codesign')) return args.includes('--display') ? (changes.details ?? details) : ''
    if (cmd.endsWith('/spctl')) return changes.assessment ?? 'accepted\nsource=Notarized Developer ID'
    if (cmd.endsWith('/xcrun')) return 'The validate action worked!'
    throw new Error(`Unexpected command ${cmd}`)
  }
  return f
}

test('bridge verification extracts the final ZIP and pins exact local certificate and bundle', async (t) => {
  const f = fixture(t, '0.2.5')
  await verifyMacZip(f.zip, '0.2.5', { ...f, platform: 'darwin' })
  const verify = f.calls.find(([cmd, args]) => cmd.endsWith('/codesign') && args.includes('--verify'))
  assert.equal(verify[1][verify[1].indexOf('-R') + 1], '=' + LEGACY_REQUIREMENT)
  assert.ok(verify[1].at(-1).startsWith(f.extracted))
  assert.ok(verify[1].includes('--all-architectures'))
  assert.equal(existsSync(f.extracted), false)
  assert.equal(f.calls.some(([cmd]) => cmd.endsWith('/spctl')), false)
})

test('Developer ID requires the pinned team, runtime/timestamp per architecture, staple and Gatekeeper', async (t) => {
  const f = fixture(t, '0.2.6')
  await verifyMacZip(f.zip, '0.2.6', { ...f, platform: 'darwin' })
  const requirements = f.calls.filter(([cmd, args]) => cmd.endsWith('/codesign') && args.includes('-R'))
  assert.equal(requirements[0][1][requirements[0][1].indexOf('-R') + 1], '=' + DEVELOPER_REQUIREMENT)
  assert.equal(requirements.length, 4, 'root deep verify, root, helper and sidecar')
  for (const [, args] of requirements) assert.ok(args[args.indexOf('-R') + 1].startsWith('='))
  assert.equal(f.calls.filter(([cmd, args]) => cmd.endsWith('/codesign') && args.includes('--display')).length, 6)
  assert.ok(f.calls.some(([cmd, args]) => cmd.endsWith('/xcrun') && args[0] === 'stapler'))
  assert.ok(f.calls.some(([cmd]) => cmd.endsWith('/spctl')))
  assert.equal(existsSync(f.extracted), false)
})

test('rejects missing or invalid final ZIP, wrong identity, version, architecture and unsigned code', async (t) => {
  for (const [changes, expected] of [
    [{ entries: '../outside\nAula.app/' }, /Ruta/],
    [{ bundle: 'com.other.app' }, /Bundle/],
    [{ version: '0.2.4' }, /Versión/],
    [{ archs: 'arm64' }, /universal/],
    [{ fail: (cmd) => cmd.endsWith('/codesign') }, /native verification/]
  ]) {
    const f = fixture(t, '0.2.5', changes)
    await assert.rejects(verifyMacZip(f.zip, '0.2.5', { ...f, platform: 'darwin' }), expected)
    if (f.extracted) assert.equal(existsSync(f.extracted), false)
  }
  await assert.rejects(verifyMacZip('/tmp/aula-no-such-zip', '0.2.5', { platform: 'darwin' }), /Falta/)
  await assert.rejects(verifyMacZip('/tmp/aula-no-such-zip', '0.2.5', { platform: 'linux' }), /requiere macOS/)
})

test('future verification fails for missing runtime, timestamp, team, ticket, notarization or sidecar', async (t) => {
  for (const [changes, expected] of [
    [{ details: details.replace('0x10000', '0x0') }, /runtime/],
    [{ details: details.replace(/^Timestamp=.*\n/m, '') }, /sello/],
    [{ details: details.replace('Timestamp=Nov 15, 2026 at 10:00:00 AM', 'Timestamp=none') }, /sello/],
    [{ details: details.replaceAll(DEVELOPER_TEAM, 'OTHERTEAM') }, /equipo/],
    [{ fail: cmd => cmd.endsWith('/xcrun') }, /native verification/],
    [{ assessment: 'source=Developer ID' }, /Notarized/],
    [{ noSidecar: true }, /Falta/]
  ]) {
    const f = fixture(t, '0.2.6', changes)
    await assert.rejects(verifyMacZip(f.zip, '0.2.6', { ...f, platform: 'darwin' }), expected)
    assert.equal(existsSync(f.extracted), false)
  }
})

test('archive validation rejects paths escaping the extracted app', () => {
  for (const path of ['/Aula.app/a', 'Aula.app/../a', 'Aula.app/./a', 'Other.app/a', 'Aula.app/\\a']) assert.throws(() => checkArchiveEntries('Aula.app/\n' + path))
  assert.throws(() => checkDeveloperDetails(details.replace('Developer ID Application:', 'Developer ID Installer:')))
})

test('real codesign parses each inline requirement instead of treating it as a path', { skip: process.platform !== 'darwin' }, () => {
  for (const requirement of [LEGACY_REQUIREMENT, DEVELOPER_REQUIREMENT]) {
    const r = spawnSync('/usr/bin/codesign', ['--verify', '--strict', '--all-architectures', '-R', '=' + requirement, '/usr/bin/true'], { encoding: 'utf8' })
    assert.notEqual(r.status, 0, 'system true must never pass an Aula pin')
    assert.doesNotMatch(r.stderr, /invalid requirement|No such file|syntax error/i)
    assert.match(r.stderr, /requirement/i)
  }
})

test('upload rejects AULA_MAC_ADHOC before opening credentials or contacting GitHub', () => {
  const result = spawnSync('/bin/bash', [join(ROOT, 'scripts/release-local.sh'), '--upload'], { env: { ...process.env, AULA_MAC_ADHOC: '1' }, encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /nunca permite --upload/)
  const verifier = spawnSync(process.execPath, [join(ROOT, 'scripts/release-mac-verify.mjs'), '/tmp/unused', '0.2.5'], { env: { ...process.env, AULA_MAC_ADHOC: '1' }, encoding: 'utf8' })
  assert.equal(verifier.status, 1)
  assert.match(verifier.stderr, /no permite publicar/)
})

test('partial uploads do not collect an absent developer feed', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'aula-upload-files-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const script = readFileSync(join(ROOT, 'scripts/release-local.sh'), 'utf8')
  const collection = script.slice(script.indexOf('  shopt -s nullglob'), script.indexOf('  shopt -u nullglob') + '  shopt -u nullglob'.length)
  const run = () => spawnSync('/bin/bash', ['-c', 'set -euo pipefail\nOUT="$1"\n' + collection + '\nprintf "%s %s %s" "${#YMLS[@]}" "${#FILES[@]}" "${#MAC_FILES[@]}"', 'test', dir], { encoding: 'utf8' })
  assert.equal(run().stdout, '0 0 0')
  writeFileSync(join(dir, 'Aula-0.2.5-android.apk'), 'apk')
  assert.equal(run().stdout, '0 1 0')
  writeFileSync(join(dir, 'latest.yml'), 'windows metadata')
  assert.equal(run().stdout, '1 2 0')
  writeFileSync(join(dir, 'developer-id-mac.yml'), 'mac metadata')
  assert.equal(run().stdout, '2 3 0')
})

test('an orphan Mac ZIP triggers final verification even with no Mac feeds or unpacked app', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'aula-upload-orphan-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const zip = join(dir, 'Aula-0.2.5-mac.zip')
  writeFileSync(zip, 'unsigned package')
  const script = readFileSync(join(ROOT, 'scripts/release-local.sh'), 'utf8')
  const start = script.indexOf('  # Comprueba exactamente el ZIP')
  const guard = script.slice(start, script.indexOf('  HEAD_SHA=', start))
  const result = spawnSync('/bin/bash', ['-c', 'set -euo pipefail\nOUT="$1"\nVERSION=0.2.5\nMAC_FILES=("$OUT"/*.zip "$OUT"/*.dmg)\ndie() { echo "$*" >&2; exit 1; }\n' + guard, 'test', dir], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Falta.*developer-id-mac.yml/)
  assert.match(result.stderr, /ZIP final/)
})


test('extra ZIP or DMG files cannot ride along with an otherwise verified release', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'aula-extra-mac-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(join(dir, 'Aula-0.2.5-mac.zip'), 'bridge')
  assert.doesNotThrow(() => checkMacArtifactNames(dir, '0.2.5'))
  writeFileSync(join(dir, 'Aula-0.2.6-mac.zip'), 'current')
  assert.doesNotThrow(() => checkMacArtifactNames(dir, '0.2.6'))
  assert.throws(() => checkMacArtifactNames(dir, '0.2.5'), /fuera de los canales/)
  writeFileSync(join(dir, 'unsigned.zip'), 'other')
  assert.throws(() => checkMacArtifactNames(dir, '0.2.6'), /unsigned.zip/)
})
