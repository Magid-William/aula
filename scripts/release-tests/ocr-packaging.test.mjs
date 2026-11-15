import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep, win32 } from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'

const require = createRequire(import.meta.url)
const { createPackageWithOptions, extractAll, extractFile, getRawHeader } = require('@electron/asar')
const { CORE_NAMES, verifyOcrArchive } = require('../build/verify-ocr.cjs')

async function fixture(t, unpacked = false) {
  const dir = mkdtempSync(join(tmpdir(), 'aula-ocr-package-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const source = join(dir, 'source')
  mkdirSync(join(source, 'node_modules'), { recursive: true })
  for (const name of ['tesseract.js-core', 'tesseract.js', 'wasm-feature-detect']) {
    cpSync(dirname(require.resolve(`${name}/package.json`)), join(source, 'node_modules', name), {
      recursive: true, filter: file => !file.endsWith('.wasm.js')
    })
  }
  const archive = join(dir, 'app.asar')
  await createPackageWithOptions(source, archive, unpacked ? { unpackDir: '**/tesseract.js-core' } : {})
  return { dir, archive }
}

test('el paquete contiene las seis parejas originales y el adaptador real carga sus WASM', async (t) => {
  const { dir, archive } = await fixture(t)
  verifyOcrArchive(archive)
  const extracted = join(dir, 'extracted')
  extractAll(archive, extracted)
  // Sólo se simulan capacidades de CPU: selector, módulo JS y compilación WASM son los distribuidos.
  // Cada rama va en un proceso distinto porque getCore conserva el núcleo de la primera llamada.
  const probe = `
    const assert = require('node:assert/strict');
    const { realpathSync } = require('node:fs');
    const { createRequire } = require('node:module');
    const { join } = require('node:path');
    const root = realpathSync(process.argv[1]), name = process.argv[2];
    const fromPackage = createRequire(join(root, 'package.json'));
    const detect = fromPackage('wasm-feature-detect');
    detect.simd = async () => name.includes('simd');
    detect.relaxedSimd = async () => name.includes('relaxedsimd');
    const selectedPath = fromPackage.resolve('tesseract.js-core/' + name);
    assert(selectedPath.startsWith(root), 'must not fall back to development dependencies');
    const getCore = fromPackage('tesseract.js/src/worker-script/node/getCore');
    (async () => {
      // createWorker(OEM 1) envía true: en 7.0.0 esa ruta carga un núcleo completo (#43).
      const core = await getCore(name.endsWith('-lstm') ? 1 : true, undefined, { progress() {} });
      assert.equal(core, fromPackage('tesseract.js-core/' + name));
      const module = await core();
      const api = new module.TessBaseAPI();
      assert.equal(typeof api.Init, 'function');
      module.destroy(api);
      console.log(name + ': JS + WASM loaded');
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `
  for (const name of CORE_NAMES) {
    const result = spawnSync(process.execPath, ['-e', probe, extracted, name], {
      encoding: 'utf8', timeout: 30_000, env: { ...process.env, NODE_PATH: '' }
    })
    assert.equal(result.status, 0, `${name}: ${result.error ?? result.stderr}`)
    assert.match(result.stdout, /JS \+ WASM loaded/)
  }
})

test('el guard rechaza cada JS o WASM ausente, incluso fuera del asar', async (t) => {
  const { archive } = await fixture(t, true)
  verifyOcrArchive(archive)
  for (const name of CORE_NAMES) {
    for (const extension of ['js', 'wasm']) {
      const file = `${name}.${extension}`
      const path = join(`${archive}.unpacked`, 'node_modules/tesseract.js-core', file)
      renameSync(path, `${path}.missing`)
      try { assert.throws(() => verifyOcrArchive(archive), error => error.message.includes(file)) }
      finally { renameSync(`${path}.missing`, path) }
    }
  }
})

test('el guard rechaza un WASM truncado y una copia de otra variante', async (t) => {
  const { archive } = await fixture(t, true)
  const coreDir = join(`${archive}.unpacked`, 'node_modules/tesseract.js-core')
  const path = join(coreDir, 'tesseract-core-relaxedsimd.wasm')
  const original = readFileSync(path)
  writeFileSync(path, original.subarray(0, 128))
  assert.throws(() => verifyOcrArchive(archive), /tesseract-core-relaxedsimd.wasm/)
  writeFileSync(path, readFileSync(join(coreDir, 'tesseract-core-relaxedsimd-lstm.wasm')))
  assert.throws(() => verifyOcrArchive(archive), /tesseract-core-relaxedsimd.wasm/)
})

test('el guard usa rutas que el parser ASAR real de Windows puede resolver', async (t) => {
  const { archive } = await fixture(t)
  function loadWithPaths(file, adapters) {
    const nativeRequire = createRequire(file), module = { exports: {} }
    const adaptedRequire = Object.assign(name => adapters[name] ?? nativeRequire(name), { resolve: nativeRequire.resolve })
    runInNewContext(readFileSync(file, 'utf8'), {
      require: adaptedRequire, module, exports: module.exports, __dirname: dirname(file)
    }, { filename: file })
    return module.exports
  }
  // Código real de ASAR con path.win32. Sólo adaptamos rutas/lecturas: no sustituye un runner Windows.
  const { Filesystem } = loadWithPaths(require.resolve('@electron/asar/lib/filesystem'), { path: win32 })
  const filesystem = new Filesystem('C:\\aula\\app.asar')
  filesystem.setHeader(getRawHeader(archive).header, 0)
  assert.throws(() => filesystem.getFile('node_modules/tesseract.js-core/tesseract-core.wasm'), /not found/)
  const hostPath = path => path.split('\\').join(sep)
  const guard = loadWithPaths(require.resolve('../build/verify-ocr.cjs'), {
    'node:path': win32,
    'node:fs': { readFileSync: path => readFileSync(hostPath(path)) },
    '@electron/asar': { extractFile: (path, entry) => {
      filesystem.getFile(entry)
      return extractFile(hostPath(path), hostPath(entry))
    } }
  })
  guard.verifyOcrArchive(archive)
})
