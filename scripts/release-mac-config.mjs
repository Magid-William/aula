// Firma Mac desde 0.2.6 (Developer ID): lo que scripts/release-local.sh comprueba ANTES de compilar. No abre claves.
//   node scripts/release-mac-config.mjs check
//       electron-builder.yml → mac: Developer ID con hardened runtime, forceCodeSigning, sello de Apple y allow-jit
//   security find-identity -v -p codesigning | node scripts/release-mac-config.mjs identity
//       → SHA-1 de la ÚNICA identidad válida «Developer ID Application: … (87BM9KFJZW)»
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEVELOPER_TEAM, ROOT, yaml } from './release-common.mjs'

export const JIT_ENTITLEMENT = 'com.apple.security.cs.allow-jit'
export const DEBUG_ENTITLEMENT = 'com.apple.security.get-task-allow'

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** ¿El plist (XML) concede esa clave con <true/>? */
export const grants = (plist, key) => new RegExp(`<key>\\s*${escape(key)}\\s*</key>\\s*<true\\s*/>`).test(plist)
/** ¿El plist menciona esa clave, con el valor que sea? */
export const mentions = (plist, key) => new RegExp(`<key>\\s*${escape(key)}\\s*</key>`).test(plist)

/** Lo que impide firmar con Developer ID; vacío si la configuración está lista. */
export function developerIdConfigProblems(config, readText = (path) => readFileSync(join(ROOT, path), 'utf8')) {
  const mac = config?.mac
  if (!mac || typeof mac !== 'object') return ['falta el bloque mac']
  const problems = []
  // la identidad la fija el guion por su SHA-1; null no firma y "-" firma ad hoc
  if (Object.hasOwn(mac, 'identity')) problems.push(`mac.identity (${JSON.stringify(mac.identity)}): quítalo, el guion pasa el SHA-1 de la identidad Developer ID`)
  if (mac.sign != null) problems.push('mac.sign: el firmador propio (el local de 0.2.5 u otro) no sirve')
  if (mac.hardenedRuntime !== true) problems.push('mac.hardenedRuntime tiene que ser true')
  if (mac.forceCodeSigning !== true) problems.push('mac.forceCodeSigning tiene que ser true (sin identidad, fallar en vez de salir sin firma)')
  if (mac.timestamp !== undefined) problems.push(`mac.timestamp (${JSON.stringify(mac.timestamp)}): quítalo, sin él se usa el sello seguro de Apple`)
  if (mac.notarize === false) problems.push('mac.notarize: false se salta la notarización')
  if (mac.type !== undefined && mac.type !== 'distribution') problems.push(`mac.type (${JSON.stringify(mac.type)}): solo distribution`)
  if (config.dmg?.sign === true) problems.push('dmg.sign: electron-builder lo firmaría sin notarizar; el DMG lo firma, notariza y grapa scripts/release-mac-dmg.mjs')
  for (const key of ['entitlements', 'entitlementsInherit']) {
    const path = mac[key]
    if (typeof path !== 'string' || !path) { problems.push(`mac.${key}: falta`); continue }
    let plist
    try { plist = readText(path) } catch { problems.push(`mac.${key}: no se puede leer ${path}`); continue }
    if (!grants(plist, JIT_ENTITLEMENT)) problems.push(`${path} (mac.${key}) no concede ${JIT_ENTITLEMENT}: Electron no arranca con hardened runtime`)
    if (mentions(plist, DEBUG_ENTITLEMENT)) problems.push(`${path} (mac.${key}) lleva ${DEBUG_ENTITLEMENT}: Apple no notariza código depurable`)
  }
  return problems
}

/** SHA-1 de la única identidad válida «Developer ID Application: … (<equipo>)» de `security find-identity -v -p codesigning`. */
export function developerIdentity(listing, team = DEVELOPER_TEAM) {
  const hashes = new Set()
  for (const line of String(listing).split('\n')) {
    const m = /^\s*\d+\)\s+([0-9A-F]{40})\s+"Developer ID Application: .+ \(([A-Z0-9]{10})\)"\s*$/.exec(line)
    if (m && m[2] === team) hashes.add(m[1])
  }
  if (hashes.size === 0) throw new Error(`No hay ninguna identidad válida «Developer ID Application: … (${team})» en el llavero`)
  if (hashes.size > 1) throw new Error(`Hay ${hashes.size} identidades válidas «Developer ID Application: … (${team})»: deja solo una en el llavero`)
  return [...hashes][0]
}

function main() {
  const [command, ...rest] = process.argv.slice(2)
  if (command === 'check' && !rest.length) {
    const problems = developerIdConfigProblems(yaml.load(readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8')))
    if (problems.length) throw new Error(`electron-builder.yml no está listo para Developer ID:\n  - ${problems.join('\n  - ')}`)
    console.log('✓ electron-builder.yml: Developer ID con hardened runtime, forceCodeSigning, sello de Apple y allow-jit')
  } else if (command === 'identity' && !rest.length) {
    process.stdout.write(`${developerIdentity(readFileSync(0, 'utf8'))}\n`)
  } else throw new Error('Uso: release-mac-config.mjs check | identity (lee la salida de security find-identity -v -p codesigning)')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (error) { console.error(`✗ ${error.message}`); process.exitCode = 1 }
}
