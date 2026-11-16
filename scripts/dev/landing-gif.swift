// GIF en bucle (y su fotograma fijo en JPEG) de un tramo del vídeo de demostración, sin ffmpeg: AVFoundation + ImageIO.
//   swift scripts/dev/landing-gif.swift <vídeo.mp4> <salida.gif> <desde_s> <hasta_s> <fps> <ancho> [fijo.jpg <instante_s>]
// El alto sale de la proporción del vídeo (16:9). A 10 fps cada fotograma dura 10 centésimas exactas, como los mide el navegador.
import AVFoundation
import Foundation
import ImageIO
import UniformTypeIdentifiers

let a = CommandLine.arguments
guard a.count >= 7, let t0 = Double(a[3]), let t1 = Double(a[4]), let fps = Double(a[5]), let w = Int(a[6]) else {
  print("uso: landing-gif <vídeo.mp4> <salida.gif> <desde_s> <hasta_s> <fps> <ancho> [fijo.jpg <instante_s>]"); exit(2)
}
let h = Int((Double(w) * 9 / 16).rounded())
let gen = AVAssetImageGenerator(asset: AVURLAsset(url: URL(fileURLWithPath: a[1])))
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = .zero

// fotograma del vídeo escalado a w×h exactos
func frame(at s: Double) throws -> CGImage {
  let src = try gen.copyCGImage(at: CMTime(seconds: s, preferredTimescale: 600), actualTime: nil)
  let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
  ctx.interpolationQuality = .high
  ctx.draw(src, in: CGRect(x: 0, y: 0, width: w, height: h))
  return ctx.makeImage()!
}

let n = Int(((t1 - t0) * fps).rounded())
let gif = CGImageDestinationCreateWithURL(URL(fileURLWithPath: a[2]) as CFURL, UTType.gif.identifier as CFString, n, nil)!
CGImageDestinationSetProperties(gif, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]] as CFDictionary)
let delay = [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: 1 / fps, kCGImagePropertyGIFUnclampedDelayTime: 1 / fps]] as CFDictionary
for i in 0..<n { CGImageDestinationAddImage(gif, try frame(at: t0 + Double(i) / fps), delay) }
guard CGImageDestinationFinalize(gif) else { print("no se pudo escribir el GIF"); exit(1) }
print("✓ \(a[2]) · \(w)×\(h) · \(n) fotogramas")

if a.count >= 9, let ts = Double(a[8]) {
  let jpg = CGImageDestinationCreateWithURL(URL(fileURLWithPath: a[7]) as CFURL, UTType.jpeg.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(jpg, try frame(at: ts), [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
  guard CGImageDestinationFinalize(jpg) else { print("no se pudo escribir el JPEG"); exit(1) }
  print("✓ \(a[7]) · \(w)×\(h) · \(ts) s")
}
