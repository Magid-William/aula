# Aula personal fork: patches, private update channel and the upstream check

Upstream: https://github.com/luumlabs/aula
Fork: https://github.com/Magid-William/aula (public; no PR upstream)

The fork never merges upstream into its own `main`. A GitHub Action starts from a fresh upstream
`main`, applies the patches it still needs, builds, signs and publishes a release on the fork.
The installed app then updates itself from that release.

## The patches

| Patch | Upstream issue | Contents | Applied |
|---|---|---|---|
| `10-multiline-69.patch` | [#69](https://github.com/luumlabs/aula/issues/69) | every typed answer is a growing `<textarea>`: 48–200 px, `Enter` = newline, `Ctrl`/`Cmd+Enter` = check; the hint follows every typed-answer kind; the ink strike only for a truly single-line value, `line-through` once grown | unless upstream has it |
| `20-code-highlight-67.patch` | [#67](https://github.com/luumlabs/aula/issues/67) | one `CodeSurface` for the `code` block and every Markdown fence (language label, highlight.js, copy, line numbers from 3 lines, horizontal scroll); full `block_reference("code")` for the agent | unless upstream has it |
| `90-fork-channel.patch` | — | `electron-builder.yml` publishes to `Magid-William/aula`; `src/main/services/updates/signature.ts` trusts the fork's Ed25519 key | always |

They touch disjoint files, so they apply in order `10 → 20 → 90` with `git apply --3way`.
Grading needs no change: `TextChecker` and the math normalizer already treat newlines as spaces.

## Before applying: does upstream already have it?

For each feature patch the workflow needs **both** signals to skip our version:

1. `gh issue view <issue> -R luumlabs/aula --json state` is `CLOSED`, and
2. `patches/upstream-check.mjs check <key> --root .` finds the fix in the fetched upstream tree.

| Key | File | All markers |
|---|---|---|
| `multiline` | `src/renderer/src/exercises/inputs/TextAnswerInput.tsx` | `<textarea`, `metaKey`/`ctrlKey`, `Enter` |
| `code` | `src/renderer/src/lib/RichText.tsx` | a `pre:`/`code:` component, a highlight/shiki/prism/lowlight import, or a `CodeSurface`/`CodeBlock` component |

A closed issue alone is not enough: it may be a duplicate, a wontfix or a partial fix. In that case
the workflow logs `::warning::` and keeps our patch. If `gh` or the checker fails, it also keeps
our patch — the build never silently loses a feature.

Both the decision table and the result go to the run summary; the release notes say
`own patch: …` or `upstream: …` per feature.

## Manual overrides

`workflow_dispatch` on the fork:

- `force`: `none | all | multiline | code` — apply our patch even when upstream has the feature
  (for when their fix is incomplete or the markers are a false positive).
- `dry_run`: stop after the patches are applied and `git diff --stat` is printed. No install,
  build or publish. Use it to test the patch set against a new upstream commit.

## Signing

- Public key: in `UPDATE_PUBLIC_KEYS` (`src/main/services/updates/signature.ts`).
- Private key (PKCS#8 PEM): GitHub secret `AULA_UPDATE_SIGNING_KEY` and the offline copy at
  `~/.aula-signing/update-ed25519.key`. **Never commit it.**
- `scripts/release-sign.mjs release` signs `latest.yml` (and the release notes) before upload.
- If the private key is lost, installed copies stop accepting updates; publish a build with a new
  key and install it by hand.

## The workflow

`.github/workflows/aula-release.yml`, daily at 04:00 UTC + `workflow_dispatch`:

1. `git fetch --depth=1 upstream main`; read its `package.json` version.
2. Skip if the release tag already exists (`v<version>`, or `patched-<version>` when upstream's tag
   is already in the fork).
3. Copy `patches/*.patch` and `patches/upstream-check.mjs` to `RUNNER_TEMP` (the next step replaces
   the working tree, which removes `patches/`).
4. `git checkout -B build FETCH_HEAD`; for each feature, check the issue and the markers; apply what
   is still needed.
5. `npm ci` → `tsc -p tsconfig.web.json` → renderer exercise tests (plus `src/renderer/src/lib`
   while the code patch is applied).
6. `npm run build` → `electron-builder --win nsis --x64 --publish never`.
7. `node scripts/release-sign.mjs release` with the secret.
8. `gh release create` the installer, `latest.yml` and the blockmap.

On a conflict or a failing test the job stops and publishes nothing.

## Adding the next feature (the loop)

1. Fix it on a branch of the fork, with tests; use it locally.
2. Open an upstream issue (English, screenshots, expected behaviour) **without** a PR.
3. Generate the patch against the current `upstream-base.txt` commit:
   `git diff <base>..<branch> -- src > patches/20-<name>-<issue>.patch` (number it so it sorts
   between 10 and 90).
4. Add a `key`/`issue`/`patch`/markers entry to `patches/upstream-check.mjs` and a test in
   `patches/upstream-check.test.mjs`.
5. Add the row to the table above, push the fork's `main`, and let the daily run pick it up.
6. When the upstream issue closes and the markers appear, the patch stops being applied on its own;
   delete it (and its markers) after one green build without it.

## Manual local build

```powershell
cd D:\Dev\Playground\Projects\Apps\aula\aula-src
npm run build
npx electron-builder --win nsis --x64 --publish never
node scripts/release-sign.mjs release
```

## Updating a patch after an upstream rewrite

```powershell
cd D:\Dev\Playground\Projects\Apps\aula\aula-src
git fetch --depth 1 origin main
git checkout -B upstream-work FETCH_HEAD
git apply --3way ..\patches\10-multiline-69.patch ..\patches\20-code-highlight-67.patch ..\patches\90-fork-channel.patch
# resolve, keeping the behaviours above
git diff --output=..\patches\20-code-highlight-67.patch FETCH_HEAD..HEAD -- src
```

Then commit the updated patch files to the fork's `main`. `upstream-base.txt` holds the commit the
patches were last regenerated from.
