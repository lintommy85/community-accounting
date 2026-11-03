#!/bin/sh
# Mac 測試用：重新編譯 Mac 版啟動程式，資料存在 dev-app/data（與 Windows 版相同的資料夾結構）。
set -e
cd "$(dirname "$0")/.."
npm run --silent launcher:mac >/dev/null
mkdir -p dev-app
LEDGER_APP_DIR="$PWD/dev-app" exec ./launcher/build/community-ledger-mac
