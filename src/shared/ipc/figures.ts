import type { FigureSaveArgs, FigureSaveResult } from '../figures'

declare module './contract' {
  interface RpcMethods {
    /** Exporta una figura mediante el diálogo del equipo local. null = cancelado; nunca admite una ruta de destino. */
    'figures.save': { args: FigureSaveArgs; result: FigureSaveResult | null }
    /** Solo archivos guardados desde esta ventana durante esta sesión. */
    'figures.revealSaved': { args: { path: string }; result: void }
  }
}
export {}
