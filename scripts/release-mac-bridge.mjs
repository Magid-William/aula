// Puente Mac: nunca reconstruye ni vuelve a serializar los bytes publicados de 0.2.5.
// prepare <carpeta> <versión> [--bridge-dir <originales-v0.2.5>]
// manifest <originales-v0.2.5> <salida.json>  (solo después de publicar; comprueba también GitHub)
// check-baseline <originales-v0.2.5>         (manifiesto público del repositorio + archivos originales)
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import {
  BRIDGE_FILES, BRIDGE_REPO, BRIDGE_VERSION, DEVELOPER_FEED, DEVELOPER_TEAM, LEGACY_FEED, LEGACY_PIN, MANIFEST,
  hashFile, macMode, publicKeys, readMetadata, regularFile, verifyMetadata
} from './release-common.mjs'

function macArtifacts(info) {
  const wanted = [`Aula-${info.version}-mac.zip`, `Aula-${info.version}-mac.dmg`].sort()
  if (JSON.stringify(info.files.map((entry) => entry.url).sort()) !== JSON.stringify(wanted)) throw new Error(`El feed Mac ${info.version} debe anunciar exactamente el ZIP y el DMG universales`)
}

export function readBridgeManifest(path = MANIFEST) {
  if (!existsSync(path)) throw new Error(`Falta el manifiesto inmutable ${path}. Se fija después de publicar v${BRIDGE_VERSION}; no se inventan hashes ni se reconstruye el puente.`)
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  if (manifest.schema !== 1 || manifest.version !== BRIDGE_VERSION || manifest.repository !== BRIDGE_REPO || manifest.tag !== `v${BRIDGE_VERSION}` || manifest.legacyCertificateSHA1 !== LEGACY_PIN || manifest.developerTeam !== DEVELOPER_TEAM || !Number.isFinite(Date.parse(manifest.publishedAt))) throw new Error('Manifiesto del puente no válido')
  if (!Array.isArray(manifest.files) || JSON.stringify(manifest.files.map((file) => file.name).sort()) !== JSON.stringify([...BRIDGE_FILES].sort())) throw new Error('El manifiesto no enumera todos los originales del puente, o repite archivos')
  for (const file of manifest.files) if (!Number.isSafeInteger(file.bytes) || file.bytes <= 0 || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512)) throw new Error(`Hash o tamaño no válido en el manifiesto: ${file.name}`)
  return manifest
}

export async function verifyBridgeFiles(dir, { manifestPath = MANIFEST, keys = publicKeys() } = {}) {
  const manifest = readBridgeManifest(manifestPath)
  for (const file of manifest.files) {
    const path = join(dir, file.name)
    if (regularFile(path).size !== file.bytes || await hashFile(path) !== file.sha512) throw new Error(`El original ${file.name} no coincide con el manifiesto inmutable del puente`)
  }
  macArtifacts(await verifyMetadata(dir, LEGACY_FEED, { version: BRIDGE_VERSION, keys }))
  return manifest
}

export async function verifyMacChannels(dir, version, options = {}) {
  const keys = options.keys ?? publicKeys()
  const mode = macMode(version)
  if (mode === 'legacy') return verifyMetadata(dir, LEGACY_FEED, { version, keys })
  const current = await verifyMetadata(dir, DEVELOPER_FEED, { version, keys })
  macArtifacts(current)
  if (mode === 'bridge') {
    macArtifacts(await verifyMetadata(dir, LEGACY_FEED, { version, keys }))
    if (!readFileSync(join(dir, LEGACY_FEED)).equals(readFileSync(join(dir, DEVELOPER_FEED)))) throw new Error('Los dos canales de 0.2.5 deben ser idénticos byte a byte')
    for (const file of BRIDGE_FILES) regularFile(join(dir, file))
  } else await verifyBridgeFiles(dir, { ...options, keys })
  return current
}

export async function prepareMacChannels(dir, version, { bridgeDir, manifestPath = MANIFEST, keys = publicKeys() } = {}) {
  const mode = macMode(version)
  if (mode === 'legacy') throw new Error('El preparador del puente solo se usa desde 0.2.5')
  if (mode === 'bridge') {
    macArtifacts(await verifyMetadata(dir, LEGACY_FEED, { version, keys }))
    for (const file of BRIDGE_FILES) regularFile(join(dir, file))
    copyFileSync(join(dir, LEGACY_FEED), join(dir, DEVELOPER_FEED))
  } else {
    if (!bridgeDir || resolve(bridgeDir) === resolve(dir)) throw new Error('Hace falta --bridge-dir con los originales publicados de v0.2.5, fuera de la carpeta nueva')
    await verifyBridgeFiles(bridgeDir, { manifestPath, keys })
    // En la primera pasada, electron-builder deja la versión nueva en latest-mac. En las siguientes ya está preparada.
    const generated = readMetadata(dir, LEGACY_FEED).version === version ? LEGACY_FEED : DEVELOPER_FEED
    macArtifacts(await verifyMetadata(dir, generated, { version, keys }))
    for (const file of BRIDGE_FILES.filter((name) => name !== LEGACY_FEED)) {
      const dest = join(dir, file)
      if (existsSync(dest) && await hashFile(dest) !== await hashFile(join(bridgeDir, file))) throw new Error(`No se sustituye ${file}: ya existe con otros bytes`)
    }
    if (generated !== DEVELOPER_FEED) copyFileSync(join(dir, generated), join(dir, DEVELOPER_FEED))
    for (const file of BRIDGE_FILES) copyFileSync(join(bridgeDir, file), join(dir, file))
  }
  await verifyMacChannels(dir, version, { manifestPath, keys })
}

export async function bridgeManifest(dir, { keys = publicKeys() } = {}) {
  await verifyMacChannels(dir, BRIDGE_VERSION, { keys })
  const files = []
  for (const name of BRIDGE_FILES) files.push({ name, bytes: regularFile(join(dir, name)).size, sha512: await hashFile(join(dir, name)) })
  return { schema: 1, repository: BRIDGE_REPO, tag: `v${BRIDGE_VERSION}`, version: BRIDGE_VERSION, legacyCertificateSHA1: LEGACY_PIN, developerTeam: DEVELOPER_TEAM, files }
}

/** El manifiesto se fija después de publicar: se comparan los originales descargables, no un borrador ni una compilación. */
export async function confirmPublishedBridge(manifest, fetcher = fetch) {
  const response = await fetcher(`https://api.github.com/repos/${BRIDGE_REPO}/releases/tags/v${BRIDGE_VERSION}`, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`v${BRIDGE_VERSION} todavía no se puede verificar públicamente (${response.status})`)
  const release = await response.json()
  if (release.draft !== false || release.prerelease !== false || release.tag_name !== manifest.tag || !Number.isFinite(Date.parse(release.published_at))) throw new Error('El puente debe estar publicado como versión estable antes de fijar sus hashes')
  // El canal nuevo del puente también debe estar publicado, aunque en las versiones posteriores anuncie otra versión.
  for (const file of [...manifest.files, { ...manifest.files.find((f) => f.name === LEGACY_FEED), name: DEVELOPER_FEED }]) {
    const asset = release.assets?.find((entry) => entry.name === file.name)
    if (!asset || asset.size !== file.bytes) throw new Error(`Falta el original público ${file.name}, o tiene otro tamaño`)
    const download = await fetcher(`https://github.com/${BRIDGE_REPO}/releases/download/${manifest.tag}/${file.name}`, { signal: AbortSignal.timeout(10 * 60_000) })
    if (!download.ok || !download.body) throw new Error(`No se pudo descargar el original público ${file.name}`)
    const hash = createHash('sha512')
    let bytes = 0
    for await (const chunk of download.body) { bytes += chunk.length; if (bytes > file.bytes) throw new Error(`Tamaño público incorrecto: ${file.name}`); hash.update(chunk) }
    if (bytes !== file.bytes || hash.digest('base64') !== file.sha512) throw new Error(`Los bytes públicos de ${file.name} no son los originales verificados`)
  }
  return { ...manifest, publishedAt: release.published_at }
}

async function main() {
  const [command, dirArg, next, ...rest] = process.argv.slice(2)
  if (!dirArg) throw new Error('Uso: release-mac-bridge.mjs prepare <carpeta> <versión> [--bridge-dir <originales>] | manifest <originales> <salida.json> | check-baseline <originales>')
  const dir = resolve(dirArg)
  if (command === 'prepare') {
    if (!next || (rest.length && (rest.length !== 2 || rest[0] !== '--bridge-dir'))) throw new Error('Argumentos de prepare no válidos')
    await prepareMacChannels(dir, next, { bridgeDir: rest[1] && resolve(rest[1]) })
  } else if (command === 'manifest') {
    if (!next || rest.length) throw new Error('manifest necesita una salida nueva, posterior a la publicación')
    const manifest = await confirmPublishedBridge(await bridgeManifest(dir))
    writeFileSync(resolve(next), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  } else if (command === 'check-baseline' && !next) await verifyBridgeFiles(dir)
  else throw new Error('Comando o argumentos no válidos')
  console.log(`✓ ${command}: puente Mac verificado`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`✗ ${error.message}`); process.exitCode = 1 })
