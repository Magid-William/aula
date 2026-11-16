// Verifica la app EXTRAÍDA DEL ZIP final y la del DMG final (montado solo lectura). No confía en mac-universal/Aula.app
// ni usa claves privadas.
// node scripts/release-mac-verify.mjs release/0.2.6 0.2.6
import { spawnSync } from 'node:child_process'
import { closeSync, lstatSync, mkdirSync, mkdtempSync, openSync, readSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUNDLE_ID, BRIDGE_VERSION, DEVELOPER_TEAM, LEGACY_PIN, macMode, regularFile } from './release-common.mjs'
import { verifyMacChannels } from './release-mac-bridge.mjs'
import { DEBUG_ENTITLEMENT, JIT_ENTITLEMENT, grants, mentions } from './release-mac-config.mjs'

export const LEGACY_REQUIREMENT = `identifier "${BUNDLE_ID}" and certificate root = H"${LEGACY_PIN}"`
export const DEVELOPER_REQUIREMENT = `identifier "${BUNDLE_ID}" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "${DEVELOPER_TEAM}"`
const DEVELOPER_CODE_REQUIREMENT = DEVELOPER_REQUIREMENT.replace(`identifier "${BUNDLE_ID}" and `, '')
// El vigilante de 0.2.5 (congelado) vuelve a abrir la app por este nombre, y 0.2.5 exige macOS 13 (mac-install.ts).
export const EXECUTABLE = 'Aula'
export const MAX_MINIMUM_SYSTEM = '13.0'

function run(file, args) {
  // montar y comprobar un DMG de cientos de MB lleva más que el resto
  const timeout = file.endsWith('/hdiutil') ? 600_000 : 180_000
  const result = spawnSync(file, args, { encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C', LANG: 'C' } })
  if (result.error || result.status !== 0) throw new Error(`${file}: falló la comprobación (${result.error?.message ?? result.status})\n${result.stderr ?? ''}`)
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
}

export function checkArchiveEntries(list) {
  const entries = list.split('\n').filter(Boolean)
  if (!entries.length || !entries.some((entry) => entry.startsWith('Aula.app/'))) throw new Error('El ZIP no contiene Aula.app')
  for (const entry of entries) {
    if (entry.includes('\\') || entry.split('/').some((part) => part === '..' || part === '.') || /[\x00-\x1f]/.test(entry) || !(entry === 'Aula.app' || entry.startsWith('Aula.app/') || entry.startsWith('__MACOSX/'))) throw new Error(`Ruta no permitida en el ZIP: ${entry}`)
  }
}

export function checkDeveloperDetails(details) {
  const flags = /^.*flags=0x([a-f0-9]+)/im.exec(details)
  if (!flags || !(parseInt(flags[1], 16) & 0x10000)) throw new Error('Falta hardened runtime en el código Developer ID')
  if (!/^Timestamp=(?!none$|not set$).+/m.test(details)) throw new Error('Falta el sello de tiempo seguro de Apple')
  if (!details.includes(`TeamIdentifier=${DEVELOPER_TEAM}`) || !/^Authority=Developer ID Application:/m.test(details)) throw new Error('No es Developer ID Application del equipo de Aula')
}

/** Entitlements (XML de codesign): nunca depurable; los procesos de Electron (.app) necesitan allow-jit. */
export function checkEntitlements(xml, { launches }) {
  if (mentions(xml, DEBUG_ENTITLEMENT)) throw new Error(`Lleva ${DEBUG_ENTITLEMENT}: código depurable`)
  if (launches && !grants(xml, JIT_ENTITLEMENT)) throw new Error(`Falta ${JIT_ENTITLEMENT}: con hardened runtime, Electron no arranca`)
}

/** -1, 0 o 1 entre dos versiones «13», «13.0», «12.5.1». */
export function compareSystemVersions(a, b) {
  const parse = (v) => {
    if (typeof v !== 'string' || !/^\d+(?:\.\d+){0,2}$/.test(v)) throw new Error(`Versión de macOS no válida: ${String(v)}`)
    return v.split('.').map(Number)
  }
  const x = parse(a), y = parse(b)
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1
  return 0
}

// Mach-O fino (32/64 bits, cualquier orden de bytes) o universal; un .class de Java también empieza por CAFEBABE,
// pero con un «número de arquitecturas» enorme (su versión)
const THIN = new Set([0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe])
const FAT = new Set([0xcafebabe, 0xcafebabf])
export function isMachO(path) {
  const header = Buffer.alloc(8)
  const fd = openSync(path, 'r')
  try {
    if (readSync(fd, header, 0, 8, 0) < 8) return false
  } finally {
    closeSync(fd)
  }
  const magic = header.readUInt32BE(0)
  if (THIN.has(magic)) return true
  const count = header.readUInt32BE(4)
  return FAT.has(magic) && count > 0 && count < 20
}

/** Todo el código firmado de la app: ella, cada .app de dentro (procesos), cada Mach-O suelto y el sidecar. */
function signedCode(app) {
  const code = new Map([[app, { launches: true }]])
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.endsWith('.app')) code.set(path, { launches: true })
        walk(path)
      } else if (entry.isFile() && isMachO(path) && !code.has(path)) code.set(path, { launches: false })
    }
  }
  walk(join(app, 'Contents'))
  const sidecar = join(app, 'Contents/Resources/bin/aula-tsnet')
  if (!(regularFile(sidecar).mode & 0o111)) throw new Error('La app no contiene aula-tsnet ejecutable')
  if (!code.has(sidecar)) code.set(sidecar, { launches: false })
  return code
}

function plistValue(execute, plist, key) {
  try { return execute('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist]) } catch { throw new Error(`Falta ${key} en Info.plist`) }
}

/** La app final (del ZIP o del DMG): identidad, versión, Info.plist, universal, firma y, desde 0.2.6, notarización. */
export function verifyMacApp(app, version, { execute = run, label = 'ZIP' } = {}) {
  const mode = macMode(version)
  const stat = lstatSync(app)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Aula.app del ${label} no es un paquete regular`)
  const plist = join(app, 'Contents/Info.plist')
  if (plistValue(execute, plist, 'CFBundleIdentifier') !== BUNDLE_ID) throw new Error(`Bundle id incorrecto en el ${label}`)
  if (plistValue(execute, plist, 'CFBundleShortVersionString') !== version) throw new Error(`Versión incorrecta en el ${label}`)
  if (plistValue(execute, plist, 'CFBundleExecutable') !== EXECUTABLE) throw new Error(`CFBundleExecutable del ${label} tiene que ser «${EXECUTABLE}» (el vigilante de 0.2.5 reabre la app por ese nombre)`)
  const minimum = plistValue(execute, plist, 'LSMinimumSystemVersion')
  if (compareSystemVersions(minimum, MAX_MINIMUM_SYSTEM) > 0) throw new Error(`LSMinimumSystemVersion ${minimum} del ${label}: las copias en macOS ${MAX_MINIMUM_SYSTEM} no podrían instalarla`)
  const archs = execute('/usr/bin/lipo', ['-archs', join(app, 'Contents/MacOS', EXECUTABLE)]).split(/\s+/)
  if (archs.length !== 2 || !archs.includes('arm64') || !archs.includes('x86_64')) throw new Error(`El ${label} Mac debe contener una app universal arm64 + x86_64`)
  execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--all-architectures', '-R', '=' + (mode === 'developer-id' ? DEVELOPER_REQUIREMENT : LEGACY_REQUIREMENT), app])
  if (mode !== 'developer-id') return
  for (const [code, { launches }] of signedCode(app)) {
    const where = code.slice(app.length + 1) || 'Aula.app'
    try {
      execute('/usr/bin/codesign', ['--verify', '--strict', '--all-architectures', '-R', '=' + DEVELOPER_CODE_REQUIREMENT, code])
      for (const arch of archs) checkDeveloperDetails(execute('/usr/bin/codesign', ['--display', '--verbose=4', '--arch', arch, code]))
      checkEntitlements(execute('/usr/bin/codesign', ['--display', '--entitlements', '-', '--xml', code]), { launches })
    } catch (error) {
      throw new Error(`${where} (${label}): ${error.message}`)
    }
  }
  execute('/usr/bin/xcrun', ['stapler', 'validate', app])
  const assessment = execute('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', app])
  if (!/^source=Notarized Developer ID$/m.test(assessment)) throw new Error(`Gatekeeper no confirma Notarized Developer ID en el ${label}`)
}

export async function verifyMacZip(zip, version, { execute = run, platform = process.platform } = {}) {
  if (platform !== 'darwin') throw new Error('La verificación de firma del ZIP final requiere macOS')
  regularFile(zip)
  const temp = mkdtempSync(join(tmpdir(), 'aula-release-zip-'))
  try {
    checkArchiveEntries(execute('/usr/bin/unzip', ['-Z1', zip]))
    execute('/usr/bin/ditto', ['-x', '-k', zip, temp])
    verifyMacApp(join(temp, 'Aula.app'), version, { execute, label: 'ZIP' })
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

/** Lo que instalan los usuarios nuevos: el DMG, montado solo lectura y sin Finder; siempre se desmonta. */
export async function verifyMacDmg(dmg, version, { execute = run, platform = process.platform } = {}) {
  if (platform !== 'darwin') throw new Error('La verificación de firma del DMG final requiere macOS')
  regularFile(dmg)
  const temp = mkdtempSync(join(tmpdir(), 'aula-release-dmg-'))
  const mount = join(temp, 'volume')
  mkdirSync(mount)
  let attached = false
  let failure = null
  try {
    execute('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, dmg])
    attached = true
    const apps = readdirSync(mount).filter((name) => name.endsWith('.app'))
    if (apps.length !== 1 || apps[0] !== 'Aula.app') throw new Error(`El DMG tiene que contener solo Aula.app (tiene ${apps.join(', ') || 'ninguna'})`)
    verifyMacApp(join(mount, 'Aula.app'), version, { execute, label: 'DMG' })
  } catch (error) {
    failure = error
  }
  if (attached) {
    try {
      execute('/usr/bin/hdiutil', ['detach', mount])
    } catch {
      try {
        execute('/usr/bin/hdiutil', ['detach', '-force', mount])
      } catch (detach) {
        // montado no se borra nada: el volumen es solo lectura y la carpeta se queda para desmontarla a mano
        throw new Error(`No se pudo desmontar ${mount} (hdiutil detach -force): ${detach.message}${failure ? `\nAntes: ${failure.message}` : ''}`)
      }
    }
  }
  rmSync(temp, { recursive: true, force: true })
  if (failure) throw failure
}

export function checkMacArtifactNames(dir, version) {
  const versions = macMode(version) === 'developer-id' ? [version, BRIDGE_VERSION] : [version]
  const allowed = new Set(versions.flatMap(v => ['zip', 'dmg', 'zip.blockmap', 'dmg.blockmap'].map(ext => `Aula-${v}-mac.${ext}`)))
  for (const name of readdirSync(dir)) {
    if (/\.(zip|dmg)(\.blockmap)?$/.test(name) && !allowed.has(name)) throw new Error(`Archivo Mac fuera de los canales verificados: ${name}`)
  }
}

export async function verifyMacRelease(dir, version, options = {}) {
  checkMacArtifactNames(dir, version)
  await verifyMacChannels(dir, version, options)
  await verifyMacZip(join(dir, `Aula-${version}-mac.zip`), version, options)
  await verifyMacDmg(join(dir, `Aula-${version}-mac.dmg`), version, options)
  // También se publica el ZIP histórico dentro de la release nueva: vuelve a verificarse con el pin legado exacto.
  // Su DMG ya está fijado byte a byte por el manifiesto del puente.
  if (macMode(version) === 'developer-id') await verifyMacZip(join(dir, `Aula-${BRIDGE_VERSION}-mac.zip`), BRIDGE_VERSION, options)
}

async function main() {
  const [dir, version] = process.argv.slice(2)
  if (!dir || !version || process.argv.length !== 4) throw new Error('Uso: release-mac-verify.mjs <carpeta-release> <versión>')
  if (process.env.AULA_MAC_ADHOC === '1') throw new Error('AULA_MAC_ADHOC no permite publicar: solo sirve para probar compilaciones')
  await verifyMacRelease(resolve(dir), version)
  console.log(`✓ ZIP y DMG finales ${version}: identidad, versión y firma Mac verificadas`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`✗ ${error.message}`); process.exitCode = 1 })
