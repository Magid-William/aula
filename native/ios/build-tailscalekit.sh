#!/bin/bash
# Builds TailscaleKit.xcframework (iOS device arm64 + iOS Simulator arm64) from the
# official https://github.com/tailscale/libtailscale repository and copies it to
# native/ios/Frameworks/TailscaleKit.xcframework.
#
# Uses the project-local Go toolchain in <root>/.toolchain (see .toolchain/env.sh).
# Nothing is installed system-wide.
#
# Equivalent to libtailscale's `cd swift && make ios-fat`, except:
#   * tailscalekit/aula_nologs.go is added to the Go package: the node never
#     uploads logs to log.tailscale.com (like the Mac's aula-tsnet),
#   * the simulator slice is arm64 only (no x86_64 build),
#   * every path is quoted, because this project lives under a path with spaces
#     (the upstream Makefile's `CC=$(PWD)/...` breaks on spaces),
#   * the framework's bundle id is com.luumlabs.aula.TailscaleKit (not Tailscale's
#     io.tailscale.Tailscale), and every framework in the xcframework carries its own
#     privacy manifest (tailscalekit/PrivacyInfo.xcprivacy), as the App Store asks, and
#   * the license notices the app shows (Aula/Licenses.json) are written again from
#     the Go modules that go into the framework (scripts/licenses.mjs).
#
# Env overrides:
#   LIBTAILSCALE_REF   git commit/tag to build (default: pinned commit below)
#   SKIP_GO=1          reuse existing libtailscale_ios*.a archives
#   AULA_TOOLCHAIN     the Go toolchain folder (default: <root>/.toolchain; handy in a git worktree)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TC="${AULA_TOOLCHAIN:-$ROOT/.toolchain}"
SRC="$TC/src/libtailscale"
OUT="$HERE/Frameworks/TailscaleKit.xcframework"
LIBTAILSCALE_REF="${LIBTAILSCALE_REF:-ac7ed43af14e19e1c1810ee9f8319872c6beb412}"
# el identificador del framework: el de Aula, no el de Tailscale
BUNDLE_ID="com.luumlabs.aula.TailscaleKit"

if ! xcodebuild -version >/dev/null 2>&1; then
  echo "error: this needs the full Xcode (16.1 or newer), not just the Command Line Tools." >&2
  echo "Install Xcode from the App Store, open it once, then: sudo xcode-select -s /Applications/Xcode.app" >&2
  exit 1
fi
if [ ! -x "$TC/go/bin/go" ]; then
  echo "error: Go toolchain not found at $TC/go (run native/tsnet/build.sh first: it says how to get it)" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$TC/env.sh"

if [ ! -d "$SRC/.git" ]; then
  mkdir -p "$TC/src"
  git clone https://github.com/tailscale/libtailscale "$SRC"
fi
if [ "$(git -C "$SRC" rev-parse HEAD)" != "$LIBTAILSCALE_REF" ]; then
  git -C "$SRC" fetch --depth 1 origin "$LIBTAILSCALE_REF" || git -C "$SRC" fetch origin
  git -C "$SRC" checkout --detach "$LIBTAILSCALE_REF"
fi
echo "::: libtailscale @ $(git -C "$SRC" rev-parse HEAD)"

cd "$SRC"
# Aula's addition to the c-archive (see the file): no log uploads from the device.
cp "$HERE/tailscalekit/aula_nologs.go" "$SRC/aula_nologs.go"
export GOPROXY="${GOPROXY-off}"
export CGO_ENABLED=1
if [ "${SKIP_GO:-0}" != "1" ]; then
  echo "::: Building libtailscale_ios.a (iphoneos arm64)"
  # Go splits $CC on whitespace unless quoted; the path contains spaces.
  GOOS=ios GOARCH=arm64 CC="'$SRC/swift/script/clangwrap-ios.sh'" \
    go build -trimpath -ldflags -w -tags ios -buildmode=c-archive -o libtailscale_ios.a
  echo "::: Building libtailscale_ios_sim_arm64.a (iphonesimulator arm64)"
  GOOS=ios GOARCH=arm64 CC="'$SRC/swift/script/clangwrap-ios-sim-arm.sh'" \
    go build -trimpath -ldflags -w -tags ios -buildmode=c-archive -o libtailscale_ios_sim_arm64.a
  # The Xcode "TailscaleKit iOS Sim" target links ../libtailscale_ios_sim.a
  lipo -create -output libtailscale_ios_sim.a libtailscale_ios_sim_arm64.a
fi

cd "$SRC/swift"
mkdir -p build
echo "::: xcodebuild TailscaleKit (iOS)"
xcodebuild build -scheme "TailscaleKit (iOS)" \
  -derivedDataPath build \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=NO PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" \
  CODE_SIGNING_ALLOWED=NO -quiet
echo "::: xcodebuild TailscaleKit (Simulator)"
xcodebuild build -scheme "TailscaleKit (Simulator)" \
  -derivedDataPath build \
  -configuration Release \
  -destination 'generic/platform=iOS Simulator' \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=NO PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" \
  CODE_SIGNING_ALLOWED=NO -quiet

echo "::: Creating $OUT"
rm -rf "$OUT"
mkdir -p "$(dirname "$OUT")"
xcodebuild -create-xcframework \
  -framework "$SRC/swift/build/Build/Products/Release-iphoneos/TailscaleKit.framework" \
  -framework "$SRC/swift/build/Build/Products/Release-iphonesimulator/TailscaleKit.framework" \
  -output "$OUT"
# Debug symbols name the folders it was built in (the builder's home): the shipped framework carries none (the Go
# part already leaves its paths out with -trimpath).
for f in "$OUT"/*/TailscaleKit.framework/TailscaleKit; do strip -S "$f"; done
# cada framework, con su manifiesto de privacidad (en la raíz del bundle, como en iOS) y el identificador de Aula
for fw in "$OUT"/*/TailscaleKit.framework; do
  cp "$HERE/tailscalekit/PrivacyInfo.xcprivacy" "$fw/PrivacyInfo.xcprivacy"
  plutil -lint -s "$fw/PrivacyInfo.xcprivacy"
  id="$(plutil -extract CFBundleIdentifier raw "$fw/Info.plist")"
  if [ "$id" != "$BUNDLE_ID" ]; then
    echo "error: $fw has bundle id $id, expected $BUNDLE_ID" >&2
    exit 1
  fi
done

echo "::: License notices (Aula/Licenses.json)"
node "$HERE/scripts/licenses.mjs"

echo "::: Done"
for f in "$OUT"/*/TailscaleKit.framework/TailscaleKit; do
  echo "$f: $(lipo -archs "$f")"
done
ls "$OUT"/*/TailscaleKit.framework/PrivacyInfo.xcprivacy
