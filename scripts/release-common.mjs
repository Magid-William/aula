// Lectura y comprobación de feeds de publicación. Solo claves públicas; nunca abre el llavero.
import { createHash, createPublicKey, verify } from 'node:crypto'
import { createReadStream, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const yaml = createRequire(import.meta.url)('js-yaml')
export const BRIDGE_VERSION = '0.2.5'
export const BRIDGE_REPO = 'luumlabs/aula'
export const LEGACY_FEED = 'latest-mac.yml'
export const DEVELOPER_FEED = 'developer-id-mac.yml'
export const MANIFEST = join(ROOT, 'resources/updates/mac-bridge-0.2.5.json')
export const LEGACY_PIN = '26061b07d114b31e63193681c2909e1343076926'
export const DEVELOPER_TEAM = '87BM9KFJZW'
export const BUNDLE_ID = 'com.luumlabs.aula'
// 0.2.6 publicó el DMG sin firmar (la app de dentro sí, notarizada); desde aquí release-mac-dmg.mjs firma el DMG
export const SIGNED_DMG_VERSION = '0.2.7'
export const BRIDGE_FILES = [LEGACY_FEED, `Aula-${BRIDGE_VERSION}-mac.zip`, `Aula-${BRIDGE_VERSION}-mac.zip.blockmap`, `Aula-${BRIDGE_VERSION}-mac.dmg`, `Aula-${BRIDGE_VERSION}-mac.dmg.blockmap`]

export function publicKeys(root = ROOT) {
  const source = readFileSync(join(root, 'src/main/services/updates/signature.ts'), 'utf8')
  const block = /export const UPDATE_PUBLIC_KEYS[^=]*=\s*\[([^\]]*)\]/.exec(source)
  const keys = [...(block?.[1] ?? '').matchAll(/'([A-Za-z0-9+/=]+)'/g)].map((m) => createPublicKey({ key: Buffer.from(m[1], 'base64'), format: 'der', type: 'spki' }))
  if (!keys.length) throw new Error('No encuentro UPDATE_PUBLIC_KEYS en signature.ts')
  return keys
}

export const artifactMessage = (name, version, sha512) => Buffer.from(`aula-update-v1\n${name}\n${version}\n${sha512}`)
export const notesMessage = (version, notes) => Buffer.from(`aula-notes-v1\n${version}\n${createHash('sha512').update(notes, 'utf8').digest('base64')}`)
export const validSignature = (message, signature, keys) => typeof signature === 'string' && keys.some((key) => {
  try { return verify(null, message, key, Buffer.from(signature, 'base64')) } catch { return false }
})

export function assetName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value.includes('..')) throw new Error(`Nombre de archivo no válido: ${String(value)}`)
  return value
}

export function regularFile(path) {
  let stat
  try { stat = lstatSync(path) } catch { throw new Error(`Falta ${path}`) }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0) throw new Error(`No es un archivo regular con contenido: ${path}`)
  return stat
}

export async function hashFile(path, algorithm = 'sha512', encoding = 'base64') {
  regularFile(path)
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest(encoding)
}

export function metadataFiles(dir) {
  return readdirSync(dir).filter((name) => /^latest(?:-[a-z0-9-]+)?\.yml$/.test(name) || name === DEVELOPER_FEED).sort()
}

export function readMetadata(dir, name) {
  const path = join(dir, assetName(name))
  regularFile(path)
  const info = yaml.load(readFileSync(path, 'utf8'))
  if (!info || typeof info !== 'object' || Array.isArray(info) || typeof info.version !== 'string' || !Array.isArray(info.files) || !info.files.length) throw new Error(`${name}: feed vacío o no válido`)
  return info
}

export async function verifyMetadata(dir, name, { version, keys = publicKeys(), signatures = true, notes = true } = {}) {
  const info = readMetadata(dir, name)
  if (version && info.version !== version) throw new Error(`${name}: versión ${info.version}, se esperaba ${version}`)
  const seen = new Set()
  for (const entry of info.files) {
    const file = assetName(entry?.url)
    if (seen.has(file)) throw new Error(`${name}: archivo repetido ${file}`)
    seen.add(file)
    const path = join(dir, file)
    const stat = regularFile(path)
    if (typeof entry.sha512 !== 'string' || await hashFile(path) !== entry.sha512) throw new Error(`${name}: SHA-512 incorrecto de ${file}`)
    if (entry.size !== undefined && entry.size !== stat.size) throw new Error(`${name}: tamaño incorrecto de ${file}`)
    if (signatures && !validSignature(artifactMessage(file, info.version, entry.sha512), entry.aulaSignature, keys)) throw new Error(`${name}: ${file} sin firma válida de Aula`)
  }
  if (info.path !== undefined) {
    const selected = info.files.find((entry) => entry.url === assetName(info.path))
    if (!selected || info.sha512 !== selected.sha512) throw new Error(`${name}: path/sha512 no corresponde a files`)
  }
  if (notes && (typeof info.releaseNotes !== 'string' || !info.releaseNotes.trim())) throw new Error(`${name}: faltan las notas de la versión`)
  if (signatures && typeof info.releaseNotes === 'string' && !validSignature(notesMessage(info.version, info.releaseNotes), info.aulaNotesSignature, keys)) throw new Error(`${name}: notas sin firma válida de Aula`)
  return info
}

/** -1, 0 o 1 entre dos versiones estables «x.y.z». */
export function compareVersions(a, b) {
  const parse = (version) => {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Versión estable no válida: ${version}`)
    return version.split('.').map(Number)
  }
  const x = parse(a), y = parse(b)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  return 0
}

export function macMode(version) {
  const order = compareVersions(version, BRIDGE_VERSION)
  return order > 0 ? 'developer-id' : order < 0 ? 'legacy' : 'bridge'
}

/** ¿El DMG mismo (no solo la app de dentro) va firmado con Developer ID, notarizado y grapado? Desde 0.2.7. */
export const signedDmg = (version) => compareVersions(version, SIGNED_DMG_VERSION) >= 0
