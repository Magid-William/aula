// PNG estático de Canvas: RGB/RGBA de 8 bits, sin entrelazado ni perfiles externos.
import { createInflate } from 'node:zlib'
import { FIGURE_LIMITS as L, FigureValidationError } from '@shared/figures'
import { crc32 } from '../ingest/core/zipArchive'

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const fail = (large = false): never => { throw new FigureValidationError(large ? 'too_large' : 'invalid') }

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(data.length + 12)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, -4)), out.length - 4)
  return out
}

/** Comprueba también el flujo comprimido, sin conservar el mapa de píxeles en memoria. */
async function checkPixels(compressed: Buffer, stride: number, height: number): Promise<void> {
  const expected = stride * height
  await new Promise<void>((resolve, reject) => {
    const inflater = createInflate()
    let seen = 0
    inflater.on('data', (part: Buffer) => {
      if (seen + part.length > expected) { inflater.destroy(new FigureValidationError()); return }
      // Cada fila empieza con el selector de filtro; todos los bytes siguientes son datos de píxel.
      for (let i = (stride - seen % stride) % stride; i < part.length; i += stride) {
        if (part[i] > 4) { inflater.destroy(new FigureValidationError()); return }
      }
      seen += part.length
    })
    inflater.once('error', () => reject(new FigureValidationError()))
    inflater.once('end', () => {
      if (seen !== expected || inflater.bytesWritten !== compressed.length) reject(new FigureValidationError())
      else resolve()
    })
    inflater.end(compressed)
  })
}

/** Elimina metadatos de texto y devuelve sólo chunks conocidos, con CRC y contenido comprobados. */
export async function canonicalizeFigurePng(value: unknown): Promise<Buffer> {
  if (!(value instanceof Uint8Array)) return fail()
  if (value.byteLength > L.maxPngBytes) return fail(true)
  const bytes = Buffer.from(value) // Copia propia: el llamante no puede cambiar el contenido mientras se infla.
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(SIGNATURE)) return fail()
  let offset = 8, count = 0, width = 0, height = 0, channels = 0, ended = false, idatClosed = false
  let header: Buffer | undefined
  const metadata: Buffer[] = [], data: Buffer[] = [], seen = new Set<string>()
  while (offset < bytes.length) {
    if (++count > 4096) return fail(true)
    if (offset + 12 > bytes.length) return fail()
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length
    if (end > bytes.length) return fail()
    const type = bytes.toString('latin1', offset + 4, offset + 8)
    if (!/^[A-Za-z]{4}$/.test(type) || !/[A-Z]/.test(type[2])) return fail()
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) return fail()
    const part = bytes.subarray(offset + 8, end - 4)
    if (!header && type !== 'IHDR') return fail()
    if (type === 'IHDR') {
      if (header || length !== 13) return fail()
      width = part.readUInt32BE(0); height = part.readUInt32BE(4)
      if (!width || !height) return fail()
      if (width > L.maxDimension || height > L.maxDimension || width * height > L.maxPixels) return fail(true)
      if (part[8] !== 8 || ![2, 6].includes(part[9]) || part[10] || part[11] || part[12]) return fail()
      channels = part[9] === 6 ? 4 : 3
      header = part
    } else if (type === 'IDAT') {
      if (idatClosed) return fail()
      data.push(part)
    } else if (type === 'IEND') {
      if (length || !data.length || end !== bytes.length) return fail()
      ended = true
    } else {
      if (data.length) idatClosed = true
      if (['tEXt', 'zTXt', 'iTXt'].includes(type)) { /* Se descartan sin descomprimir. */ }
      else if (['sRGB', 'gAMA', 'cHRM', 'pHYs'].includes(type)) {
        if (data.length || seen.has(type)) return fail()
        if (type === 'sRGB' && (length !== 1 || part[0] > 3)) return fail()
        if (type === 'gAMA' && (length !== 4 || part.readUInt32BE(0) === 0)) return fail()
        if (type === 'cHRM' && (length !== 32 || Array.from({ length: 8 }, (_, i) => part.readUInt32BE(i * 4)).some(n => n > 100_000))) return fail()
        if (type === 'pHYs' && (length !== 9 || part[8] > 1)) return fail()
        seen.add(type)
        metadata.push(chunk(type, part))
      } else return fail() // Sin animación, paletas, perfiles comprimidos ni extensiones desconocidas.
    }
    offset = end
  }
  if (!header || !ended) return fail()
  const compressed = Buffer.concat(data)
  await checkPixels(compressed, 1 + width * channels, height)
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), ...metadata, chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))])
}
