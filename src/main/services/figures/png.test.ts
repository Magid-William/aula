import { describe, expect, it } from 'vitest'
import { deflateSync, inflateSync } from 'node:zlib'
import { FIGURE_LIMITS as L } from '@shared/figures'
import { canonicalizeFigurePng as png } from './png'
import { pngChunk, pngFixture, pngHeader, pngParts, pngSignature } from './testing'

describe('PNG exportado', () => {
  it.each([2, 6])('conserva píxeles RGB/RGBA, incluidos alfa y los cinco filtros (tipo %s)', async color => {
    const stride = 1 + 3 * (color === 6 ? 4 : 3), raw = Buffer.alloc(stride * 5, 127)
    for (let i = 0; i < 5; i++) raw[i * stride] = i
    const source = pngFixture({ width: 3, height: 5, color, raw })
    const output = await png(source)
    expect(output).toEqual(source)
    expect(inflateSync(output.subarray(41, -16))).toEqual(raw)
  })

  it('quita texto, sin inflar metadatos, y reúne IDAT consecutivos', async () => {
    const parts = pngParts(), compressed = parts[2].subarray(8, -4)
    const source = Buffer.concat([parts[0], parts[1], pngChunk('sRGB', Buffer.from([0])), pngChunk('zTXt', Buffer.from('metadatos no interpretados')),
      pngChunk('IDAT', compressed.subarray(0, 3)), pngChunk('IDAT', compressed.subarray(3)), pngChunk('iTXt', Buffer.from('texto privado')), parts[3]])
    const clean = await png(source)
    expect(clean.includes(Buffer.from('texto privado'))).toBe(false)
    expect(clean.includes(Buffer.from('zTXt'))).toBe(false)
    expect(clean).toEqual(pngFixture({ before: [pngChunk('sRGB', Buffer.from([0]))] }))
  })

  it('rechaza firmas, CRC, longitudes y límites de dimensiones/bytes inválidos', async () => {
    const badCrc = pngFixture(); badCrc[badCrc.length - 1] ^= 1
    const badSize = pngFixture(); badSize.writeUInt32BE(0xffffffff, 8)
    const badDimensions = Buffer.concat([pngSignature, pngChunk('IHDR', pngHeader(4097, 1)), pngChunk('IDAT', deflateSync(Buffer.alloc(5))), pngChunk('IEND')])
    for (const source of [Buffer.alloc(80), badCrc, badSize, badDimensions, pngFixture().subarray(0, -1), Buffer.alloc(L.maxPngBytes + 1)]) await expect(png(source)).rejects.toThrow()
    await expect(png('data:image/png;base64,...')).rejects.toThrow()
  })

  it('rechaza orden, chunks no soportados, animación y bytes tras IEND', async () => {
    const p = pngParts()
    for (const source of [
      Buffer.concat([p[0], p[2], p[1], p[3]]), Buffer.concat([p[0], p[1], p[1], p[2], p[3]]),
      Buffer.concat([p[0], p[1], p[3]]), Buffer.concat([...p, Buffer.from('trailing')]),
      Buffer.concat([p[0], p[1], p[2], pngChunk('tEXt'), p[2], p[3]]),
      ...['acTL', 'iCCP', 'PLTE', 'tRNS', 'ABCD'].map(t => pngFixture({ before: [pngChunk(t)] }))
    ]) await expect(png(source)).rejects.toThrow()
    const interlaced = pngHeader(); interlaced[12] = 1
    await expect(png(Buffer.concat([p[0], pngChunk('IHDR', interlaced), p[2], p[3]]))).rejects.toThrow()
  })

  it('rechaza streams truncados, filtros inválidos, píxeles de más/de menos y bombas de inflado', async () => {
    const badFilter = Buffer.alloc(18); badFilter[9] = 5
    const compressed = deflateSync(Buffer.alloc(18))
    for (const source of [
      pngFixture({ compressed: compressed.subarray(0, -1) }), pngFixture({ compressed: Buffer.concat([compressed, Buffer.from([0])]) }),
      pngFixture({ raw: badFilter }), pngFixture({ raw: Buffer.alloc(17) }), pngFixture({ raw: Buffer.alloc(19) }),
      pngFixture({ width: 1, height: 1, raw: Buffer.alloc(2 * 1024 * 1024) })
    ]) await expect(png(source)).rejects.toThrow()
  })
})
