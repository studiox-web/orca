#!/usr/bin/env bash
# Build the XOS fork AppImage. Upstream cuts releases on a side branch, so main's
# package.json version lags; stamp the build as <latest upstream release>+xos.<commit>
# so version gates (plugin engines, daemon handshakes) match the code we ship.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$REPO"
source "$HOME/.nvm/nvm.sh" >/dev/null
nvm use 24 >/dev/null

BASE="$(git ls-remote --tags --refs upstream 'v*' | sed 's|.*refs/tags/v||' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)"
VERSION="${BASE}+xos.$(git rev-parse --short HEAD)"

restore() { git checkout -- package.json; }
trap restore EXIT
node -e "const f='package.json',p=require('./'+f);p.version=process.argv[1];require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\n')" "$VERSION"

echo "Building Orca $VERSION"
pnpm -C mobile install --frozen-lockfile >/dev/null
pnpm run build:desktop
pnpm run ensure:electron-runtime
pnpm exec electron-builder --config config/electron-builder.config.cjs --linux AppImage --x64
echo "Built $(ls -t dist/*.AppImage | head -1) as $VERSION"
