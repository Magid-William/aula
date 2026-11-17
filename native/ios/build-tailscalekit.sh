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
#     privacy manifest (tailscalekit/PrivacyInfo.xcprivacy), as the App Store asks,
#   * each framework's debug symbols (TailscaleKit.framework.dSYM, made with dsymutil
#     before the binaries are stripped) go inside the xcframework (-debug-symbols), so
#     Xcode puts them in every archive and App Store Connect can symbolicate crashes;
#     a copy stays in Frameworks/TailscaleKit.dSYMs/<slice>/, and
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
# los dSYM de cada framework, junto al xcframework (git no los guarda, como a él)
DSYMS="$HERE/Frameworks/TailscaleKit.dSYMs"
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

PRODUCTS="$SRC/swift/build/Build/Products"
DEVICE_FW="$PRODUCTS/Release-iphoneos/TailscaleKit.framework"
SIM_FW="$PRODUCTS/Release-iphonesimulator/TailscaleKit.framework"

# los UUID (con su arquitectura) de un binario o un dSYM
uuids() { dwarfdump --uuid "$1" | awk '{print $2, $3}'; }
same_uuids() { # <binario> <dSYM>
  if [ "$(uuids "$1")" != "$(uuids "$2")" ]; then
    echo "error: $2 does not match $1 (dwarfdump --uuid)" >&2
    exit 1
  fi
}

# Los símbolos de depuración, ANTES de cualquier strip: dsymutil sigue el mapa de depuración del binario hasta los
# objetos, que siguen en las carpetas de compilación. El dSYM lleva el UUID del binario: así lo empareja App Store
# Connect con cada fallo.
echo "::: Debug symbols (dSYM) for each framework"
rm -rf "$DSYMS"
for slice in ios-arm64 ios-arm64-simulator; do
  fw="$DEVICE_FW"; [ "$slice" = ios-arm64-simulator ] && fw="$SIM_FW"
  mkdir -p "$DSYMS/$slice"
  dsymutil "$fw/TailscaleKit" -o "$DSYMS/$slice/TailscaleKit.framework.dSYM"
  same_uuids "$fw/TailscaleKit" "$DSYMS/$slice/TailscaleKit.framework.dSYM"
done

echo "::: Creating $OUT"
rm -rf "$OUT"
mkdir -p "$(dirname "$OUT")"
# -debug-symbols (con ruta absoluta) deja cada dSYM en <slice>/dSYMs/ del xcframework: Xcode lo copia junto a los de
# la app y a cada archivo (xcarchive)
xcodebuild -create-xcframework \
  -framework "$DEVICE_FW" -debug-symbols "$DSYMS/ios-arm64/TailscaleKit.framework.dSYM" \
  -framework "$SIM_FW" -debug-symbols "$DSYMS/ios-arm64-simulator/TailscaleKit.framework.dSYM" \
  -output "$OUT"
# El mapa de depuración del binario nombra las carpetas donde se compiló (la carpeta personal de quien compila): el
# framework que va en la app no lleva ninguno (la parte de Go ya las quita con -trimpath). strip -S conserva LC_UUID,
# así que los dSYM siguen valiendo. Los dSYM sí nombran esas carpetas, pero solo llegan a Apple dentro del archivo,
# nunca a la app.
for f in "$OUT"/*/TailscaleKit.framework/TailscaleKit; do strip -S "$f"; done
for slice in ios-arm64 ios-arm64-simulator; do
  same_uuids "$OUT/$slice/TailscaleKit.framework/TailscaleKit" "$OUT/$slice/dSYMs/TailscaleKit.framework.dSYM"
done
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
dwarfdump --uuid "$OUT"/*/dSYMs/TailscaleKit.framework.dSYM
