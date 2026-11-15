// Decisiones visuales compartidas entre el lienzo interactivo y su instantánea estática.
import type { DiagramNode } from '@shared/schema/blocks'
import type { Pt } from '../lib/diagramLayout'
import { INK, vizColor, wash } from '../shared/colors'

export const DIAGRAM_DIM = 0.24
export const MAX_INK_EDGES = 40
export const VENN_COLORS = ['var(--viz-blue)', 'var(--viz-amber)', 'var(--viz-teal)']

export function diagramNodePresentation(node: DiagramNode, on: boolean) {
  const tint = node.color ? vizColor(node.color) : undefined
  return {
    ring: tint ? wash(tint, 55) : 'var(--line-strong)',
    background: on ? wash(tint ?? 'var(--accent)', 14) : tint ? wash(tint, 9) : node.shape === 'note' ? wash('var(--sun)', 12) : 'var(--surface)',
    diamond: node.shape === 'diamond',
    radius: node.shape === 'round' ? 999 : node.shape === 'circle' ? '50%' : node.shape === 'note' ? '4px 14px 4px 4px' : 12,
    detail: node.detail?.trim()
  }
}

export function pyramidFill(index: number, total: number, color: string | undefined): string {
  if (color?.trim().toLowerCase() === 'accent') return wash(INK, 32)
  return wash(color ? vizColor(color) : INK, 9 + (total > 1 ? index / (total - 1) * 15 : 8))
}

export const diagramCurvePath = (pts: Pt[]): string => pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join('')
