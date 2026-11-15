// Busca versión EXACTAMENTE como las copias instaladas (el GitHubProvider real de electron-updater, sin sesión, contra
// github.com) para cada sistema, y comprueba la firma de Aula de cada archivo anunciado (con las claves de
// src/main/services/updates/signature.ts). Para después de hacer público el repositorio o de publicar una versión
// (A1-P2-23: pedir /releases/latest/download/<yml> no es lo que hacen las copias).
//
//   node scripts/dev/check-public-feed.mjs luumlabs/aula 0.1.0
//
// Sale con 1 si algún sistema no ve esa versión o le falta la firma. Repositorio privado → 404 en todos.
import { createRequire } from 'node:module'
import { createHash, createPublicKey, verify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BRIDGE_VERSION, macMode } from '../release-common.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const [repo, expected] = process.argv.slice(2)
if (!repo || !repo.includes('/')) {
  console.error('Uso: node scripts/dev/check-public-feed.mjs <dueño/repositorio> [versión esperada]')
  process.exit(2)
}
const require = createRequire(join(root, 'package.json'))
const { GitHubProvider } = require('electron-updater/out/providers/GitHubProvider')
const { NodeHttpExecutor } = require('builder-util/out/nodeHttpExecutor')
const semver = require('semver')

const src = readFileSync(join(root, 'src/main/services/updates/signature.ts'), 'utf8')
const block = /export const UPDATE_PUBLIC_KEYS[^=]*=\s*\[([^\]]*)\]/.exec(src)
const keys = [...(block?.[1] ?? '').matchAll(/'([A-Za-z0-9+/=]+)'/g)].map((m) => createPublicKey({ key: Buffer.from(m[1], 'base64'), format: 'der', type: 'spki' }))
if (!keys.length) throw new Error('No encuentro UPDATE_PUBLIC_KEYS en signature.ts')
const valid = (msg, sig) => typeof sig === 'string' && keys.some((k) => { try { return verify(null, msg, k, Buffer.from(sig, 'base64')) } catch { return false } })

const [owner, name] = repo.split('/')
let bad = 0
// Sin versión explícita, se valida el contrato vigente del repositorio local.
const target = expected || JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const bridge = macMode(target) !== 'legacy'
const targets = [
  ...['arm64', 'x64'].flatMap(arch => [
    ['darwin', arch, null, bridge ? BRIDGE_VERSION : target],
    ...(bridge ? [['darwin', arch, 'developer-id', target]] : [])
  ]),
  ['win32', 'x64', null, target], ['linux', 'x64', null, target], ['linux', 'arm64', null, target]
]
for (const [platform, arch, channel, wanted] of targets) {
  process.env.TEST_UPDATER_ARCH = arch
  const updater = { allowPrerelease: false, channel, currentVersion: semver.parse('0.0.1'), fullChangelog: false }
  const p = new GitHubProvider({ provider: 'github', owner, repo: name }, updater, { isUseMultipleRangeRequest: false, platform, executor: new NodeHttpExecutor() })
  try {
    const info = await p.getLatestVersion()
    const files = p.resolveFiles(info)
    const sigs = info.files.map((f) => valid(Buffer.from(`aula-update-v1\n${f.url}\n${info.version}\n${f.sha512}`), f.aulaSignature))
    const notes = typeof info.releaseNotes === 'string'
      ? valid(Buffer.from(`aula-notes-v1\n${info.version}\n${createHash('sha512').update(info.releaseNotes, 'utf8').digest('base64')}`), info.aulaNotesSignature)
        ? 'firmadas'
        : 'sin firma (la app 0.1.1+ no las enseña)'
      : 'ninguna'
    const ok = info.version === wanted && sigs.length > 0 && sigs.every(Boolean) && notes === 'firmadas'
    if (!ok) bad++
    console.log(`${ok ? '✓' : '✗'} ${platform}/${arch}/${channel || 'latest'}: ${info.tag} v${info.version} → ${files.map((f) => f.url.pathname.split('/').pop()).join(', ')} · firma de Aula: ${sigs.map((s) => (s ? 'ok' : 'NO')).join(',')} · notas: ${notes}`)
  } catch (e) {
    bad++
    console.log(`✗ ${platform}/${arch}/${channel || 'latest'}: ${e.code || ''} ${String(e.message).split('\n')[0].slice(0, 160)}`)
  }
}
process.exit(bad ? 1 : 0)
