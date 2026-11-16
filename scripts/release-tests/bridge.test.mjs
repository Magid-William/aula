import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { BRIDGE_FILES, BRIDGE_VERSION, DEVELOPER_FEED, LEGACY_FEED, ROOT, artifactMessage, notesMessage, hashFile, yaml, verifyMetadata, macMode } from '../release-common.mjs'
import { bridgeManifest, checkPublishedBridge, confirmPublishedBridge, prepareMacChannels, readBridgeManifest, verifyBridgeFiles, verifyMacChannels } from '../release-mac-bridge.mjs'

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'aula-bridge-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return { dir, privateKey, keys: [publicKey] }
}
async function feed(f, version = BRIDGE_VERSION, folder = f.dir, name = LEGACY_FEED) {
  mkdirSync(folder, { recursive: true })
  const files = []
  for (const ext of ['zip', 'dmg']) {
    const url = `Aula-${version}-mac.${ext}`
    writeFileSync(join(folder, url), `fixture ${version} ${ext}`)
    writeFileSync(join(folder, url + '.blockmap'), `blockmap ${version} ${ext}`)
    const sha512 = await hashFile(join(folder, url))
    files.push({ url, sha512, size: readFileSync(join(folder, url)).length, aulaSignature: sign(null, artifactMessage(url, version, sha512), f.privateKey).toString('base64') })
  }
  const releaseNotes = 'Notas firmadas\n\nSigned notes.'
  const info = { version, files, path: files[0].url, sha512: files[0].sha512, releaseName: `Aula ${version}`, releaseNotes, aulaNotesSignature: sign(null, notesMessage(version, releaseNotes), f.privateKey).toString('base64') }
  writeFileSync(join(folder, name), '# Original formatting must survive\n' + yaml.dump(info, { lineWidth: -1 }))
  return info
}
async function baseline(t) {
  const f = fixture(t)
  await feed(f)
  await prepareMacChannels(f.dir, BRIDGE_VERSION, f)
  f.manifestPath = join(f.dir, 'manifest.json')
  writeFileSync(f.manifestPath, JSON.stringify({ ...await bridgeManifest(f.dir, f), publishedAt: '2026-11-15T00:00:00Z' }))
  return f
}
function updateMetadata(dir, name, change) {
  const path = join(dir, name), value = yaml.load(readFileSync(path, 'utf8'))
  change(value)
  writeFileSync(path, yaml.dump(value))
}

test('0.2.5 publishes two byte-identical signed feeds; later metadata preserves all original bytes', async (t) => {
  const f = await baseline(t)
  assert.deepEqual(readFileSync(join(f.dir, LEGACY_FEED)), readFileSync(join(f.dir, DEVELOPER_FEED)))
  const current = join(f.dir, 'current')
  await feed(f, '0.2.6', current)
  await prepareMacChannels(current, '0.2.6', { ...f, bridgeDir: f.dir })
  assert.equal(yaml.load(readFileSync(join(current, DEVELOPER_FEED), 'utf8')).version, '0.2.6')
  for (const name of BRIDGE_FILES) assert.deepEqual(readFileSync(join(current, name)), readFileSync(join(f.dir, name)))
  await verifyMacChannels(current, '0.2.6', f)
  await prepareMacChannels(current, '0.2.6', { ...f, bridgeDir: f.dir })
  await assert.rejects(verifyMacChannels(current, '0.2.7', f), /versión/)
})

test('future releases fail closed without a public manifest and refuse differing original artifacts', async (t) => {
  const f = await baseline(t), current = join(f.dir, 'current')
  await feed(f, '0.2.6', current)
  await assert.rejects(prepareMacChannels(current, '0.2.6', { ...f, bridgeDir: f.dir, manifestPath: join(f.dir, 'missing.json') }), /Falta el manifiesto/)
  await assert.rejects(prepareMacChannels(current, '0.2.6', f), /bridge-dir/)
  writeFileSync(join(current, 'Aula-0.2.5-mac.zip'), 'rebuilt bridge')
  await assert.rejects(prepareMacChannels(current, '0.2.6', { ...f, bridgeDir: f.dir }), /No se sustituye/)
})

test('bridge requires the original YAML, ZIP, DMG and both blockmaps', async (t) => {
  for (const name of BRIDGE_FILES) {
    const f = await baseline(t)
    rmSync(join(f.dir, name))
    await assert.rejects(verifyBridgeFiles(f.dir, f), /Falta/)
  }
})

test('the manifest pins hashes and exact YAML bytes, validates its schema, and rejects symlinks', async (t) => {
  const f = await baseline(t)
  writeFileSync(join(f.dir, LEGACY_FEED), readFileSync(join(f.dir, LEGACY_FEED), 'utf8') + '\n')
  await assert.rejects(verifyBridgeFiles(f.dir, f), /manifiesto/)
  const manifest = JSON.parse(readFileSync(f.manifestPath))
  manifest.files[0].sha512 = 'bad'
  writeFileSync(f.manifestPath, JSON.stringify(manifest))
  assert.throws(() => readBridgeManifest(f.manifestPath), /Hash/)
  const f2 = await baseline(t), file = join(f2.dir, 'Aula-0.2.5-mac.zip')
  copyFileSync(file, file + '.real'); rmSync(file); symlinkSync(file + '.real', file)
  await assert.rejects(verifyBridgeFiles(f2.dir, f2), /regular/)
})

test('metadata refuses altered artifact bytes, notes, signatures, paths, duplicate files and size', async (t) => {
  const cases = [
    [i => { i.releaseNotes += ' altered' }, /notas sin firma/],
    [i => { i.files[0].aulaSignature = 'bad' }, /sin firma válida/],
    [i => { i.files[0].url = '../outside.zip' }, /Nombre/],
    [i => { i.files.push(i.files[0]) }, /repetido/],
    [i => { i.files[0].size++ }, /tamaño/],
    [i => { i.path = i.files[1].url }, /path\/sha512/]
  ]
  for (const [change, expected] of cases) {
    const f = fixture(t); await feed(f); updateMetadata(f.dir, LEGACY_FEED, change)
    await assert.rejects(verifyMetadata(f.dir, LEGACY_FEED, f), expected)
  }
  const f = fixture(t); await feed(f)
  writeFileSync(join(f.dir, 'Aula-0.2.5-mac.zip'), 'changed')
  await assert.rejects(verifyMetadata(f.dir, LEGACY_FEED, f), /SHA-512/)
  const wrong = fixture(t); await feed(wrong)
  await assert.rejects(verifyMetadata(wrong.dir, LEGACY_FEED, f), /sin firma válida/)
})

test('the two bridge feeds cannot differ even when both signatures remain valid', async (t) => {
  const f = await baseline(t)
  writeFileSync(join(f.dir, DEVELOPER_FEED), readFileSync(join(f.dir, DEVELOPER_FEED), 'utf8') + '\n')
  await assert.rejects(verifyMacChannels(f.dir, BRIDGE_VERSION, f), /idénticos/)
})

test('manifest generation confirms published stable public assets, including the second channel', async (t) => {
  const f = await baseline(t), manifest = await bridgeManifest(f.dir, f)
  const files = [...manifest.files, { ...manifest.files[0], name: DEVELOPER_FEED }]
  let draft = false, corrupt = false, missing = false
  const fetcher = async (url) => {
    if (url.includes('api.github.com')) return Response.json({ tag_name: 'v0.2.5', draft, prerelease: false, published_at: '2026-11-15T00:00:00Z', assets: files.filter(x => !missing || x.name !== DEVELOPER_FEED).map(x => ({ name: x.name, size: x.bytes })) })
    const bytes = readFileSync(join(f.dir, url.split('/').pop()))
    return new Response(corrupt ? Buffer.alloc(bytes.length) : bytes)
  }
  assert.equal((await confirmPublishedBridge(manifest, fetcher)).publishedAt, '2026-11-15T00:00:00Z')
  draft = true; await assert.rejects(confirmPublishedBridge(manifest, fetcher), /publicado/)
  draft = false; corrupt = true; await assert.rejects(confirmPublishedBridge(manifest, fetcher), /bytes públicos/)
  corrupt = false; missing = true; await assert.rejects(confirmPublishedBridge(manifest, fetcher), /Falta el original público/)
})

test('after publishing, the five bridge originals must be downloadable unchanged under the latest tag', async (t) => {
  const f = await baseline(t)
  const requested = []
  let change = () => null
  const fetcher = async (url) => {
    requested.push(url)
    const name = url.split('/').pop()
    const altered = change(name)
    if (altered === 404) return new Response('Not Found', { status: 404 })
    return new Response(altered ?? readFileSync(join(f.dir, name)))
  }
  await checkPublishedBridge('luumlabs/aula', 'v0.2.6', { ...f, fetcher })
  assert.deepEqual(requested.map((url) => url.replace('https://github.com/luumlabs/aula/releases/download/', '')).sort(), BRIDGE_FILES.map((name) => `v0.2.6/${name}`).sort())
  for (const [name, altered, expected] of [
    [LEGACY_FEED, 404, /v0\.2\.6 no tiene latest-mac\.yml \(404\)/],
    ['Aula-0.2.5-mac.dmg.blockmap', 404, /no tiene Aula-0\.2\.5-mac\.dmg\.blockmap/],
    ['Aula-0.2.5-mac.zip', Buffer.from('rebuilt bridge'), /no coincide con el manifiesto/],
    [LEGACY_FEED, Buffer.concat([readFileSync(join(f.dir, LEGACY_FEED)), Buffer.from('\n')]), /más grande que el original/]
  ]) {
    change = (file) => file === name ? altered : null
    await assert.rejects(checkPublishedBridge('luumlabs/aula', 'v0.2.6', { ...f, fetcher }), expected)
  }
})

test('signing future feeds never rewrites the frozen legacy YAML, and --only is strict', async (t) => {
  const f = await baseline(t), current = join(f.dir, 'current')
  await feed(f, '0.2.6', current)
  await prepareMacChannels(current, '0.2.6', { ...f, bridgeDir: f.dir })
  const original = readFileSync(join(current, LEGACY_FEED))
  const pub = f.keys[0].export({ format: 'der', type: 'spki' }).toString('base64')
  const env = { ...process.env, AULA_UPDATE_SIGNING_KEY: f.privateKey.export({ format: 'pem', type: 'pkcs8' }) }
  const run = (...args) => spawnSync(process.execPath, [join(ROOT, 'scripts/release-sign.mjs'), current, '--public', pub, ...args], { env, encoding: 'utf8' })
  const signed = run()
  assert.equal(signed.status, 0, signed.stderr)
  assert.deepEqual(readFileSync(join(current, LEGACY_FEED)), original)
  await verifyMacChannels(current, '0.2.6', f)
  assert.equal(run('--verify').status, 0)
  assert.equal(run('--only', 'missing.yml').status, 1)
  updateMetadata(current, LEGACY_FEED, i => { i.aulaNotesSignature = 'bad' })
  assert.equal(run().status, 1, 'signer must not repair or re-sign frozen notes')
})

test('stable version policy rejects prereleases and selects both bridge boundaries', () => {
  assert.equal(macMode('0.2.4'), 'legacy')
  assert.equal(macMode('0.2.5'), 'bridge')
  assert.equal(macMode('0.2.6'), 'developer-id')
  assert.equal(macMode('1.0.0'), 'developer-id')
  assert.throws(() => macMode('0.2.6-beta.1'))
})
