// El aviso de Aula tal como lo enseña la app de iOS en «Licencias»: NOTICE.md (pasado a texto, sin las marcas de
// Markdown, que la app no pinta) y LICENSE.md (la AGPL, ya en texto). Lo usan licenses.mjs, que lo escribe en
// Aula/Licenses.json, y scripts/dev/app-store-check.mjs, que comprueba que sigue al día.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Markdown de NOTICE.md → texto: sin almohadillas de título, negritas, cursivas, código ni enlaces. */
export function markdownToText(md) {
  return md
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 ($2)')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<(https?:\/\/[^>\s]+)>/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,;:)]|$)/gm, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
}

/** El texto del componente «Aula» de Licenses.json. */
export function aulaNotice(root) {
  const read = (f) => readFileSync(join(root, f), 'utf8').replace(/\r\n/g, '\n').trim()
  return `${markdownToText(read('NOTICE.md'))}\n\n${read('LICENSE.md')}`
}
