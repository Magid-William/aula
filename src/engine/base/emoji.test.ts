import { describe, expect, it } from 'vitest'
import { findEmoji, tameEmoji } from './emoji'

describe('emojis en el texto del estudiante', () => {
  it('encuentra emojis de verdad y símbolos que se pintan como emoji', () => {
    expect(findEmoji('Bien hecho 🎉')).toBe('🎉')
    expect(findEmoji('Comprobar ↩')).toBe('↩')
    expect(findEmoji('pulsa ▶️')).toBe('▶️')
    expect(findEmoji('👩‍🔬 laboratorio')).toBe('👩‍🔬')
    expect(findEmoji('1️⃣ primero')).toBe('1️⃣')
  })

  it('deja pasar el texto normal, flechas de texto y símbolos ya forzados a texto', () => {
    for (const s of ['x → y', '© 2026 Aula', 'H₂O ⇌ H⁺ + OH⁻', '✓ hecho', 'α + β = γ', '¿Qué? ¡Sí!', 'A ↔︎ B', 'ñandú 3 × 4']) expect(findEmoji(s), s).toBeNull()
  })

  it('quita los emojis con su espacio y deja los símbolos como texto', () => {
    expect(tameEmoji('🚀 Empieza aquí')).toBe('Empieza aquí')
    expect(tameEmoji('Muy bien 👏 sigue')).toBe('Muy bien sigue')
    expect(tameEmoji('- ✅ Hecho\n- ❌ Falta')).toBe('- Hecho\n- Falta')
    expect(tameEmoji('Científica 👩🏽‍🔬.')).toBe('Científica .')
    expect(tameEmoji('Bandera 🇪🇸 y fin')).toBe('Bandera y fin')
    expect(tameEmoji('Paso 1️⃣')).toBe('Paso 1')
    expect(tameEmoji('A ↔ B')).toBe('A ↔︎ B')
    expect(tameEmoji('pulsa ▶️ para ver')).toBe('pulsa ▶︎ para ver')
    expect(tameEmoji('© Aula')).toBe('© Aula')
  })

  it('no toca un texto sin emojis (ni las fórmulas)', () => {
    const s = 'La derivada de $x^2$ es $2x$.\n\n$$\\int_0^1 x\\,dx$$'
    expect(tameEmoji(s)).toBe(s)
    expect(tameEmoji('')).toBe('')
  })
})
