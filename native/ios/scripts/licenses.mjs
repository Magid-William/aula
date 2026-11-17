// Escribe native/ios/Aula/Licenses.json: los avisos de licencia que la app de iOS enseña en «Licencias».
// Van Aula (AGPL, de LICENSE.md y NOTICE.md, este pasado a texto) y lo que TailscaleKit mete en el binario: libtailscale, la biblioteca
// estándar de Go y cada módulo de Go que se enlaza para iOS (lo que dice `go list -deps`, no todo el go.mod), cada uno
// con el texto entero de sus LICENSE/NOTICE/PATENTS. Lo llama build-tailscalekit.sh; a mano:
//   node native/ios/scripts/licenses.mjs
// Con --android <salida.json>, lo mismo para la app de Android (lo llama native/android/build.sh): Aula y lo que lleva
// libaulatsnet.so, el componente de Tailscale de native/tsnet/client compilado para Linux (arm64), sin CGO.
// Usa el Go de <raíz>/.toolchain (o el de AULA_TOOLCHAIN, o el del PATH) y libtailscale en el commit fijado en
// build-tailscalekit.sh. Sale igual cada vez (sin fechas), así que un cambio en git es un cambio de verdad.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { aulaNotice } from './aula-notice.mjs'

const IOS = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = resolve(IOS, '../..')
const TC = process.env.AULA_TOOLCHAIN || join(ROOT, '.toolchain')
const SRC = join(TC, 'src/libtailscale')
const ANDROID = process.argv[2] === '--android'
if (ANDROID && !process.argv[3]) {
  console.error('uso: node native/ios/scripts/licenses.mjs --android <salida.json>')
  process.exit(2)
}
const OUT = ANDROID ? resolve(process.argv[3]) : join(IOS, 'Aula/Licenses.json')

/** Archivos con el texto de una licencia (no el código Go que se llame así). */
const LICENSE_FILE = /^(licen[cs]e|copying|notice|patents)([._-].*)?$/i
/** Primero la licencia, luego los avisos y al final la concesión de patentes. */
const rank = (name) => (/^(licen|copying)/i.test(name) ? 0 : /^notice/i.test(name) ? 1 : 2)

function fail(message) {
  console.error(`error: ${message}`)
  process.exit(1)
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts }).trim()
}

/** El entorno de Go: el del proyecto si está (sin red: los módulos ya están en .toolchain), si no el del PATH. */
function goEnv() {
  // Android: el binario estático de Linux que la app lanza (native/tsnet/build.sh android)
  const target = ANDROID ? { GOOS: 'linux', GOARCH: 'arm64', CGO_ENABLED: '0' } : { GOOS: 'ios', GOARCH: 'arm64', CGO_ENABLED: '1' }
  const env = { ...process.env, ...target, GOFLAGS: `${process.env.GOFLAGS ?? ''} -mod=readonly`.trim() }
  if (existsSync(join(TC, 'go/bin/go'))) {
    Object.assign(env, {
      PATH: `${join(TC, 'go/bin')}:${process.env.PATH}`,
      GOPATH: join(TC, 'gopath'),
      GOCACHE: join(TC, 'gocache'),
      GOMODCACHE: join(TC, 'gopath/pkg/mod'),
      GOTOOLCHAIN: 'local',
      GOPROXY: process.env.GOPROXY ?? 'off'
    })
  }
  return env
}

/** Qué licencias hay en un texto, en el orden en que salen (un archivo puede juntar varias, como el de klauspost). */
function kindsOf(text) {
  const found = []
  const add = (at, kind) => found.push({ at, kind })
  for (const m of text.matchAll(/GNU AFFERO GENERAL PUBLIC LICENSE/g)) add(m.index, 'AGPL-3.0')
  for (const m of text.matchAll(/Apache License\s*,?\s*Version 2\.0/gi)) add(m.index, 'Apache-2.0')
  for (const m of text.matchAll(/Mozilla Public License,?\s*(Version|v\.?)\s*2\.0/gi)) add(m.index, 'MPL-2.0')
  for (const m of text.matchAll(/Permission to use, copy, modify, and(\/or)? distribute this software/g)) add(m.index, 'ISC')
  for (const m of text.matchAll(/Permission is hereby granted, free of charge/g)) add(m.index, 'MIT')
  for (const m of text.matchAll(/Redistribution and use in source and binary forms/g)) {
    // la cláusula 3 (no usar los nombres de los autores para promocionar) va antes del «AS IS», si la hay
    const end = text.indexOf('IS PROVIDED', m.index)
    const clauses = text.slice(m.index, end < 0 ? m.index + 1500 : end)
    add(m.index, /endorse or promote/i.test(clauses) ? 'BSD-3-Clause' : 'BSD-2-Clause')
  }
  return [...new Set(found.sort((a, b) => a.at - b.at).map((f) => f.kind))]
}

/** Los archivos de licencia de una carpeta, en orden. */
function licenseFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && LICENSE_FILE.test(e.name) && !e.name.endsWith('.go'))
    .map((e) => e.name)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((name) => join(dir, name))
}

/** Un componente: su texto es el de sus archivos, cada uno con su ruta delante si hay más de uno. */
function component(id, name, version, files, base) {
  const parts = files.map((file) => ({ file: relative(base, file), text: readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trim() }))
  if (!parts.length) fail(`${name} no trae ningún archivo de licencia (${base})`)
  const text = parts.length === 1 ? parts[0].text : parts.map((p) => `--- ${p.file} ---\n\n${p.text}`).join('\n\n')
  const kinds = kindsOf(text)
  if (!kinds.length) fail(`no reconozco la licencia de ${name} (${parts.map((p) => p.file).join(', ')})`)
  return { id, name, ...(version ? { version } : {}), license: kinds.join(', '), text }
}

const env = goEnv()
const goVersion = run('go', ['env', 'GOVERSION'], { env })
const goroot = run('go', ['env', 'GOROOT'], { env })
const format = '{{with .Module}}{{.Path}}\t{{.Version}}\t{{.Dir}}{{with .Replace}}\t{{.Version}}\t{{.Dir}}{{end}}{{end}}|{{.Dir}}'

let ref = ''
let listed
if (ANDROID) {
  // lo que se enlaza de verdad en libaulatsnet.so
  listed = run('go', ['list', '-deps', '-f', format, './client'], { cwd: join(ROOT, 'native/tsnet'), env })
} else {
  // el commit de libtailscale que se compila (el fijado en build-tailscalekit.sh, o el que se le pase)
  const pinned = readFileSync(join(IOS, 'build-tailscalekit.sh'), 'utf8').match(/LIBTAILSCALE_REF="\$\{LIBTAILSCALE_REF:-([0-9a-f]{40})\}"/)?.[1]
  if (!pinned) fail('no encuentro LIBTAILSCALE_REF en build-tailscalekit.sh')
  const wanted = process.env.LIBTAILSCALE_REF || pinned
  if (!existsSync(join(SRC, '.git'))) fail(`falta libtailscale en ${SRC}: native/ios/build-tailscalekit.sh lo descarga`)
  const head = run('git', ['-C', SRC, 'rev-parse', 'HEAD'])
  ref = run('git', ['-C', SRC, 'rev-parse', `${wanted}^{commit}`])
  if (head !== ref) fail(`libtailscale está en ${head.slice(0, 12)} y build-tailscalekit.sh compila ${ref.slice(0, 12)}: ejecuta antes native/ios/build-tailscalekit.sh`)
  // lo que se enlaza de verdad, con aula_nologs.go dentro como en la compilación (por -overlay: libtailscale no se toca)
  const tmp = mkdtempSync(join(tmpdir(), 'aula-licenses-'))
  try {
    const overlay = join(tmp, 'overlay.json')
    writeFileSync(overlay, JSON.stringify({ Replace: { [join(SRC, 'aula_nologs.go')]: join(IOS, 'tailscalekit/aula_nologs.go') } }))
    listed = run('go', ['list', '-tags', 'ios', '-overlay', overlay, '-deps', '-f', format, '.'], { cwd: SRC, env })
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** Módulo → su versión, su carpeta y las carpetas de sus paquetes enlazados. */
const modules = new Map()
for (const line of listed.split('\n')) {
  const [mod, pkgDir] = line.split('|')
  if (!mod) continue // la biblioteca estándar: va aparte
  const [path, version, dir, replVersion, replDir] = mod.split('\t')
  const m = modules.get(path) ?? { path, version: replVersion || version, dir: replDir || dir, pkgDirs: new Set() }
  m.pkgDirs.add(pkgDir)
  modules.set(path, m)
}

/** Los archivos de licencia del módulo: los de su raíz y los de los paquetes enlazados que traen el suyo propio. */
function moduleFiles(m) {
  const sub = [...m.pkgDirs].filter((d) => d !== m.dir).sort().flatMap(licenseFiles)
  return [...licenseFiles(m.dir), ...sub]
}

// el código de la propia app (libtailscale en iOS; en Android, native/tsnet, que es de Aula y va con su aviso)
const MAIN = ANDROID ? 'aula/tsnet' : 'github.com/tailscale/libtailscale'
const FIRST = ['tailscale.com', 'github.com/tailscale/wireguard-go']
const main = modules.get(MAIN)
if (!main) fail(`go list no devolvió ${MAIN}`)
modules.delete(MAIN)

const ofModule = (m) => component(m.path, m.path, m.version, moduleFiles(m), m.dir)
// primero Aula, luego lo de Tailscale y Go (la biblioteca estándar y el runtime), y el resto por orden alfabético
const components = [
  {
    id: 'aula',
    name: 'Aula',
    license: 'AGPL-3.0-only',
    text: aulaNotice(ROOT)
  },
  ...(ANDROID ? [] : [component(MAIN, 'TailscaleKit (libtailscale)', ref.slice(0, 12), moduleFiles(main), main.dir)]),
  ...FIRST.filter((p) => modules.has(p)).map((p) => ofModule(modules.get(p))),
  component('go', 'Go', goVersion, licenseFiles(goroot), goroot),
  ...[...modules.values()].filter((m) => !FIRST.includes(m.path)).sort((a, b) => a.path.localeCompare(b.path)).map(ofModule)
]

const catalog = ANDROID
  ? { about: 'Generated by native/ios/scripts/licenses.mjs --android (run by native/android/build.sh). Do not edit.', go: goVersion, components }
  : { about: 'Generated by native/ios/scripts/licenses.mjs (run by native/ios/build-tailscalekit.sh). Do not edit.', libtailscale: ref, go: goVersion, components }
const json = `${JSON.stringify(catalog, null, 2)}\n`
const before = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
writeFileSync(OUT, json)
console.log(`${relative(ROOT, OUT)}: ${components.length} componentes${before === json ? ' (sin cambios)' : ''}`)
for (const c of components) console.log(`  ${c.name}${c.version ? ` ${c.version}` : ''}: ${c.license}`)
