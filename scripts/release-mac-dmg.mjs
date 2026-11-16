// El DMG Mac desde 0.2.7: electron-builder lo deja sin firmar (dmg.sign: false, porque lo firmaría sin notarizarlo) y
// este paso, justo después de compilar y ANTES de firmar las actualizaciones (release-sign.mjs), lo termina:
//   1. lo firma con la identidad Developer ID fijada por su SHA-1 y el sello de tiempo de Apple;
//   2. lo notariza (notarytool, perfil del llavero) y solo sigue con «Accepted»; si no, enseña el registro de Apple;
//   3. le grapa el ticket y comprueba firma, ticket y Gatekeeper (spctl -t open → Notarized Developer ID);
//   4. rehace su .blockmap como electron-builder y actualiza su entrada (sha512, size) en latest-mac.yml.
// Trabaja sobre una copia: si algo falla, el DMG, su .blockmap y latest-mac.yml se quedan como estaban.
// Nunca toca el puente 0.2.5 (ni ninguna versión anterior a Developer ID) ni un feed ya firmado.
//
//   node scripts/release-mac-dmg.mjs finish release/0.2.7 0.2.7 --identity <SHA-1> --keychain-profile <perfil>
import { spawnSync } from 'node:child_process'
import { constants, copyFileSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { fileURLToPath } from 'node:url'
import { BRIDGE_VERSION, LEGACY_FEED, hashFile, macMode, readMetadata, regularFile, yaml } from './release-common.mjs'
import { verifyMacDmgContainer } from './release-mac-verify.mjs'

const NOTARY_WAIT = '2h'
const STAPLE_ATTEMPTS = 3
const STAPLE_RETRY_MS = 30_000

export function run(file, args) {
  // notarytool espera a Apple (hasta NOTARY_WAIT); lo demás son segundos
  const timeout = args[0] === 'notarytool' && args[1] === 'submit' ? 3 * 3600_000 : 600_000
  const result = spawnSync(file, args, { encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C', LANG: 'C' } })
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
  if (result.error || result.status !== 0) {
    throw Object.assign(new Error(`${file} ${args[0]}: falló (${result.error?.message ?? result.status})\n${output}`), { output })
  }
  return output
}

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** El mismo .blockmap que hace electron-builder para el DMG: el app-builder-lib que trae, gzip y en un archivo aparte. */
export async function buildBlockMap(file, output) {
  const fromBuilder = createRequire(createRequire(import.meta.url).resolve('electron-builder/package.json'))
  return fromBuilder('app-builder-lib/out/targets/blockmap/blockmap.js').buildBlockMap(file, 'gzip', output)
}

/** La última línea JSON de notarytool con un estado ({ id, status, message }). */
function notaryResult(output) {
  for (const line of String(output).split('\n').reverse()) {
    if (!line.trim().startsWith('{')) continue
    try {
      const value = JSON.parse(line)
      if (typeof value?.status === 'string') return value
    } catch { /* no es la respuesta */ }
  }
  return null
}

function notarize(dmg, profile, execute) {
  let output, failure = null
  try {
    output = execute('/usr/bin/xcrun', ['notarytool', 'submit', dmg, '--keychain-profile', profile, '--wait', '--timeout', NOTARY_WAIT, '--output-format', 'json'])
  } catch (error) {
    output = error.output ?? ''
    failure = error
  }
  const result = notaryResult(output)
  if (result?.status === 'Accepted' && !failure) return result.id
  // con el número de envío, el registro de Apple dice qué rechazó
  let log = ''
  if (typeof result?.id === 'string' && /^[0-9a-f-]{36}$/i.test(result.id)) {
    try {
      log = execute('/usr/bin/xcrun', ['notarytool', 'log', result.id, '--keychain-profile', profile])
    } catch (error) {
      log = `(no se pudo leer el registro: ${error.message})`
    }
  }
  if (log) console.error(log)
  const what = result ? `${result.status}${result.id ? `, envío ${result.id}` : ''}${result.message ? `: ${result.message}` : ''}` : 'sin respuesta'
  throw new Error(`Apple no notarizó el DMG (notarytool: ${what})${failure && !log ? `\n${failure.message}` : ''}`)
}

function staple(dmg, execute, sleep) {
  for (let attempt = 1; ; attempt++) {
    try {
      return execute('/usr/bin/xcrun', ['stapler', 'staple', dmg])
    } catch (error) {
      if (attempt >= STAPLE_ATTEMPTS) throw error
      // recién aceptado, el ticket puede tardar un poco en poder descargarse
      console.warn(`! stapler staple falló (intento ${attempt} de ${STAPLE_ATTEMPTS}): se reintenta en ${STAPLE_RETRY_MS / 1000} s`)
      sleep(STAPLE_RETRY_MS)
    }
  }
}

/**
 * latest-mac.yml con la entrada `url` cambiada a `fields` (y el sha512 de arriba si `path` es ese archivo). Cambia solo
 * esas líneas: el resto, byte a byte. Si el formato no lo permite, lo vuelve a escribir entero (como release-sign).
 */
export function updateFeedEntry(text, url, fields) {
  const expected = yaml.load(text)
  const entry = expected.files.find((file) => file?.url === url)
  if (!entry) throw new Error(`${LEGACY_FEED} no anuncia ${url}`)
  for (const key of ['sha512', 'size', 'blockMapSize']) {
    if (Object.hasOwn(entry, key) && !Object.hasOwn(fields, key)) throw new Error(`${LEGACY_FEED}: ${url} lleva ${key} y el .blockmap nuevo no lo da`)
  }
  Object.assign(entry, fields)
  if (expected.path === url) expected.sha512 = fields.sha512
  const scalar = (value) => yaml.dump(value, { lineWidth: -1 }).trimEnd()
  const lines = text.split('\n')
  const start = lines.findIndex((line) => {
    const m = /^ *- url: (.+)$/.exec(line)
    try { return m && yaml.load(m[1]) === url } catch { return false }
  })
  if (start >= 0) {
    const pad = ' '.repeat(lines[start].indexOf('-') + 2)
    // las claves de esa entrada, hasta la siguiente entrada o la siguiente clave de arriba
    for (let i = start + 1; i < lines.length && lines[i].startsWith(pad); i++) {
      const key = /^(\w+):/.exec(lines[i].slice(pad.length))?.[1]
      if (key && Object.hasOwn(fields, key)) lines[i] = `${pad}${key}: ${scalar(fields[key])}`
    }
    if (expected.path === url) {
      const top = lines.findIndex((line) => line.startsWith('sha512: '))
      if (top >= 0) lines[top] = `sha512: ${scalar(fields.sha512)}`
    }
    const edited = lines.join('\n')
    if (isDeepStrictEqual(yaml.load(edited), expected)) return edited
  }
  return yaml.dump(expected, { lineWidth: -1, noRefs: true })
}

export async function finishMacDmg(dir, version, { identity, profile, execute = run, sleep = pause, blockMap = buildBlockMap } = {}) {
  if (macMode(version) !== 'developer-id') throw new Error(`Solo se firma el DMG de una versión Developer ID (posterior a ${BRIDGE_VERSION}): el puente ${BRIDGE_VERSION} y los anteriores no se tocan`)
  if (typeof identity !== 'string' || !/^[0-9A-F]{40}$/.test(identity)) throw new Error('--identity tiene que ser el SHA-1 (40 cifras hexadecimales) de la identidad Developer ID')
  if (typeof profile !== 'string' || !profile.trim()) throw new Error('Falta --keychain-profile, el perfil de notarytool')
  const name = `Aula-${version}-mac.dmg`, dmg = join(dir, name), feed = join(dir, LEGACY_FEED)
  const info = readMetadata(dir, LEGACY_FEED)
  const text = readFileSync(feed, 'utf8')
  if (info.version !== version) throw new Error(`${LEGACY_FEED} es de la ${info.version}, no de la ${version}: el DMG se termina justo después de compilar, antes de preparar los canales`)
  if (info.aulaNotesSignature !== undefined || info.files.some((file) => file?.aulaSignature !== undefined)) throw new Error(`${LEGACY_FEED} ya está firmado: el DMG se termina antes de firmar las actualizaciones`)
  const entries = info.files.filter((file) => file?.url === name)
  if (entries.length !== 1) throw new Error(`${LEGACY_FEED} tiene que anunciar ${name} una vez`)
  const stat = regularFile(dmg)
  if (entries[0].sha512 !== await hashFile(dmg) || (entries[0].size !== undefined && entries[0].size !== stat.size)) {
    throw new Error(`${name} no es el que anuncia ${LEGACY_FEED} (¿ya se firmó?): vuelve a compilar Mac (--only mac)`)
  }
  // la copia, en el mismo disco (rename) y con un nombre que la recompilación de Mac borra (release/<v>/mac*)
  const work = mkdtempSync(join(dir, 'mac-dmg-'))
  try {
    const copy = join(work, name), map = `${copy}.blockmap`
    copyFileSync(dmg, copy, constants.COPYFILE_FICLONE)
    execute('/usr/bin/codesign', ['--sign', identity, '--timestamp', copy])
    console.log(`· ${name} firmado; notarizándolo (Apple suele tardar unos minutos)…`)
    notarize(copy, profile, execute)
    staple(copy, execute, sleep)
    verifyMacDmgContainer(copy, { execute })
    const update = await blockMap(copy, map)
    const signed = { sha512: await hashFile(copy), size: regularFile(copy).size }
    if (update?.sha512 !== signed.sha512 || update?.size !== signed.size) throw new Error('El .blockmap nuevo no corresponde al DMG firmado')
    regularFile(map)
    const fields = { sha512: signed.sha512, size: signed.size, ...(update.blockMapSize !== undefined && { blockMapSize: update.blockMapSize }) }
    writeFileSync(join(work, LEGACY_FEED), updateFeedEntry(text, name, fields))
    // todo comprobado: el .blockmap, el DMG y, el último, el feed que los anuncia
    renameSync(map, `${dmg}.blockmap`)
    renameSync(copy, dmg)
    renameSync(join(work, LEGACY_FEED), feed)
    return fields
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

async function main() {
  const [command, dirArg, version, ...rest] = process.argv.slice(2)
  const option = (flag) => (rest.indexOf(flag) % 2 === 0 ? rest[rest.indexOf(flag) + 1] : undefined)
  const identity = option('--identity'), profile = option('--keychain-profile')
  if (command !== 'finish' || !dirArg || !version || rest.length !== 4 || !identity || !profile) {
    throw new Error('Uso: release-mac-dmg.mjs finish <carpeta-release> <versión> --identity <SHA-1> --keychain-profile <perfil>')
  }
  if (process.env.AULA_MAC_ADHOC === '1') throw new Error('AULA_MAC_ADHOC=1 es una compilación de prueba: su DMG no se firma ni se notariza')
  if (process.platform !== 'darwin') throw new Error('El DMG solo se puede firmar y notarizar en un Mac')
  const { size } = await finishMacDmg(resolve(dirArg), version, { identity, profile })
  console.log(`✓ Aula-${version}-mac.dmg: firmado con Developer ID, notarizado y grapado; .blockmap y ${LEGACY_FEED} al día (${size} bytes)`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`✗ ${error.message}`); process.exitCode = 1 })
