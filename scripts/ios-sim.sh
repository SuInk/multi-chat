#!/bin/sh
# 构建 iOS 模拟器版并安装到已启动的模拟器。
# `tauri ios build` 要求模拟器运行时版本和 Xcode SDK 完全一致，不一致时会直接报错；
# 这里改为手动编译 Rust 库，再交给 xcodebuild 打包，任意已安装的模拟器都能用。
set -e
cd "$(dirname "$0")/.."

DEVICE="${1:-booted}"
pnpm build
(cd src-tauri && cargo build --target aarch64-apple-ios-sim --lib --features tauri/custom-protocol)
mkdir -p src-tauri/gen/apple/Externals/arm64/debug
cp src-tauri/target/aarch64-apple-ios-sim/debug/libmulti_chat_lib.a src-tauri/gen/apple/Externals/arm64/debug/libapp.a

# Xcode 工程里的「Build Rust Code」步骤需要 tauri CLI 在旁边运行，这里 Rust 库已备好，用一个临时 pnpm 跳过它
SHIM="$(mktemp -d)"
REAL_PNPM="$(command -v pnpm)"
printf '#!/bin/sh\n[ "$1 $2 $3" = "tauri ios xcode-script" ] && exit 0\nexec "%s" "$@"\n' "$REAL_PNPM" > "$SHIM/pnpm"
chmod +x "$SHIM/pnpm"

UDID="$(xcrun simctl list devices booted | grep -oE '[0-9A-F-]{36}' | head -1)"
[ -n "$UDID" ] || { echo "请先启动一个 iOS 模拟器"; exit 1; }
(cd src-tauri/gen/apple && PATH="$SHIM:$PATH" xcodebuild -project multi-chat.xcodeproj -scheme multi-chat_iOS \
  -configuration debug -sdk iphonesimulator -destination "id=$UDID" -derivedDataPath build/dd \
  ARCHS=arm64 CODE_SIGNING_ALLOWED=NO build -quiet)
rm -rf "$SHIM"

xcrun simctl install "$DEVICE" src-tauri/gen/apple/build/dd/Build/Products/debug-iphonesimulator/multi-chat.app
xcrun simctl launch "$DEVICE" io.github.suink.multichat
