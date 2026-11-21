// Decide whether upstream main already implements one of the personal patches.
// The daily build skips our patch only when the upstream issue is CLOSED *and* this check
// finds the fix in the fetched tree. Every marker must be true; a missing file means absent.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const FEATURES = [
  {
    key: 'multiline',
    issue: 69,
    patch: '10-multiline-69.patch',
    name: 'Multiline typed answers',
    always: false,
    check: (root) => {
      const f = read(root, 'src/renderer/src/exercises/inputs/TextAnswerInput.tsx')
      return f !== null && /<textarea/i.test(f) && /(metaKey|ctrlKey)/.test(f) && /'Enter'|"Enter"/.test(f)
    }
  },
  {
    key: 'code',
    issue: 67,
    patch: '20-code-highlight-67.patch',
    name: 'Highlighted code in Markdown',
    always: false,
    check: (root) => {
      const f = read(root, 'src/renderer/src/lib/RichText.tsx')
      if (f === null) return false
      return (
        /\b(pre|code)\s*:/.test(f) ||
        /from\s+['"][^'"]*(highlight|shiki|prism|lowlight)[^'"]*['"]/i.test(f) ||
        /\b(CodeSurface|CodeBlock|HighlightedCode)\b/.test(f)
      )
    }
  },
  {
    key: 'channel',
    issue: null,
    patch: '90-fork-channel.patch',
    name: 'Fork update channel and signing key',
    always: true,
    check: () => false
  }
]

function read(root, rel) {
  try {
    return readFileSync(join(root, rel), 'utf8')
  } catch {
    return null
  }
}

/** True when the fetched tree already contains that feature. Throws on an unknown key. */
export function detect(root, key) {
  const feature = FEATURES.find((f) => f.key === key)
  if (!feature) throw new Error(`unknown feature: ${key}`)
  return feature.check(root)
}

/** Plain feature table (no functions) for the workflow. */
export function featureList() {
  return FEATURES.map(({ check, ...rest }) => rest)
}

function main(argv) {
  const [command, ...args] = argv
  if (command === 'list') {
    console.log(JSON.stringify(featureList(), null, 2))
    return 0
  }
  if (command === 'check') {
    const key = args[0]
    const eq = args.findIndex((a) => a.startsWith('--root='))
    const flag = args.indexOf('--root')
    const root = eq >= 0 ? args[eq].slice('--root='.length) : flag >= 0 ? args[flag + 1] : '.'
    if (!key || !root) {
      console.error('usage: upstream-check.mjs check <key> [--root <dir>]')
      return 2
    }
    try {
      const present = detect(resolve(root), key)
      console.log(present ? 'present' : 'absent')
      return present ? 0 : 1
    } catch (error) {
      console.error(error.message)
      return 2
    }
  }
  console.error('usage: upstream-check.mjs list | check <key> [--root <dir>]')
  return 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
