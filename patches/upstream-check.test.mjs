import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { detect, featureList } from './upstream-check.mjs'

const TEXT_INPUT = 'src/renderer/src/exercises/inputs/TextAnswerInput.tsx'
const RICH_TEXT = 'src/renderer/src/lib/RichText.tsx'

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'aula-check-'))
  for (const [rel, body] of Object.entries(files)) {
    const path = join(root, rel)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, body)
  }
  return root
}

function withTree(files, run) {
  const root = tree(files)
  try {
    return run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const upstream = {
  [TEXT_INPUT]: "export function TextAnswerInput() { return <input onKeyDown={(e) => e.key === 'Enter'} /> }",
  [RICH_TEXT]: 'const components = { a: Link, p: ({ children }) => <>{children}</> }'
}

test('upstream 0.2.6: neither feature is detected', () => {
  withTree(upstream, (root) => {
    assert.equal(detect(root, 'multiline'), false)
    assert.equal(detect(root, 'code'), false)
  })
})

test('our patched tree: both features are detected', () => {
  withTree(
    {
      [TEXT_INPUT]:
        "const ref = useRef<HTMLTextAreaElement>(null)\n<textarea onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit() }} />",
      [RICH_TEXT]: "import { CodeSurface } from './CodeSurface'\nconst components = { pre: ({ node }) => <MarkdownCode node={node} /> }"
    },
    (root) => {
      assert.equal(detect(root, 'multiline'), true)
      assert.equal(detect(root, 'code'), true)
    }
  )
})

test('a highlighted-code import alone is enough', () => {
  withTree({ [RICH_TEXT]: "import rehypeHighlight from 'rehype-highlight'" }, (root) => {
    assert.equal(detect(root, 'code'), true)
  })
})

test('a half-done multiline fix (textarea without Ctrl/Cmd+Enter) does not count', () => {
  withTree(
    {
      [TEXT_INPUT]: "export function TextAnswerInput() { return <textarea onKeyDown={(e) => { if (e.key === 'Enter') submit() }} /> }"
    },
    (root) => {
      assert.equal(detect(root, 'multiline'), false)
    }
  )
})

test('a comment that merely says "highlight" does not count', () => {
  withTree({ [RICH_TEXT]: '// TODO: add syntax highlighting to fenced code later' }, (root) => {
    assert.equal(detect(root, 'code'), false)
  })
})

test('missing files are absent, not errors', () => {
  withTree({}, (root) => {
    assert.equal(detect(root, 'multiline'), false)
    assert.equal(detect(root, 'code'), false)
  })
})

test('unknown keys throw', () => {
  assert.throws(() => detect(tmpdir(), 'nope'), /unknown feature/)
})

test('the feature table names the patch and issue for each feature', () => {
  assert.deepEqual(featureList(), [
    { key: 'multiline', issue: 69, patch: '10-multiline-69.patch', name: 'Multiline typed answers', always: false },
    { key: 'code', issue: 67, patch: '20-code-highlight-67.patch', name: 'Highlighted code in Markdown', always: false },
    { key: 'channel', issue: null, patch: '90-fork-channel.patch', name: 'Fork update channel and signing key', always: true }
  ])
})
