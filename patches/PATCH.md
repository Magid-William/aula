# Aula personal fork: multiline answers + private update channel

Upstream: https://github.com/luumlabs/aula
Fork: https://github.com/Magid-William/aula (public; no PR upstream)

The fork never merges upstream into its own `main`. A GitHub Action starts from a fresh upstream
`main`, applies one combined patch, builds, signs and publishes a release on the fork. The
installed app then updates itself from that release.

## The patches

`aula-patched.patch` is the combined diff (`git diff <upstream-base>..HEAD`). It contains:

1. **Multiline answers** — every `TextAnswerInput` kind is a growing `<textarea>`:
   - grows 48–200 px from `scrollHeight`;
   - `Enter` = newline, `Ctrl`/`Cmd+Enter` = submit, `enterKeyHint="enter"`;
   - `useExercise.ts` reports `multiline` for every typed-answer kind (Check button hint);
   - incorrect answers use the ink strike only for a truly single-line value, `line-through`
     once the field has grown.
2. **Update channel** — `electron-builder.yml` publishes to `Magid-William/aula`, and
   `src/main/services/updates/signature.ts` trusts the fork's Ed25519 public key.

Grading needs no change: `TextChecker` and the math normalizer already treat newlines as spaces.

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
3. `git checkout -B build FETCH_HEAD`; `git apply --3way` the combined patch.
4. `npm ci` → `tsc -p tsconfig.web.json` → `vitest run src/renderer/src/exercises`.
5. `npm run build` → `electron-builder --win nsis --x64 --publish never`.
6. `node scripts/release-sign.mjs release` with the secret.
7. `gh release create` the installer, `latest.yml` and the blockmap.

On a conflict or a failing test the job stops and publishes nothing.

## Manual local build

```powershell
cd D:\Dev\Playground\Projects\Apps\aula\aula-src
npm run build
npx electron-builder --win nsis --x64 --publish never
node scripts/release-sign.mjs release
```

## Updating the patch after an upstream rewrite

```powershell
cd D:\Dev\Playground\Projects\Apps\aula\aula-src
git fetch --depth 1 origin main
git checkout -B upstream-work FETCH_HEAD
git apply --3way ..\patches\aula-patched.patch
# resolve, keeping the behaviours above
git diff --output=..\patches\aula-patched.patch 24612fc..HEAD   # or the new upstream base
```

Then commit the updated `patches/aula-patched.patch` to the fork's `main` (at minimum that file
and `.github/workflows/aula-release.yml` live there).
