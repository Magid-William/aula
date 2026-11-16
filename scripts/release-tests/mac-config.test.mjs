import test from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { DEVELOPER_TEAM, ROOT, yaml } from '../release-common.mjs'
import { developerIdConfigProblems, developerIdentity } from '../release-mac-config.mjs'

const committed = () => yaml.load(readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8'))
const ENTITLEMENTS = readFileSync(join(ROOT, 'build/entitlements.mac.plist'), 'utf8')
const NO_JIT = ENTITLEMENTS.replace(/\s*<key>com\.apple\.security\.cs\.allow-jit<\/key>\s*<true\/>/, '')
const DEBUGGABLE = ENTITLEMENTS.replace('</dict>', '  <key>com.apple.security.get-task-allow</key>\n    <true/>\n  </dict>')
const DEV_ID = '67FA7ED9C0FFEE00112233445566778899AABBCC'
const listing = (...lines) => [...lines.map((line, i) => `  ${i + 1}) ${line}`), `     ${lines.length} valid identities found`].join('\n')
const IDENTITIES = listing(
  `1111111111111111111111111111111111111111 "Apple Development: Someone (ABCDE12345)"`,
  `2222222222222222222222222222222222222222 "Apple Distribution: Luum Labs (${DEVELOPER_TEAM})"`,
  `${DEV_ID} "Developer ID Application: Luum Labs (${DEVELOPER_TEAM})"`
)

// Cambios de electron-builder.yml que nunca pueden llegar a compilarse como Developer ID
const BROKEN = {
  'the frozen 0.2.5 local signer': (c) => { c.mac.identity = '-'; c.mac.sign = 'scripts/build/mac-sign.cjs'; c.mac.hardenedRuntime = false; delete c.mac.forceCodeSigning },
  'identity null (skips signing)': (c) => { c.mac.identity = null },
  'an identity by name': (c) => { c.mac.identity = `Luum Labs (${DEVELOPER_TEAM})` },
  'a custom sign hook': (c) => { c.mac.sign = 'scripts/build/other-sign.cjs' },
  'hardened runtime off': (c) => { c.mac.hardenedRuntime = false },
  'forceCodeSigning missing': (c) => { delete c.mac.forceCodeSigning },
  'timestamp none': (c) => { c.mac.timestamp = 'none' },
  'notarize false': (c) => { c.mac.notarize = false },
  'development type': (c) => { c.mac.type = 'development' },
  'a signed DMG': (c) => { c.dmg.sign = true },
  'no inherited entitlements': (c) => { delete c.mac.entitlementsInherit }
}

test('the committed builder config signs the Mac app with Developer ID only', () => {
  const config = committed()
  assert.deepEqual(developerIdConfigProblems(config), [])
  assert.equal(Object.hasOwn(config.mac, 'identity'), false, 'release-local.sh pins the identity by SHA-1')
  assert.equal(config.mac.sign, undefined)
  assert.equal(config.mac.hardenedRuntime, true)
  assert.equal(config.mac.forceCodeSigning, true)
  assert.equal(config.mac.timestamp, undefined, 'unset is Apple’s secure timestamp')
  assert.notEqual(config.mac.notarize, false)
  assert.equal(config.mac.entitlements, 'build/entitlements.mac.plist')
  assert.equal(config.mac.entitlementsInherit, 'build/entitlements.mac.plist')
  assert.equal(config.dmg.sign, false, 'electron-builder would sign the DMG without notarizing it; release-mac-dmg.mjs signs, notarizes and staples it')
  // Windows sigue sin firmar: forceCodeSigning global rompería su instalador
  assert.equal(config.forceCodeSigning, undefined)
  assert.equal(config.win.forceCodeSigning, undefined)
  // nada que dependa de 0.2.5 cambia: el bundle id, el nombre del ejecutable y los dos instaladores universales
  assert.equal(config.appId, 'com.luumlabs.aula')
  assert.equal(config.productName, 'Aula')
  assert.equal(config.mac.artifactName, 'Aula-${version}-mac.${ext}')
  assert.equal(existsSync(join(ROOT, 'scripts/build/mac-sign.cjs')), false, 'the 0.2.5 local signer is retired')
  for (const file of ['electron-builder.yml', 'scripts/release-local.sh']) assert.doesNotMatch(readFileSync(join(ROOT, file), 'utf8'), /mac-sign\.cjs/, file)
})

test('the guard rejects every config that would not be a hardened, timestamped, notarizable Developer ID build', () => {
  for (const [name, change] of Object.entries(BROKEN)) {
    const config = committed()
    change(config)
    assert.notDeepEqual(developerIdConfigProblems(config), [], name)
  }
  const read = (text) => () => text
  assert.match(developerIdConfigProblems(committed(), read(NO_JIT)).join('\n'), /mac\.entitlements\) no concede com\.apple\.security\.cs\.allow-jit[\s\S]*mac\.entitlementsInherit\) no concede/)
  assert.match(developerIdConfigProblems(committed(), read(DEBUGGABLE)).join('\n'), /get-task-allow/)
  assert.match(developerIdConfigProblems(committed(), () => { throw new Error('ENOENT') }).join('\n'), /no se puede leer/)
  assert.deepEqual(developerIdConfigProblems({}), ['falta el bloque mac'])
})

test('the identity is the SHA-1 of the only valid Developer ID Application of Aula’s team', () => {
  assert.equal(developerIdentity(IDENTITIES), DEV_ID)
  // la misma identidad en dos llaveros cuenta una vez
  assert.equal(developerIdentity(`${IDENTITIES}\n  4) ${DEV_ID} "Developer ID Application: Luum Labs (${DEVELOPER_TEAM})"`), DEV_ID)
  for (const [text, expected] of [
    [listing(`2222222222222222222222222222222222222222 "Apple Distribution: Luum Labs (${DEVELOPER_TEAM})"`), /ninguna/],
    [listing(`${DEV_ID} "Developer ID Application: Someone Else (ZZZZZ99999)"`), /ninguna/],
    [listing(`${DEV_ID} "Developer ID Installer: Luum Labs (${DEVELOPER_TEAM})"`), /ninguna/],
    [listing(`${DEV_ID} "Developer ID Application: Fake (${DEVELOPER_TEAM}) (ZZZZZ99999)"`), /ninguna/],
    [listing(`${DEV_ID.toLowerCase()} "Developer ID Application: Luum Labs (${DEVELOPER_TEAM})"`), /ninguna/],
    [`  1) ${DEV_ID} "Developer ID Application: Luum Labs (${DEVELOPER_TEAM})" (CSSMERR_TP_CERT_EXPIRED)`, /ninguna/],
    [`${IDENTITIES}\n  4) 3333333333333333333333333333333333333333 "Developer ID Application: Luum Labs (${DEVELOPER_TEAM})"`, /2 identidades/],
    ['', /ninguna/]
  ]) assert.throws(() => developerIdentity(text), expected)
})

/**
 * El guion real en una copia aislada. Todo lo que firmaría, notarizaría, compilaría o leería claves es de mentira y lo
 * apunta en un registro: `npx` (electron-builder) sale con 97 sin compilar nada, salvo con AULA_TEST_BUILD=1, que deja
 * una app de mentira y sigue (el DMG, la firma de los feeds y la verificación final también son de mentira).
 */
function releaseFixture(t, { version = '0.2.6', change, plist = ENTITLEMENTS, identities = IDENTITIES } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aula-mac-guard-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const dir of ['scripts', 'build', 'tools', 'bridge', 'docs/release-notes', 'native/tsnet', 'node_modules']) mkdirSync(join(root, dir), { recursive: true })
  for (const file of ['scripts/release-local.sh', 'scripts/release-common.mjs', 'scripts/release-mac-config.mjs']) copyFileSync(join(ROOT, file), join(root, file))
  // js-yaml (lo único que cargan release-common y release-mac-config), del node_modules real
  symlinkSync(dirname(createRequire(join(ROOT, 'package.json')).resolve('js-yaml/package.json')), join(root, 'node_modules/js-yaml'))
  const log = join(root, 'tool-log')
  const logger = (name) => `import { appendFileSync } from 'node:fs'\nappendFileSync(process.env.AULA_TEST_TOOL_LOG, ${JSON.stringify(name)} + ' ' + process.argv.slice(2).join(' ') + '\\n')\n`
  writeFileSync(join(root, 'scripts/release-sign.mjs'), logger('release-sign'))
  writeFileSync(join(root, 'scripts/release-mac-bridge.mjs'), logger('release-mac-bridge'))
  writeFileSync(join(root, 'scripts/release-mac-verify.mjs'), logger('release-mac-verify'))
  writeFileSync(join(root, 'scripts/release-verify.mjs'), logger('release-verify'))
  // AULA_TEST_DMG_EXIT: el paso del DMG falla (p. ej. Apple no lo notariza)
  writeFileSync(join(root, 'scripts/release-mac-dmg.mjs'), logger('release-mac-dmg') + 'process.exitCode = Number(process.env.AULA_TEST_DMG_EXIT || 0)\n')
  const tool = (name, body) => writeFileSync(join(root, 'tools', name), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  const record = (name) => `printf '${name} %s\\n' "$*" >> "$AULA_TEST_TOOL_LOG"`
  tool('npm', record('npm'))
  const app = '"$out/mac-universal/Aula.app/Contents/Resources/bin"'
  tool('npx', `${record('npx')}\nenv | grep -E '^(APPLE|CSC)_' | sort | sed 's/^/env /' >> "$AULA_TEST_TOOL_LOG"
[ "\${AULA_TEST_BUILD:-}" = 1 ] || exit 97
for a in "$@"; do case "$a" in -c.directories.output=*) out="\${a#*=}" ;; esac; done
mkdir -p ${app} && printf sidecar > ${app}/aula-tsnet && chmod +x ${app}/aula-tsnet`)
  tool('security', `${record('security')}\nprintf '%s\\n' "$AULA_TEST_IDENTITIES"`)
  tool('xcrun', `${record('xcrun')}\ncase "$1" in notarytool) [ "\${AULA_TEST_NOTARY:-ok}" = ok ] || { echo 'Error: No Keychain password item found for profile' >&2; exit 69; } ;; --find) echo /usr/bin/stapler ;; esac`)
  tool('codesign', `${record('codesign')}\n[ "$1" = -dv ] && { echo Signature=adhoc; exit 0; }\nexit 98`)
  tool('uname', 'echo Darwin')
  tool('go', 'exit 0')
  tool('lipo', 'echo x86_64 arm64')
  tool('git', `case "$*" in "rev-parse -q --verify refs/tags/"*) exit 1 ;; "rev-parse HEAD") echo 1111111111111111111111111111111111111111 ;; "rev-parse HEAD^{tree}") echo 2222222222222222222222222222222222222222 ;; "status --porcelain") ;; *) echo "unexpected git $*" >&2; exit 99 ;; esac`)
  writeFileSync(join(root, 'native/tsnet/build.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  const config = committed()
  config.releaseInfo = { releaseName: `Aula ${version}`, releaseNotesFile: `docs/release-notes/${version}.md` }
  change?.(config)
  writeFileSync(join(root, 'electron-builder.yml'), yaml.dump(config, { lineWidth: -1 }))
  writeFileSync(join(root, 'build/entitlements.mac.plist'), plist)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version }))
  writeFileSync(join(root, 'VERSION'), `${version}\n`)
  writeFileSync(join(root, 'CHANGELOG.md'), `## [${version}]\n`)
  writeFileSync(join(root, `docs/release-notes/${version}.md`), '<!-- lang:en -->\n# Aula\n<!-- lang:es -->\n# Aula\n')
  // sin las credenciales de firma o de notario que pueda tener quien ejecuta las pruebas (CI suele poner CSC_*)
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(APPLE|CSC)_|^AULA_/.test(key)))
  const run = (env = {}, ...args) => {
    const result = spawnSync('/bin/bash', [join(root, 'scripts/release-local.sh'), '--only', 'mac', '--bridge-dir', join(root, 'bridge'), '--skip-checks', ...args], {
      env: { ...clean, PATH: `${join(root, 'tools')}:${process.env.PATH}`, AULA_TEST_TOOL_LOG: log, AULA_TEST_IDENTITIES: identities, ...env },
      encoding: 'utf8'
    })
    return { ...result, log: existsSync(log) ? readFileSync(log, 'utf8') : '' }
  }
  return { root, run }
}
const built = (log) => /^(npm|npx) /m.test(log)

test('release-local.sh stops before keys, credentials or any build when the Mac config is not Developer ID', (t) => {
  for (const [name, change] of Object.entries(BROKEN)) {
    const result = releaseFixture(t, { change }).run()
    assert.equal(result.status, 1, `${name}: ${result.stderr}`)
    assert.match(result.stderr, /no está listo para Developer ID[\s\S]*La configuración de Mac aún no es Developer ID/, name)
    assert.equal(result.log, '', `${name}: nothing else may run (${result.log})`)
  }
  for (const plist of [NO_JIT, DEBUGGABLE]) {
    const result = releaseFixture(t, { plist }).run()
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /allow-jit|get-task-allow/)
    assert.equal(result.log, '')
  }
})

test('release-local.sh requires exactly one Developer ID identity and a working notary profile before building', (t) => {
  for (const identities of [listing(`2222222222222222222222222222222222222222 "Apple Distribution: Luum Labs (${DEVELOPER_TEAM})"`), `${IDENTITIES}\n  4) 3333333333333333333333333333333333333333 "Developer ID Application: Luum Labs (${DEVELOPER_TEAM})"`]) {
    const result = releaseFixture(t, { identities }).run()
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /exactamente una identidad válida «Developer ID Application»/)
    assert.doesNotMatch(result.log, /xcrun/)
    assert.equal(built(result.log), false)
  }
  const result = releaseFixture(t).run({ AULA_TEST_NOTARY: 'missing', AULA_NOTARY_PROFILE: 'aula-notary' })
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /El perfil de notarytool «aula-notary» no funciona/)
  assert.match(result.log, /^xcrun notarytool history --keychain-profile aula-notary$/m)
  assert.equal(built(result.log), false)
})

test('release-local.sh builds Developer ID with the pinned SHA-1 and only the notary profile', (t) => {
  const competing = { APPLE_ID: 'someone@example.com', APPLE_APP_SPECIFIC_PASSWORD: 'x', APPLE_API_KEY: 'k', APPLE_API_KEY_ID: 'i', APPLE_API_ISSUER: 'u', APPLE_KEYCHAIN: '/tmp/other.keychain', CSC_LINK: '/tmp/cert.p12', CSC_NAME: 'Apple Distribution', CSC_KEY_PASSWORD: 'p', CSC_KEYCHAIN: '/tmp/other.keychain' }
  const result = releaseFixture(t).run(competing)
  assert.equal(result.status, 97, result.stderr)
  assert.match(result.stdout, /✓ macOS: Developer ID 67FA7ED9… y perfil de notarytool «faro-notary»/)
  assert.match(result.log, /^xcrun notarytool history --keychain-profile faro-notary\nxcrun --find stapler$/m)
  assert.match(result.log, new RegExp(`^npx electron-builder --mac --publish never -c\\.directories\\.output=release/0\\.2\\.6 -c\\.mac\\.identity=${DEV_ID}$`, 'm'))
  // solo el perfil del notario llega a electron-builder
  assert.deepEqual(result.log.split('\n').filter((line) => line.startsWith('env ')), ['env APPLE_KEYCHAIN_PROFILE=faro-notary'])
  // el puente se comprueba después de la configuración y antes de leer la clave de las actualizaciones
  assert.ok(result.log.indexOf('release-mac-bridge check-baseline') < result.log.indexOf('release-sign --check-key'))
  const custom = releaseFixture(t).run({ AULA_NOTARY_PROFILE: 'aula-notary' })
  assert.equal(custom.status, 97, custom.stderr)
  assert.match(custom.log, /^env APPLE_KEYCHAIN_PROFILE=aula-notary$/m)
})

test('AULA_MAC_ADHOC=1 builds a test-only app: ad hoc, no hardened runtime, no notarization, no credentials', (t) => {
  const result = releaseFixture(t).run({ AULA_MAC_ADHOC: '1', APPLE_KEYCHAIN_PROFILE: 'faro-notary', APPLE_ID: 'someone@example.com' })
  assert.equal(result.status, 97, result.stderr)
  assert.match(result.stdout, /AULA_MAC_ADHOC=1: macOS sale ad hoc/)
  assert.match(result.log, /^npx electron-builder --mac --publish never -c\.directories\.output=release\/0\.2\.6 -c\.mac\.identity=- -c\.mac\.hardenedRuntime=false -c\.mac\.notarize=false -c\.mac\.forceCodeSigning=false$/m)
  assert.doesNotMatch(result.log, /^env /m, 'no notary or signing credentials reach the test build')
  assert.doesNotMatch(result.log, /^(security|xcrun) /m)
  // y el guard de configuración sigue exigiendo Developer ID en electron-builder.yml
  const broken = releaseFixture(t, { change: BROKEN['the frozen 0.2.5 local signer'] }).run({ AULA_MAC_ADHOC: '1' })
  assert.equal(broken.status, 1, broken.stderr)
  assert.equal(built(broken.log), false)
})

test('Mac releases up to the 0.2.5 bridge are no longer built (its local signer is retired)', (t) => {
  const result = releaseFixture(t, { version: '0.2.5' }).run()
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /macOS 0\.2\.5 ya no se compila/)
  assert.equal(built(result.log), false)
  assert.doesNotMatch(result.log, /^(security|xcrun) /m)
})

// lo que hace el guion con lo compilado, en orden (sin los env de npx)
const steps = (log) => log.split('\n').filter((line) => /^(npm|npx|release-[a-z-]+) /.test(line))

test('release-local.sh finishes the DMG right after the build and before the update feeds are signed', (t) => {
  const f = releaseFixture(t, { version: '0.2.7' })
  const result = f.run({ AULA_TEST_BUILD: '1' })
  assert.equal(result.status, 0, result.stderr)
  const bridge = join(f.root, 'bridge')
  assert.deepEqual(steps(result.log), [
    `release-mac-bridge check-baseline ${bridge}`,
    'release-sign --check-key',
    'npm run build',
    `npx electron-builder --mac --publish never -c.directories.output=release/0.2.7 -c.mac.identity=${DEV_ID}`,
    // con la misma identidad fijada y el mismo perfil del notario que la app
    `release-mac-dmg finish release/0.2.7 0.2.7 --identity ${DEV_ID} --keychain-profile faro-notary`,
    // la firma de las actualizaciones y el canal Developer ID (copia de latest-mac.yml) ya ven el DMG final
    'release-sign release/0.2.7 --only latest-mac.yml',
    `release-mac-bridge prepare release/0.2.7 0.2.7 --bridge-dir ${bridge}`,
    'release-mac-verify release/0.2.7 0.2.7'
  ])
  assert.match(readFileSync(join(f.root, 'release/0.2.7/BUILD_INFO.mac'), 'utf8'), /^dirty=0$/m)
  const custom = releaseFixture(t, { version: '0.2.7' }).run({ AULA_TEST_BUILD: '1', AULA_NOTARY_PROFILE: 'aula-notary' })
  assert.equal(custom.status, 0, custom.stderr)
  assert.match(custom.log, new RegExp(`^release-mac-dmg finish release/0\\.2\\.7 0\\.2\\.7 --identity ${DEV_ID} --keychain-profile aula-notary$`, 'm'))
})

test('a DMG that is not signed, notarized and stapled stops the release before the update feeds are signed', (t) => {
  const f = releaseFixture(t, { version: '0.2.7' })
  const result = f.run({ AULA_TEST_BUILD: '1', AULA_TEST_DMG_EXIT: '1' })
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /El DMG de macOS no quedó firmado, notarizado y grapado/)
  assert.equal(steps(result.log).at(-1), `release-mac-dmg finish release/0.2.7 0.2.7 --identity ${DEV_ID} --keychain-profile faro-notary`)
  assert.doesNotMatch(result.log, /^release-sign release\//m)
  assert.doesNotMatch(result.log, /^release-mac-(bridge prepare|verify) /m)
  assert.equal(existsSync(join(f.root, 'release/0.2.7/BUILD_INFO.mac')), false, 'nothing counts as ready to upload')
})

test('AULA_MAC_ADHOC=1 test builds leave the DMG alone', (t) => {
  const result = releaseFixture(t, { version: '0.2.7' }).run({ AULA_TEST_BUILD: '1', AULA_MAC_ADHOC: '1' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.log, /^codesign -dv release\/0\.2\.7\/mac-universal\/Aula\.app$/m)
  assert.doesNotMatch(result.log, /release-mac-dmg|^(security|xcrun) /m)
  assert.match(result.log, /^release-sign release\/0\.2\.7 --only latest-mac\.yml$/m)
  assert.doesNotMatch(result.log, /^release-mac-verify /m)
})
