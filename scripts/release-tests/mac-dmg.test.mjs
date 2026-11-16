import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { DEVELOPER_TEAM, ROOT, compareVersions, hashFile, macMode, signedDmg, yaml } from '../release-common.mjs'
import { buildBlockMap, finishMacDmg, updateFeedEntry } from '../release-mac-dmg.mjs'
import { DEVELOPER_CODE_REQUIREMENT } from '../release-mac-verify.mjs'

const IDENTITY = '67FA7ED9C0FFEE00112233445566778899AABBCC'
const SUBMISSION = '2f1c8e8a-1111-4222-8333-944455556666'
const PROFILE = 'aula-notary'
const DETAILS = `Executable=/x/Aula.dmg\nFormat=disk image\nCodeDirectory v=20100 size=319 flags=0x0(none) hashes=1+6 location=embedded\nAuthority=Developer ID Application: Aula (${DEVELOPER_TEAM})\nAuthority=Developer ID Certification Authority\nAuthority=Apple Root CA\nTimestamp=Nov 16, 2026 at 10:00:00 AM\nTeamIdentifier=${DEVELOPER_TEAM}`
const notary = (status) => JSON.stringify({ id: SUBMISSION, status, message: 'Processing complete' })

/**
 * Una carpeta release/<v>/ como la deja electron-builder (ZIP, DMG, sus .blockmap reales y latest-mac.yml sin firmar) y
 * las herramientas de Apple de mentira: codesign y stapler añaden bytes al DMG, como los de verdad.
 */
async function fixture(t, { version = '0.2.7', info: change, ...changes } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aula-dmg-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const zip = `Aula-${version}-mac.zip`, dmg = `Aula-${version}-mac.dmg`
  writeFileSync(join(dir, zip), `zip ${version} `.repeat(20_000))
  writeFileSync(join(dir, dmg), `dmg ${version} `.repeat(30_000))
  const zipInfo = await buildBlockMap(join(dir, zip), join(dir, `${zip}.blockmap`))
  const dmgInfo = await buildBlockMap(join(dir, dmg), join(dir, `${dmg}.blockmap`))
  const info = {
    version,
    // en el orden de updateInfoBuilder de electron-builder
    files: [{ url: zip, sha512: zipInfo.sha512, size: zipInfo.size }, { url: dmg, sha512: dmgInfo.sha512, size: dmgInfo.size }],
    path: zip,
    sha512: zipInfo.sha512,
    releaseDate: '2026-11-16T10:00:00.000Z',
    releaseName: `Aula ${version}`,
    releaseNotes: '<!-- lang:en -->\n# Aula\n\n- **New:** something.\n<!-- lang:es -->\n# Aula\n'
  }
  change?.(info)
  // como serializeToYaml de electron-builder
  writeFileSync(join(dir, 'latest-mac.yml'), yaml.dump(info, { lineWidth: 8000 }))
  const calls = []
  const execute = (cmd, args) => {
    calls.push([cmd, args])
    const target = args.at(-1)
    if (changes.fail?.(cmd, args)) throw Object.assign(new Error(`${basename(cmd)} ${args[0]} failed`), { output: changes.output ?? '' })
    if (cmd === '/usr/bin/codesign' && args[0] === '--sign') return appendFileSync(target, 'SIGNATURE') ?? ''
    if (cmd === '/usr/bin/codesign' && args[0] === '--verify') return `${target}: valid on disk`
    if (cmd === '/usr/bin/codesign' && args[0] === '--display') return changes.details ?? DETAILS
    if (cmd === '/usr/bin/xcrun' && args[1] === 'submit') return changes.notary ?? notary('Accepted')
    if (cmd === '/usr/bin/xcrun' && args[1] === 'log') return '{"status": "Invalid", "issues": [{"message": "The signature of the binary is invalid."}]}'
    if (cmd === '/usr/bin/xcrun' && args[1] === 'staple') return appendFileSync(args[2], 'TICKET') ?? 'The staple and validate action worked!'
    if (cmd === '/usr/bin/xcrun' && args[1] === 'validate') return 'The validate action worked!'
    if (cmd === '/usr/sbin/spctl') return changes.assessment ?? `${target}: accepted\nsource=Notarized Developer ID\norigin=Developer ID Application: Aula (${DEVELOPER_TEAM})`
    throw new Error(`Unexpected ${cmd} ${args.join(' ')}`)
  }
  const snapshot = () => Object.fromEntries(readdirSync(dir).sort().map((name) => [name, readFileSync(join(dir, name))]))
  const finish = (options = {}) => finishMacDmg(dir, version, { identity: IDENTITY, profile: PROFILE, execute, sleep: () => {}, ...options })
  return { dir, zip, dmg, calls, execute, snapshot, finish }
}
const commands = (f) => f.calls.map(([cmd, args]) => `${basename(cmd)} ${args.join(' ')}`)

test('finish signs, notarizes and staples a copy of the DMG, then swaps in it, its blockmap and its feed entry', async (t) => {
  const f = await fixture(t)
  const before = f.snapshot()
  const yml = readFileSync(join(f.dir, 'latest-mac.yml'), 'utf8')
  t.mock.method(console, 'log', () => {})
  const fields = await f.finish({ sleep: () => assert.fail('nothing to retry') })
  // todo sobre una copia en release/<v>/mac-dmg-*, que se borra
  const copy = f.calls[0][1].at(-1)
  assert.equal(basename(copy), f.dmg)
  assert.match(copy, new RegExp(`^${f.dir}/mac-dmg-[^/]+/${f.dmg}$`))
  assert.deepEqual(commands(f).map((line) => line.replaceAll(copy, '<dmg>')), [
    `codesign --sign ${IDENTITY} --timestamp <dmg>`,
    `xcrun notarytool submit <dmg> --keychain-profile ${PROFILE} --wait --timeout 2h --output-format json`,
    'xcrun stapler staple <dmg>',
    `codesign --verify --strict --verbose=2 -R =${DEVELOPER_CODE_REQUIREMENT} <dmg>`,
    'codesign --display --verbose=4 <dmg>',
    'xcrun stapler validate <dmg>',
    'spctl --assess --type open --context context:primary-signature --verbose=4 <dmg>'
  ])
  const after = f.snapshot()
  assert.deepEqual(Object.keys(after), Object.keys(before), 'no work folder or extra file is left behind')
  assert.deepEqual(after[f.dmg], Buffer.concat([before[f.dmg], Buffer.from('SIGNATURETICKET')]))
  // el ZIP (lo que descargan las actualizaciones) y su .blockmap no se tocan
  assert.deepEqual(after[f.zip], before[f.zip])
  assert.deepEqual(after[`${f.zip}.blockmap`], before[`${f.zip}.blockmap`])
  // el .blockmap del DMG es el del DMG firmado
  assert.notDeepEqual(after[`${f.dmg}.blockmap`], before[`${f.dmg}.blockmap`])
  const map = JSON.parse(gunzipSync(after[`${f.dmg}.blockmap`]).toString('utf8'))
  assert.equal(map.files.flatMap((file) => file.sizes).reduce((a, b) => a + b, 0), after[f.dmg].length)
  // latest-mac.yml: solo cambian el sha512 y el size del DMG
  assert.deepEqual(fields, { sha512: await hashFile(join(f.dir, f.dmg)), size: after[f.dmg].length })
  const oldLines = yml.split('\n'), newLines = after['latest-mac.yml'].toString('utf8').split('\n')
  assert.equal(newLines.length, oldLines.length)
  const changed = newLines.flatMap((line, i) => (line === oldLines[i] ? [] : [line]))
  assert.deepEqual(changed, [`    sha512: ${fields.sha512}`, `    size: ${fields.size}`])
  const old = yaml.load(yml), feed = yaml.load(newLines.join('\n'))
  assert.deepEqual(feed, { ...old, files: [old.files[0], { url: f.dmg, ...fields }] })
  assert.equal(feed.sha512, old.files[0].sha512, 'path is still the ZIP')
})

test('a notarization Apple does not accept stops before anything changes, and shows Apple’s log', async (t) => {
  for (const [changes, expected, logged] of [
    [{ notary: notary('Invalid') }, /Apple no notarizó el DMG \(notarytool: Invalid, envío 2f1c8e8a/, true],
    [{ notary: notary('In Progress') }, /notarytool: In Progress/, true],
    // notarytool sale con error y su JSON en la salida
    [{ fail: (cmd, args) => args[1] === 'submit', output: `Conducting pre-submission checks...\n${notary('Rejected')}` }, /notarytool: Rejected/, true],
    // sin respuesta de Apple (credenciales, red): nada que consultar
    [{ fail: (cmd, args) => args[1] === 'submit', output: 'Error: HTTP status code: 401. Unable to authenticate.' }, /notarytool: sin respuesta\)\nxcrun notarytool failed/, false]
  ]) {
    const errors = t.mock.method(console, 'error', () => {})
    t.mock.method(console, 'log', () => {})
    const f = await fixture(t, changes)
    const before = f.snapshot()
    await assert.rejects(f.finish(), expected)
    assert.equal(commands(f).includes(`xcrun notarytool log ${SUBMISSION} --keychain-profile ${PROFILE}`), logged)
    assert.equal(errors.mock.calls.some((call) => /signature of the binary is invalid/.test(call.arguments[0])), logged, 'Apple’s log is printed')
    assert.equal(commands(f).some((line) => /stapler|spctl/.test(line)), false)
    assert.deepEqual(f.snapshot(), before, 'DMG, blockmaps and feed stay exactly as electron-builder made them')
    errors.mock.restore()
  }
})

test('stapling is retried while the ticket propagates; a failed staple or check changes nothing', async (t) => {
  t.mock.method(console, 'warn', () => {})
  t.mock.method(console, 'log', () => {})
  let failures = 0
  const slept = []
  const flaky = await fixture(t, { fail: (cmd, args) => args[1] === 'staple' && ++failures <= 2 })
  await flaky.finish({ sleep: (ms) => slept.push(ms) })
  assert.deepEqual(slept, [30_000, 30_000])
  assert.equal(commands(flaky).filter((line) => line.startsWith('xcrun stapler staple')).length, 3)
  for (const [changes, expected] of [
    [{ fail: (cmd, args) => args[1] === 'staple' }, /stapler failed/],
    [{ assessment: 'rejected\nsource=Unnotarized Developer ID' }, /el contenedor\): Gatekeeper no lo acepta como Notarized Developer ID/],
    [{ details: DETAILS.replaceAll(DEVELOPER_TEAM, 'OTHERTEAM1') }, /el contenedor\): No es Developer ID Application del equipo/],
    [{ details: DETAILS.replace(/^Timestamp=.*$/m, 'Signed Time=Nov 16, 2026') }, /sello de tiempo/],
    [{ fail: (cmd, args) => cmd.endsWith('/codesign') && args[0] === '--verify' }, /el contenedor\): codesign --verify failed/],
    [{ fail: (cmd, args) => cmd.endsWith('/codesign') && args[0] === '--sign' }, /codesign --sign failed/]
  ]) {
    const f = await fixture(t, changes)
    const before = f.snapshot()
    await assert.rejects(f.finish(), expected)
    assert.deepEqual(f.snapshot(), before)
  }
})

test('finish refuses the bridge, a signed or foreign feed and a DMG the feed does not describe, before running anything', async (t) => {
  for (const [options, expected] of [
    [{ version: '0.2.5' }, /el puente 0\.2\.5 y los anteriores no se tocan/],
    [{ version: '0.2.4' }, /el puente 0\.2\.5 y los anteriores no se tocan/],
    [{ info: (info) => { info.files[0].aulaSignature = 'c2lnbmVk' } }, /ya está firmado/],
    [{ info: (info) => { info.aulaNotesSignature = 'c2lnbmVk' } }, /ya está firmado/],
    [{ info: (info) => { info.version = '0.2.5' } }, /latest-mac\.yml es de la 0\.2\.5, no de la 0\.2\.7/],
    [{ info: (info) => { info.files.pop() } }, /anunciar Aula-0\.2\.7-mac\.dmg una vez/],
    [{ info: (info) => { info.files[1].size += 1 } }, /no es el que anuncia latest-mac\.yml/]
  ]) {
    const f = await fixture(t, options)
    const before = f.snapshot()
    await assert.rejects(f.finish(), expected)
    assert.deepEqual(f.calls, [])
    assert.deepEqual(f.snapshot(), before)
  }
  const f = await fixture(t)
  appendFileSync(join(f.dir, f.dmg), 'already signed')
  await assert.rejects(f.finish(), /no es el que anuncia latest-mac\.yml \(¿ya se firmó\?\)/)
  for (const [options, expected] of [
    [{ identity: 'Developer ID Application: Aula (87BM9KFJZW)' }, /SHA-1/],
    [{ identity: IDENTITY.toLowerCase() }, /SHA-1/],
    [{ profile: ' ' }, /keychain-profile/]
  ]) await assert.rejects(f.finish(options), expected)
  assert.deepEqual(f.calls, [])
})

test('the feed edit keeps every other byte, follows path, and falls back to a full rewrite only when it must', () => {
  const text = 'version: 0.2.7\nfiles:\n  - url: a.zip\n    sha512: zip==\n    size: 1\n  - url: a.dmg\n    sha512: old==\n    size: 2\npath: a.dmg\nsha512: old==\nreleaseNotes: |\n  - url: a.dmg\n    sha512: notes\n'
  const edited = updateFeedEntry(text, 'a.dmg', { sha512: '+new/==', size: 3 })
  assert.equal(edited, text.replace('    sha512: old==\n    size: 2', '    sha512: +new/==\n    size: 3').replace('\nsha512: old==', '\nsha512: +new/=='))
  // en flujo no hay líneas que cambiar: se reescribe entero, con lo mismo
  const flow = 'version: 0.2.7\nfiles: [{url: a.dmg, sha512: old==, size: 2}]\npath: a.zip\n'
  assert.deepEqual(yaml.load(updateFeedEntry(flow, 'a.dmg', { sha512: 'new==', size: 3 })), { version: '0.2.7', files: [{ url: 'a.dmg', sha512: 'new==', size: 3 }], path: 'a.zip' })
  assert.throws(() => updateFeedEntry(text.replace('    size: 2', '    size: 2\n    blockMapSize: 9'), 'a.dmg', { sha512: 'new==', size: 3 }), /blockMapSize/)
  assert.throws(() => updateFeedEntry(text, 'b.dmg', { sha512: 'new==', size: 3 }), /no anuncia b\.dmg/)
})

test('the signed DMG is required from 0.2.7 on; versions compare numerically', () => {
  for (const [version, signed] of [['0.2.4', false], ['0.2.5', false], ['0.2.6', false], ['0.2.7', true], ['0.2.10', true], ['0.3.0', true], ['1.0.0', true]]) {
    assert.equal(signedDmg(version), signed, version)
  }
  assert.equal(macMode('0.2.10'), 'developer-id')
  assert.equal(macMode('0.2.5'), 'bridge')
  assert.equal(macMode('0.1.9'), 'legacy')
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1)
  assert.throws(() => compareVersions('0.2.7-beta', '0.2.7'), /no válida/)
})

test('the command line refuses wrong arguments and test builds before touching anything', () => {
  const script = join(ROOT, 'scripts/release-mac-dmg.mjs')
  const run = (env, ...args) => spawnSync(process.execPath, [script, ...args], { env: { ...process.env, ...env }, encoding: 'utf8' })
  for (const args of [[], ['finish', '/tmp/unused', '0.2.7'], ['finish', '/tmp/unused', '0.2.7', '--identity', IDENTITY], ['sign', '/tmp/unused', '0.2.7', '--identity', IDENTITY, '--keychain-profile', PROFILE], ['finish', '/tmp/unused', '0.2.7', IDENTITY, '--identity', PROFILE, '--keychain-profile']]) {
    const result = run({}, ...args)
    assert.equal(result.status, 1, args.join(' '))
    assert.match(result.stderr, /Uso: release-mac-dmg\.mjs finish/)
  }
  const adhoc = run({ AULA_MAC_ADHOC: '1' }, 'finish', '/tmp/unused', '0.2.7', '--identity', IDENTITY, '--keychain-profile', PROFILE)
  assert.equal(adhoc.status, 1)
  assert.match(adhoc.stderr, /AULA_MAC_ADHOC=1 es una compilación de prueba/)
})
