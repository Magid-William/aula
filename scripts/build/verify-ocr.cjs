// Comprueba el contenido real antes de firmar o construir instaladores, no sólo los filtros del YAML.
const { readFileSync } = require('node:fs')
const { dirname, join } = require('node:path')
const { extractFile } = require('@electron/asar')

// Todas las ramas del adaptador Node de tesseract.js 7, con y sin LSTM.
const CORE_NAMES = ['tesseract-core', 'tesseract-core-simd', 'tesseract-core-relaxedsimd',
  'tesseract-core-lstm', 'tesseract-core-simd-lstm', 'tesseract-core-relaxedsimd-lstm']

function verifyOcrArchive(archive) {
  const installed = dirname(require.resolve('tesseract.js-core/package.json'))
  for (const name of CORE_NAMES) {
    for (const extension of ['js', 'wasm']) {
      const file = `${name}.${extension}`
      const entry = join('node_modules', 'tesseract.js-core', file)
      let bytes
      try { bytes = extractFile(archive, entry) } catch (cause) {
        throw new Error(`OCR incompleto: falta ${entry} en ${archive}`, { cause })
      }
      // Incluye archivos asarUnpack y detecta también copias truncadas o de otra versión.
      if (!bytes.equals(readFileSync(join(installed, file)))) {
        throw new Error(`OCR incompleto: ${entry} no coincide con la dependencia instalada`)
      }
    }
  }
}

module.exports = async function afterPack(context) {
  const resources = context.packager.getResourcesDir(context.appOutDir)
  verifyOcrArchive(join(resources, 'app.asar'))
}
module.exports.verifyOcrArchive = verifyOcrArchive
module.exports.CORE_NAMES = CORE_NAMES

if (require.main === module) {
  if (process.argv.length !== 3) throw new Error('Uso: node scripts/build/verify-ocr.cjs /ruta/resources/app.asar')
  verifyOcrArchive(process.argv[2])
  console.log('OCR: las seis parejas JS/WASM están completas en el paquete')
}
