import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { ROOT, BUNDLE_ID, DEVELOPER_TEAM } from '../release-common.mjs'
import {
  verifyMacZip, verifyMacDmg, checkMacArtifactNames, checkArchiveEntries, checkDeveloperDetails, checkEntitlements,
  compareSystemVersions, isMachO, LEGACY_REQUIREMENT, DEVELOPER_REQUIREMENT
} from '../release-mac-verify.mjs'

const details = `CodeDirectory v=20500 size=123 flags=0x10000(runtime) hashes=5\nAuthority=Developer ID Application: Aula (${DEVELOPER_TEAM})\nTimestamp=Nov 15, 2026 at 10:00:00 AM\nTeamIdentifier=${DEVELOPER_TEAM}`
const plist = (keys) => `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>${keys}</dict></plist>`
const entitlements = plist('<key>com.apple.security.cs.allow-jit</key><true/><key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>')
// cabeceras: Mach-O universal (2 arquitecturas), Mach-O fino de 64 bits y un .class de Java (CAFEBABE + su versión)
const FAT = Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 2, 0, 0, 0, 0])
const THIN = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 7, 0, 0, 1, 0, 0, 0, 0])
const JAVA = Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 0x34, 0, 0, 0, 0])
const FRAMEWORK = 'Contents/Frameworks/Electron Framework.framework/Versions/A'

/** La app que «extrae» ditto o «monta» hdiutil: dos .app, Mach-O sueltos, un enlace y archivos que no son código. */
function writeApp(root, changes) {
  const app = join(root, 'Aula.app')
  mkdirSync(join(app, 'Contents/Frameworks/Aula Helper.app/Contents/MacOS'), { recursive: true })
  mkdirSync(join(app, 'Contents/Resources/bin'), { recursive: true })
  mkdirSync(join(app, FRAMEWORK, 'Libraries'), { recursive: true })
  mkdirSync(join(app, FRAMEWORK, 'Helpers'), { recursive: true })
  writeFileSync(join(app, 'Contents/Frameworks/Aula Helper.app/Contents/MacOS/Aula Helper'), FAT)
  writeFileSync(join(app, FRAMEWORK, 'Libraries/libffmpeg.dylib'), FAT)
  writeFileSync(join(app, FRAMEWORK, 'Helpers/chrome_crashpad_handler'), THIN)
  writeFileSync(join(app, FRAMEWORK, 'Libraries/vk_swiftshader_icd.json'), '{}')
  writeFileSync(join(app, 'Contents/Resources/Example.class'), JAVA)
  symlinkSync(join(app, FRAMEWORK, 'Libraries/libffmpeg.dylib'), join(app, 'Contents/Frameworks/link.dylib'))
  if (!changes.noSidecar) writeFileSync(join(app, 'Contents/Resources/bin/aula-tsnet'), 'sidecar', { mode: 0o755 })
}

function fixture(t, version, changes = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aula-zip-test-')), zip = join(dir, 'final.zip'), dmg = join(dir, 'final.dmg'), calls = []
  writeFileSync(zip, 'synthetic zip: extraction is injected')
  writeFileSync(dmg, 'synthetic dmg: mounting is injected')
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const f = { dir, zip, dmg, calls, extracted: null, mount: null }
  f.execute = (cmd, args) => {
    calls.push([cmd, args])
    if (changes.fail?.(cmd, args)) throw new Error('native verification failed')
    if (cmd.endsWith('/unzip')) return changes.entries ?? 'Aula.app/\nAula.app/Contents/Info.plist'
    if (cmd.endsWith('/ditto')) {
      f.extracted = args.at(-1)
      writeApp(f.extracted, changes)
      return ''
    }
    if (cmd.endsWith('/hdiutil')) {
      if (args[0] === 'attach') {
        f.mount = args[args.indexOf('-mountpoint') + 1]
        if (!changes.emptyDmg) writeApp(f.mount, changes)
      } else rmSync(join(args.at(-1), 'Aula.app'), { recursive: true, force: true })
      return ''
    }
    if (cmd.endsWith('/PlistBuddy')) {
      const key = args[1].replace('Print :', '')
      const value = { CFBundleIdentifier: BUNDLE_ID, CFBundleShortVersionString: version, CFBundleExecutable: 'Aula', LSMinimumSystemVersion: '13.0', ...changes.plist }[key]
      if (value === undefined) throw new Error(`Print: Entry, ":${key}", Does Not Exist`)
      return value
    }
    if (cmd.endsWith('/lipo')) return changes.archs ?? 'x86_64 arm64'
    if (cmd.endsWith('/codesign')) {
      if (args.includes('--entitlements')) return changes.entitlements?.(args.at(-1)) ?? entitlements
      return args.includes('--display') ? (changes.details ?? details) : ''
    }
    if (cmd.endsWith('/spctl')) return changes.assessment ?? 'accepted\nsource=Notarized Developer ID'
    if (cmd.endsWith('/xcrun')) return 'The validate action worked!'
    throw new Error(`Unexpected command ${cmd}`)
  }
  return f
}
const codesign = (f, flag) => f.calls.filter(([cmd, args]) => cmd.endsWith('/codesign') && args.includes(flag))
const relative = (f, root) => (path) => path.slice(join(root, 'Aula.app').length + 1) || 'Aula.app'

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

test('Developer ID requires the pinned team, runtime/timestamp per architecture, staple and Gatekeeper on every Mach-O', async (t) => {
  const f = fixture(t, '0.2.6')
  await verifyMacZip(f.zip, '0.2.6', { ...f, platform: 'darwin' })
  const requirements = codesign(f, '-R')
  assert.equal(requirements[0][1][requirements[0][1].indexOf('-R') + 1], '=' + DEVELOPER_REQUIREMENT)
  for (const [, args] of requirements) assert.ok(args[args.indexOf('-R') + 1].startsWith('='))
  // la app y su helper, el ejecutable del helper, la biblioteca, el crashpad y el sidecar (que no hace falta que parezca Mach-O);
  // nunca el enlace, el JSON ni el .class de Java
  const checked = requirements.slice(1).map(([, args]) => args.at(-1)).map(relative(f, f.extracted)).sort()
  assert.deepEqual(checked, ['Aula.app', 'Contents/Frameworks/Aula Helper.app', 'Contents/Frameworks/Aula Helper.app/Contents/MacOS/Aula Helper',
    `${FRAMEWORK}/Helpers/chrome_crashpad_handler`, `${FRAMEWORK}/Libraries/libffmpeg.dylib`, 'Contents/Resources/bin/aula-tsnet'].sort())
  const displays = codesign(f, '--display').filter(([, args]) => !args.includes('--entitlements'))
  assert.equal(displays.length, checked.length * 2, 'cada código, en arm64 y en x86_64')
  assert.equal(codesign(f, '--entitlements').length, checked.length)
  assert.ok(f.calls.some(([cmd, args]) => cmd.endsWith('/xcrun') && args[0] === 'stapler'))
  assert.ok(f.calls.some(([cmd]) => cmd.endsWith('/spctl')))
  assert.equal(existsSync(f.extracted), false)
})

test('rejects missing or invalid final ZIP, wrong identity, version, executable, minimum macOS, architecture and unsigned code', async (t) => {
  for (const [changes, expected] of [
    [{ entries: '../outside\nAula.app/' }, /Ruta/],
    [{ plist: { CFBundleIdentifier: 'com.other.app' } }, /Bundle/],
    [{ plist: { CFBundleShortVersionString: '0.2.4' } }, /Versión/],
    [{ plist: { CFBundleExecutable: 'Electron' } }, /CFBundleExecutable/],
    [{ plist: { LSMinimumSystemVersion: '13.1' } }, /LSMinimumSystemVersion 13\.1/],
    [{ plist: { LSMinimumSystemVersion: '14' } }, /LSMinimumSystemVersion 14/],
    [{ plist: { LSMinimumSystemVersion: undefined } }, /Falta LSMinimumSystemVersion/],
    [{ archs: 'arm64' }, /universal/],
    [{ fail: (cmd) => cmd.endsWith('/codesign') }, /native verification/]
  ]) {
    const f = fixture(t, '0.2.5', changes)
    await assert.rejects(verifyMacZip(f.zip, '0.2.5', { ...f, platform: 'darwin' }), expected)
    if (f.extracted) assert.equal(existsSync(f.extracted), false)
  }
  for (const minimum of ['11.0', '12.6.1', '13', '13.0']) {
    const f = fixture(t, '0.2.5', { plist: { LSMinimumSystemVersion: minimum } })
    await verifyMacZip(f.zip, '0.2.5', { ...f, platform: 'darwin' })
  }
  await assert.rejects(verifyMacZip('/tmp/aula-no-such-zip', '0.2.5', { platform: 'darwin' }), /Falta/)
  await assert.rejects(verifyMacZip('/tmp/aula-no-such-zip', '0.2.5', { platform: 'linux' }), /requiere macOS/)
})

test('future verification fails for missing runtime, timestamp, team, entitlements, ticket, notarization or sidecar', async (t) => {
  const crashpad = `${FRAMEWORK}/Helpers/chrome_crashpad_handler`
  for (const [changes, expected] of [
    [{ details: details.replace('0x10000', '0x0') }, /runtime/],
    [{ details: details.replace(/^Timestamp=.*\n/m, '') }, /sello/],
    [{ details: details.replace('Timestamp=Nov 15, 2026 at 10:00:00 AM', 'Timestamp=none') }, /sello/],
    [{ details: details.replaceAll(DEVELOPER_TEAM, 'OTHERTEAM') }, /equipo/],
    [{ fail: (cmd, args) => cmd.endsWith('/codesign') && args.includes('-R') && args.at(-1).endsWith(crashpad) }, /chrome_crashpad_handler \(ZIP\): native verification/],
    [{ fail: (cmd, args) => cmd.endsWith('/codesign') && args.includes('x86_64') && args.at(-1).endsWith('libffmpeg.dylib') }, /libffmpeg\.dylib \(ZIP\): native verification/],
    [{ entitlements: (code) => code.endsWith('Aula Helper.app') ? plist('') : entitlements }, /Aula Helper\.app \(ZIP\): Falta com\.apple\.security\.cs\.allow-jit/],
    [{ entitlements: (code) => code.endsWith('Aula.app') ? plist('') : entitlements }, /: Aula\.app \(ZIP\): Falta .*allow-jit/],
    [{ entitlements: (code) => code.endsWith('libffmpeg.dylib') ? plist('<key>com.apple.security.get-task-allow</key><true/>') : entitlements }, /libffmpeg\.dylib \(ZIP\): Lleva com\.apple\.security\.get-task-allow/],
    [{ fail: cmd => cmd.endsWith('/xcrun') }, /native verification/],
    [{ assessment: 'source=Developer ID' }, /Notarized/],
    [{ noSidecar: true }, /Falta/]
  ]) {
    const f = fixture(t, '0.2.6', changes)
    await assert.rejects(verifyMacZip(f.zip, '0.2.6', { ...f, platform: 'darwin' }), expected)
    assert.equal(existsSync(f.extracted), false)
  }
  // código suelto sin allow-jit (el sidecar, las bibliotecas) es correcto: no son procesos de Electron
  const f = fixture(t, '0.2.6', { entitlements: (code) => code.endsWith('.app') ? entitlements : plist('') })
  await verifyMacZip(f.zip, '0.2.6', { ...f, platform: 'darwin' })
})

test('the final DMG is mounted read-only without Finder, verified like the ZIP and always detached', async (t) => {
  const f = fixture(t, '0.2.6')
  await verifyMacDmg(f.dmg, '0.2.6', { ...f, platform: 'darwin' })
  const attach = f.calls.find(([cmd, args]) => cmd.endsWith('/hdiutil') && args[0] === 'attach')[1]
  for (const flag of ['-readonly', '-nobrowse', '-noautoopen']) assert.ok(attach.includes(flag), flag)
  assert.equal(attach.at(-1), f.dmg)
  assert.deepEqual(f.calls.filter(([cmd]) => cmd.endsWith('/hdiutil')).map(([, args]) => args.slice(0, -1)).at(-1), ['detach'])
  const deep = codesign(f, '--deep')[0][1]
  assert.equal(deep[deep.indexOf('-R') + 1], '=' + DEVELOPER_REQUIREMENT)
  assert.equal(deep.at(-1), join(f.mount, 'Aula.app'))
  assert.ok(f.calls.some(([cmd, args]) => cmd.endsWith('/xcrun') && args.at(-1) === join(f.mount, 'Aula.app')))
  assert.ok(f.calls.some(([cmd, args]) => cmd.endsWith('/spctl') && args.at(-1) === join(f.mount, 'Aula.app')))
  assert.equal(existsSync(f.mount), false, 'the temporary mount point is removed after detaching')
})

test('a bad DMG is still detached; a stuck volume is forced and never deleted while mounted', async (t) => {
  for (const [changes, expected] of [
    [{ assessment: 'source=Developer ID' }, /Notarized Developer ID en el DMG/],
    [{ entitlements: () => plist('') }, /: Aula\.app \(DMG\): Falta .*allow-jit/],
    [{ emptyDmg: true }, /solo Aula\.app/],
    [{ plist: { LSMinimumSystemVersion: '15.0' } }, /LSMinimumSystemVersion 15\.0 del DMG/]
  ]) {
    const f = fixture(t, '0.2.6', changes)
    await assert.rejects(verifyMacDmg(f.dmg, '0.2.6', { ...f, platform: 'darwin' }), expected)
    assert.ok(f.calls.some(([cmd, args]) => cmd.endsWith('/hdiutil') && args[0] === 'detach'), 'detached after a failure')
    assert.equal(existsSync(f.mount), false)
  }
  // no se monta: nada que desmontar
  const unmountable = fixture(t, '0.2.6', { fail: (cmd, args) => cmd.endsWith('/hdiutil') && args[0] === 'attach' })
  await assert.rejects(verifyMacDmg(unmountable.dmg, '0.2.6', { ...unmountable, platform: 'darwin' }), /native verification/)
  assert.equal(unmountable.calls.some(([, args]) => args[0] === 'detach'), false)
  // el primer detach falla: se fuerza
  const busy = fixture(t, '0.2.6', { fail: (cmd, args) => cmd.endsWith('/hdiutil') && args[0] === 'detach' && args[1] !== '-force' })
  await verifyMacDmg(busy.dmg, '0.2.6', { ...busy, platform: 'darwin' })
  assert.ok(busy.calls.some(([, args]) => args[0] === 'detach' && args[1] === '-force'))
  // ni forzado: se dice, con el fallo anterior, y la carpeta montada no se toca
  const stuck = fixture(t, '0.2.6', { fail: (cmd, args) => (cmd.endsWith('/hdiutil') && args[0] === 'detach') || cmd.endsWith('/spctl') })
  await assert.rejects(verifyMacDmg(stuck.dmg, '0.2.6', { ...stuck, platform: 'darwin' }), /No se pudo desmontar[\s\S]*Antes: .*native verification/)
  assert.equal(existsSync(join(stuck.mount, 'Aula.app')), true)
  rmSync(join(stuck.mount, '..'), { recursive: true, force: true })
  await assert.rejects(verifyMacDmg('/tmp/aula-no-such-dmg', '0.2.6', { platform: 'darwin' }), /Falta/)
  await assert.rejects(verifyMacDmg('/tmp/aula-no-such-dmg', '0.2.6', { platform: 'linux' }), /requiere macOS/)
})

test('archive validation rejects paths escaping the extracted app', () => {
  for (const path of ['/Aula.app/a', 'Aula.app/../a', 'Aula.app/./a', 'Other.app/a', 'Aula.app/\\a']) assert.throws(() => checkArchiveEntries('Aula.app/\n' + path))
  assert.throws(() => checkDeveloperDetails(details.replace('Developer ID Application:', 'Developer ID Installer:')))
})

test('entitlements, macOS versions and Mach-O headers are parsed strictly', (t) => {
  assert.doesNotThrow(() => checkEntitlements(entitlements, { launches: true }))
  assert.throws(() => checkEntitlements(plist('<key>com.apple.security.cs.allow-jit</key><false/>'), { launches: true }), /allow-jit/)
  assert.throws(() => checkEntitlements(entitlements.replace('</dict>', '<key>com.apple.security.get-task-allow</key><false/></dict>'), { launches: false }), /get-task-allow/)
  assert.doesNotThrow(() => checkEntitlements('', { launches: false }))
  assert.equal(compareSystemVersions('13.0', '13'), 0)
  assert.equal(compareSystemVersions('12.7.6', '13.0'), -1)
  assert.equal(compareSystemVersions('13.0.1', '13.0'), 1)
  assert.throws(() => compareSystemVersions('13.0beta', '13.0'), /no válida/)
  const dir = mkdtempSync(join(tmpdir(), 'aula-macho-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const [name, bytes, expected] of [['fat', FAT, true], ['thin', THIN, true], ['java', JAVA, false], ['text', Buffer.from('#!/bin/sh\necho\n'), false], ['short', Buffer.from([0xcf, 0xfa]), false]]) {
    writeFileSync(join(dir, name), bytes)
    assert.equal(isMachO(join(dir, name)), expected, name)
  }
  assert.equal(isMachO(process.execPath), process.platform === 'darwin', 'the real node binary')
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
