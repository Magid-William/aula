import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import type { AnswerOf } from '@shared/schema/exercises'
import '@renderer/i18n'
import { initialDraft } from '../model'

// El tooltip abre un portal en `document` (no hay DOM en esta prueba): se deja el botón tal cual.
vi.mock('@renderer/design', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@renderer/design')>()
  return { ...mod, Tooltip: ({ children }: { children: ReactNode }) => children }
})

import { TextAnswerInput } from './TextAnswerInput'

const CTX = { packId: null, language: 'en', assetUrl: (p: string) => p, mode: 'lesson' as const }

const SHORT: AnswerOf<'short'> = { kind: 'short', accepted: ['osmosis'], keywords: [], typoTolerance: true, aiGrade: false }
const NUMERIC: AnswerOf<'numeric'> = {
  kind: 'numeric', value: '2', alternatives: [], absTol: 1e-6, relTol: 1e-6, form: 'any', unitMode: 'ignore', angle: 'radians'
}

function render(answer: AnswerOf<'short'> | AnswerOf<'numeric'>): string {
  return renderToStaticMarkup(
    <TextAnswerInput
      answer={answer}
      draft={initialDraft({ id: 'x1', answer })}
      set={() => undefined}
      locked={false}
      reveal="none"
      exerciseId="x1"
      lang="en"
      ctx={CTX}
      onSubmit={() => undefined}
      autoFocus={false}
      active={false}
      exam={false}
    />
  )
}

describe('respuesta escrita de varias líneas', () => {
  it('la respuesta corta es un campo de texto que crece (textarea), no un input de una línea', () => {
    const html = render(SHORT)
    expect(html).toContain('<textarea')
    expect(html).not.toContain('<input')
    expect(html).toContain('rows="1"')
    // Intro salta de línea; la comprobación es ⌘/Ctrl+Intro
    expect(html).toContain('enterKeyHint="enter"')
    expect(html).toContain('data-answer-field')
  })

  it('las respuestas numéricas también admiten varias líneas', () => {
    const html = render(NUMERIC)
    expect(html).toContain('<textarea')
    expect(html).toContain('enterKeyHint="enter"')
  })
})
