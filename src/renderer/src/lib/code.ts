// Resaltado de código con highlight.js: los lenguajes que entiende Aula, sus alias y el HTML ya resaltado.
// Puro (sin React ni DOM): lo usan el bloque `code`, el código escrito en Markdown y sus pruebas.
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import clojure from 'highlight.js/lib/languages/clojure'
import cmake from 'highlight.js/lib/languages/cmake'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import dart from 'highlight.js/lib/languages/dart'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import elixir from 'highlight.js/lib/languages/elixir'
import erlang from 'highlight.js/lib/languages/erlang'
import fortran from 'highlight.js/lib/languages/fortran'
import go from 'highlight.js/lib/languages/go'
import gradle from 'highlight.js/lib/languages/gradle'
import graphql from 'highlight.js/lib/languages/graphql'
import groovy from 'highlight.js/lib/languages/groovy'
import haskell from 'highlight.js/lib/languages/haskell'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import julia from 'highlight.js/lib/languages/julia'
import kotlin from 'highlight.js/lib/languages/kotlin'
import latex from 'highlight.js/lib/languages/latex'
import less from 'highlight.js/lib/languages/less'
import lua from 'highlight.js/lib/languages/lua'
import makefile from 'highlight.js/lib/languages/makefile'
import markdown from 'highlight.js/lib/languages/markdown'
import matlab from 'highlight.js/lib/languages/matlab'
import nginx from 'highlight.js/lib/languages/nginx'
import objectivec from 'highlight.js/lib/languages/objectivec'
import perl from 'highlight.js/lib/languages/perl'
import php from 'highlight.js/lib/languages/php'
import plaintext from 'highlight.js/lib/languages/plaintext'
import powershell from 'highlight.js/lib/languages/powershell'
import protobuf from 'highlight.js/lib/languages/protobuf'
import python from 'highlight.js/lib/languages/python'
import r from 'highlight.js/lib/languages/r'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scala from 'highlight.js/lib/languages/scala'
import scss from 'highlight.js/lib/languages/scss'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import vbnet from 'highlight.js/lib/languages/vbnet'
import verilog from 'highlight.js/lib/languages/verilog'
import vhdl from 'highlight.js/lib/languages/vhdl'
import x86asm from 'highlight.js/lib/languages/x86asm'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

/** Gramáticas registradas: se importan de una en una para que el paquete no traiga las ~190 de highlight.js. */
const LANGUAGES = {
  bash, c, clojure, cmake, cpp, csharp, css, dart, diff, dockerfile, elixir, erlang, fortran, go, gradle, graphql, groovy, haskell,
  ini, java, javascript, json, julia, kotlin, latex, less, lua, makefile, markdown, matlab, nginx, objectivec, perl, php, plaintext,
  powershell, protobuf, python, r, ruby, rust, scala, scss, sql, swift, typescript, vbnet, verilog, vhdl, x86asm, xml, yaml
}
for (const [name, def] of Object.entries(LANGUAGES)) if (!hljs.getLanguage(name)) hljs.registerLanguage(name, def)

/** Nombres de lenguaje que acepta Aula, para la documentación del agente y el catálogo de bloques. */
export const CODE_LANGUAGE_NAMES = Object.keys(LANGUAGES).sort((a, b) => a.localeCompare(b))

/** Lo que un curso escribe de verdad: `language` acepta el nombre de highlight.js o cualquiera de sus alias. */
const ALIASES: Record<string, string> = {
  py: 'python', python3: 'python', py3: 'python',
  js: 'javascript', node: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', typescriptreact: 'typescript',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', terminal: 'bash', shellscript: 'bash',
  'c++': 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hxx: 'cpp',
  'c#': 'csharp', cs: 'csharp', dotnet: 'csharp',
  html: 'xml', htm: 'xml', svg: 'xml', vue: 'xml',
  tex: 'latex', md: 'markdown', mdx: 'markdown',
  yml: 'yaml', octave: 'matlab', rb: 'ruby', rs: 'rust', kt: 'kotlin', kts: 'kotlin',
  text: 'plaintext', txt: 'plaintext', pseudocode: 'plaintext', 'pseudocódigo': 'plaintext', pseudocodigo: 'plaintext', plain: 'plaintext',
  golang: 'go', ps1: 'powershell', pwsh: 'powershell',
  objc: 'objectivec', 'obj-c': 'objectivec', asm: 'x86asm', nasm: 'x86asm',
  docker: 'dockerfile', toml: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini', patch: 'diff', make: 'makefile',
  gql: 'graphql', sass: 'scss', proto: 'protobuf', 'visual basic': 'vbnet'
}

/** Nombre del lenguaje que entiende highlight.js («py» → python, «html» → xml, «c++» → cpp…); undefined si no se conoce. */
export function codeLanguage(raw: string | undefined): string | undefined {
  const s = (raw ?? '').trim().toLowerCase()
  if (!s) return undefined
  const name = ALIASES[s] ?? s
  return hljs.getLanguage(name) ? name : undefined
}

/** Cómo se llama el lenguaje en la cabecera del bloque. */
const LABELS: Record<string, string> = {
  cpp: 'C++', csharp: 'C#', javascript: 'JavaScript', typescript: 'TypeScript', xml: 'HTML', latex: 'LaTeX', matlab: 'MATLAB',
  sql: 'SQL', php: 'PHP', json: 'JSON', yaml: 'YAML', css: 'CSS', scss: 'SCSS', plaintext: '', objectivec: 'Objective-C',
  x86asm: 'Assembly', dockerfile: 'Dockerfile', makefile: 'Makefile', graphql: 'GraphQL', protobuf: 'Protobuf', vbnet: 'VB.NET',
  nginx: 'nginx', cmake: 'CMake', gradle: 'Gradle', ini: 'INI/TOML', julia: 'Julia', fortran: 'Fortran', haskell: 'Haskell',
  powershell: 'PowerShell', clojure: 'Clojure', elixir: 'Elixir', erlang: 'Erlang', groovy: 'Groovy', kotlin: 'Kotlin',
  lua: 'Lua', perl: 'Perl', r: 'R', ruby: 'Ruby', rust: 'Rust', scala: 'Scala', swift: 'Swift', go: 'Go', java: 'Java',
  python: 'Python', bash: 'Bash', diff: 'Diff', less: 'Less', dart: 'Dart', verilog: 'Verilog', vhdl: 'VHDL'
}

export const languageLabel = (lang: string | undefined, raw?: string): string =>
  lang ? (LABELS[lang] ?? lang.charAt(0).toUpperCase() + lang.slice(1)) : (raw ?? '').trim()

/** Los lenguajes entre los que se adivina cuando el bloque no dice cuál es. */
const AUTO_LANGUAGES = ['python', 'javascript', 'typescript', 'java', 'cpp', 'c', 'sql', 'bash', 'r', 'matlab', 'json', 'yaml', 'xml', 'css', 'go', 'rust']

/** HTML seguro: highlight.js envuelve el código en <span> pero el texto se escapa aquí (también sin lenguaje). */
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)

export interface Highlighted {
  /** HTML ya escapado, con los <span class="hljs-…"> del resaltado. */
  html: string
  /** Lenguaje con el que se ha resaltado (el pedido o el adivinado). */
  lang?: string
  /** Nombre que se enseña en la cabecera. */
  label: string
}

/**
 * Resalta `code`. `plain` lo deja sin colores (mientras el texto llega en vivo: resaltar en cada carácter es tirar trabajo);
 * sin lenguaje conocido se adivina entre los de clase y, si no hay confianza, se deja tal cual.
 */
export function highlightCode(code: string, raw?: string, plain = false): Highlighted {
  const lang = codeLanguage(raw)
  const label = languageLabel(lang, raw)
  try {
    if (plain) return { html: escapeHtml(code), label }
    if (lang) return { html: hljs.highlight(code, { language: lang, ignoreIllegals: true }).value, lang, label }
    if (code.length > 20_000) return { html: escapeHtml(code), label }
    const auto = hljs.highlightAuto(code, AUTO_LANGUAGES)
    // un listado corto (dos líneas) da poca relevancia: con 2 ya se acepta, porque el texto ya viene dentro de un bloque de código
    return auto.relevance >= 2 ? { html: auto.value, lang: auto.language, label: languageLabel(auto.language, raw) } : { html: escapeHtml(code), label }
  } catch {
    return { html: escapeHtml(code), label }
  }
}
