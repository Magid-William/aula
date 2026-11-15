// Comprueba los feeds, bytes y firmas antes de subir. Mac conserva el puente en latest-mac desde 0.2.6.
// node scripts/release-verify.mjs release/0.2.5 [0.2.5]
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEVELOPER_FEED, LEGACY_FEED, macMode, metadataFiles, verifyMetadata } from './release-common.mjs'
import { verifyMacChannels } from './release-mac-bridge.mjs'

async function main() {
  const dir = resolve(process.argv[2] || 'release')
  const version = process.argv[3] || JSON.parse(readFileSync('package.json', 'utf8')).version
  const feeds = metadataFiles(dir)
  if (!feeds.length) throw new Error(`No hay feeds de actualización en ${dir}`)
  if (feeds.includes(LEGACY_FEED) || feeds.includes(DEVELOPER_FEED)) {
    await verifyMacChannels(dir, version)
    console.log(`✓ macOS: canales y originales verificados para ${version}`)
  }
  for (const feed of feeds.filter((name) => name !== LEGACY_FEED && name !== DEVELOPER_FEED)) {
    await verifyMetadata(dir, feed, { version })
    console.log(`✓ ${feed}: archivos, hashes y firmas válidos`)
  }
  const expected = [LEGACY_FEED, ...(macMode(version) === 'legacy' ? [] : [DEVELOPER_FEED]), 'latest.yml', 'latest-linux.yml', 'latest-linux-arm64.yml']
  for (const feed of expected) if (!feeds.includes(feed)) console.warn(`! Falta ${feed}: esa plataforma o canal no verá la actualización`)
  console.log(`\nTodo en orden para la ${version}.`)
}

main().catch((error) => { console.error(`✗ ${error.message}\nNo subas esta carpeta.`); process.exitCode = 1 })
