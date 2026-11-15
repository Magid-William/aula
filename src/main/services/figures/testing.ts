// Fixtures sintéticas: no imágenes ni datos del estudiante.
import { deflateSync } from 'node:zlib'
import { crc32 } from '../ingest/core/zipArchive'

export const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
export function pngChunk(type: string, data: Buffer = Buffer.alloc(0)): Buffer {
  const chunk = Buffer.alloc(data.length + 12)
  chunk.writeUInt32BE(data.length)
  chunk.write(type, 4, 4, 'ascii')
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4)
  return chunk
}
export function pngHeader(width = 2, height = 2, color = 6): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4)
  header[8] = 8; header[9] = color
  return header
}
export function pngParts(o: { width?: number; height?: number; color?: number; raw?: Buffer; compressed?: Buffer; before?: Buffer[]; after?: Buffer[] } = {}): Buffer[] {
  const width = o.width ?? 2, height = o.height ?? 2, color = o.color ?? 6
  const raw = o.raw ?? Buffer.alloc((1 + width * (color === 6 ? 4 : 3)) * height)
  return [pngSignature, pngChunk('IHDR', pngHeader(width, height, color)), ...(o.before ?? []), pngChunk('IDAT', o.compressed ?? deflateSync(raw)), ...(o.after ?? []), pngChunk('IEND')]
}
export const pngFixture = (o: Parameters<typeof pngParts>[0] = {}): Buffer => Buffer.concat(pngParts(o))
