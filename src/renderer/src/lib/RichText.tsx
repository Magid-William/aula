// Texto con Markdown y fórmulas ($…$ y $$…$$, KaTeX con \ce de química). `inline` lo deja en una línea (sin párrafos).
// Aula no usa emojis: lo que escribe la IA o llega de una plataforma se pinta sin ellos (los símbolos, como texto); lo que
// escribió el propio estudiante (`own`) se deja tal cual.
import { memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/contrib/mhchem'
import type { Element, ElementContent } from 'hast'
import { AULA_KATEX_MACROS } from '@engine/content/tex'
import { tameEmoji } from '@engine/base/emoji'
import { cx } from '@renderer/design'
import { CodeSurface } from './CodeSurface'
import { useContentLang } from './contentLanguage'
import { PAGE_ANCHOR, safeHref } from './richTextLinks'
export { safeHref } from './richTextLinks'

// copiar texto con fórmulas da su LaTeX ($…$ y $$…$$), no el texto doble de KaTeX (HTML + MathML); escucha en el documento,
// así que sin él (las pruebas) no se carga
if (typeof document !== 'undefined') void import('katex/contrib/copy-tex').catch(() => undefined)

// las mismas macros que acepta el validador del contenido (\\SI, \\qty, \\mbox…)
const katexOptions = { throwOnError: false, strict: false, trust: false, output: 'htmlAndMathml' as const, macros: { ...AULA_KATEX_MACROS } }
// la vuelta de una nota al pie: una flecha de texto (la de serie, «↩», se pinta como emoji en iOS)
const remarkRehypeOptions = { footnoteBackContent: '↑' }

function Link({ href, children }: { href?: string; children?: React.ReactNode }) {
  if (!href) return <span className="text-accent-text">{children}</span>
  // una cita de página: sin target, nunca sale de la app (el panel del lector la intercepta y va a esa página)
  if (PAGE_ANCHOR.test(href)) return <a href={href} className="text-accent-text">{children}</a>
  // target=_blank: la ventana de la app nunca navega; el proceso principal lo abre en el navegador del sistema
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-accent-text underline underline-offset-2">
      {children}
    </a>
  )
}

/** El texto de un nodo de Markdown (el código llega como nodos de texto sueltos). */
const textOf = (nodes: ElementContent[]): string =>
  nodes.map((n) => (n.type === 'text' ? n.value : n.type === 'element' ? textOf(n.children) : '')).join('')

const classNames = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(/\s+/) : [])

/** Un bloque ``` de Markdown: la misma superficie que el bloque `code`, en su tamaño de texto corrido. */
function MarkdownCode({ node, streaming }: { node?: Element; streaming: boolean }) {
  const codeEl = node?.children.find((c): c is Element => c.type === 'element' && c.tagName === 'code')
  const language = classNames(codeEl?.properties?.className).find((c) => c.startsWith('language-'))?.slice('language-'.length)
  return <CodeSurface code={codeEl ? textOf(codeEl.children) : ''} language={language} compact streaming={streaming} />
}

/** En la pantalla de estudio el texto va en el idioma del curso (`lang`, y `dir` si se escribe de derecha a izquierda); `ui`
 *  lo deja en el de la interfaz (un aviso de Aula que se pinta con Markdown). `own`: lo escribió el estudiante (sus emojis se
 *  quedan). `streaming`: la respuesta se está escribiendo (el código se resalta cuando termina). */
export const RichText = memo(function RichText({ text, inline, className, ui, own, streaming = false }: { text: string; inline?: boolean; className?: string; ui?: boolean; own?: boolean; streaming?: boolean }) {
  const course = useContentLang()
  const content = ui ? {} : course
  const shown = useMemo(() => (own ? text : tameEmoji(text)), [text, own])
  // Un trozo suelto de un bloque ``` (un cloze partido por un hueco, por ejemplo) no monta tarjeta: se quedaría a medias.
  const fences = useMemo(() => (shown.match(/^```/gm) ?? []).length, [shown])
  const codeBlocks = !inline || (fences > 1 && fences % 2 === 0)
  const components = useMemo(
    () => ({
      a: Link,
      ...(codeBlocks ? { pre: ({ node }: { node?: Element }) => <MarkdownCode node={node} streaming={streaming} /> } : {}),
      ...(inline
        ? {
            p: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
            h1: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
            h2: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
            h3: ({ children }: { children?: React.ReactNode }) => <>{children}</>
          }
        : {})
    }),
    [inline, streaming, codeBlocks]
  )
  if (!text) return null
  return (
    <span lang={content.lang} dir={content.dir} className={cx(inline ? 'aula-rich-inline' : 'aula-rich block', content.className, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, katexOptions]]}
        remarkRehypeOptions={remarkRehypeOptions}
        skipHtml
        urlTransform={safeHref}
        components={components}
      >
        {shown}
      </ReactMarkdown>
    </span>
  )
})
