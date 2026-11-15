// Verifica la app EXTRAÍDA DEL ZIP final. No confía en mac-universal/Aula.app ni usa claves privadas.
// node scripts/release-mac-verify.mjs release/0.2.5 0.2.5
import { spawnSync } from 'node:child_process'
import { lstatSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUNDLE_ID, BRIDGE_VERSION, DEVELOPER_TEAM, LEGACY_PIN, macMode, regularFile } from './release-common.mjs'
import { verifyMacChannels } from './release-mac-bridge.mjs'

export const LEGACY_REQUIREMENT = `identifier "${BUNDLE_ID}" and certificate root = H"${LEGACY_PIN}"`
export const DEVELOPER_REQUIREMENT = `identifier "${BUNDLE_ID}" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "${DEVELOPER_TEAM}"`
const DEVELOPER_CODE_REQUIREMENT = DEVELOPER_REQUIREMENT.replace(`identifier "${BUNDLE_ID}" and `, '')

function run(file, args) {
  const result = spawnSync(file, args, { encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C', LANG: 'C' } })
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

/** Los helpers y el sidecar también son ejecutables: runtime y timestamp se exigen por arquitectura. */
function executableBundles(app) {
  const out = [app]
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue
      const path = join(dir, entry.name)
      if (entry.name.endsWith('.app')) out.push(path)
      walk(path)
    }
  }
  walk(join(app, 'Contents'))
  const sidecar = join(app, 'Contents/Resources/bin/aula-tsnet')
  if (!(regularFile(sidecar).mode & 0o111)) throw new Error('El ZIP no contiene aula-tsnet ejecutable')
  out.push(sidecar)
  return out
}

export async function verifyMacZip(zip, version, { execute = run, platform = process.platform } = {}) {
  if (platform !== 'darwin') throw new Error('La verificación de firma del ZIP final requiere macOS')
  regularFile(zip)
  const mode = macMode(version)
  const temp = mkdtempSync(join(tmpdir(), 'aula-release-zip-'))
  try {
    checkArchiveEntries(execute('/usr/bin/unzip', ['-Z1', zip]))
    execute('/usr/bin/ditto', ['-x', '-k', zip, temp])
    const app = join(temp, 'Aula.app')
    const stat = lstatSync(app)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Aula.app extraída no es un paquete regular')
    const plist = join(app, 'Contents/Info.plist')
    if (execute('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plist]) !== BUNDLE_ID) throw new Error('Bundle id incorrecto en el ZIP')
    if (execute('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plist]) !== version) throw new Error('Versión incorrecta en el ZIP')
    const executable = execute('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', plist])
    if (!/^[A-Za-z0-9._-]+$/.test(executable)) throw new Error('CFBundleExecutable no válido')
    const archs = execute('/usr/bin/lipo', ['-archs', join(app, 'Contents/MacOS', executable)]).split(/\s+/)
    if (archs.length !== 2 || !archs.includes('arm64') || !archs.includes('x86_64')) throw new Error('El ZIP Mac debe contener una app universal arm64 + x86_64')
    execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--all-architectures', '-R', '=' + (mode === 'developer-id' ? DEVELOPER_REQUIREMENT : LEGACY_REQUIREMENT), app])
    if (mode === 'developer-id') {
      for (const code of executableBundles(app)) {
        execute('/usr/bin/codesign', ['--verify', '--strict', '--all-architectures', '-R', '=' + DEVELOPER_CODE_REQUIREMENT, code])
        for (const arch of archs) checkDeveloperDetails(execute('/usr/bin/codesign', ['--display', '--verbose=4', '--arch', arch, code]))
      }
      execute('/usr/bin/xcrun', ['stapler', 'validate', app])
      const assessment = execute('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', app])
      if (!/^source=Notarized Developer ID$/m.test(assessment)) throw new Error('Gatekeeper no confirma Notarized Developer ID')
    }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
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
  // También se publica el ZIP histórico dentro de la release nueva: vuelve a verificarse con el pin legado exacto.
  if (macMode(version) === 'developer-id') await verifyMacZip(join(dir, `Aula-${BRIDGE_VERSION}-mac.zip`), BRIDGE_VERSION, options)
}

async function main() {
  const [dir, version] = process.argv.slice(2)
  if (!dir || !version || process.argv.length !== 4) throw new Error('Uso: release-mac-verify.mjs <carpeta-release> <versión>')
  if (process.env.AULA_MAC_ADHOC === '1') throw new Error('AULA_MAC_ADHOC no permite publicar: solo sirve para probar compilaciones')
  await verifyMacRelease(resolve(dir), version)
  console.log(`✓ ZIP final ${version}: identidad, versión y firma Mac verificadas`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`✗ ${error.message}`); process.exitCode = 1 })
