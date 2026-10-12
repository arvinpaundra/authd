#!/usr/bin/env bash
# Build a macOS authd release: checks → universal .app → dist/v<version>/{authd-<version>-darwin-universal.zip,
# manifest.json} (+ the .dmg). install.sh consumes exactly those two files from the GitHub release.
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=""
RUN_CHECKS=1
PUBLISH=0
INSTALL=0
SIGN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-checks) RUN_CHECKS=0; shift ;;
    --install) INSTALL=1; shift ;;
    --publish) PUBLISH=1; shift ;;
    --sign) SIGN="${2:?--sign needs \"Developer ID Application: Name (TEAMID)\"}"; shift 2 ;;
    --version) VERSION="${2:?--version needs a version like 0.1.0}"; shift 2 ;;
    --help|-h)
      cat <<'EOF'
Usage: scripts/release.sh [--version X.Y.Z] [--no-checks] [--sign "<Developer ID>"] [--install] [--publish]

  --version   version to build (default: the latest git tag; releases come from tags, not files)
  --no-checks skip typecheck and tests
  --sign      sign with a Developer ID (needs APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID to notarize)
  --install   install the built app into ~/Applications
  --publish   create GitHub release v<version> with the zip, manifest.json and dmg (needs gh)
EOF
      exit 0
      ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

# The git tag is the single source of truth: nothing to bump in files, nothing to keep in sync.
VERSION="${VERSION:-$(git describe --tags --abbrev=0 2>/dev/null || true)}"
VERSION="${VERSION#v}"
[[ -n "$VERSION" ]] || VERSION="0.0.0-dev"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]] || { echo "Not a version: $VERSION" >&2; exit 1; }

echo "==> authd $VERSION"
bun install --frozen-lockfile

if [[ "$RUN_CHECKS" == "1" ]]; then
  echo "==> Typechecking"
  bun run typecheck
  echo "==> Testing"
  bun run test
  (cd tauri && cargo test)
fi

echo "==> Building universal app (Apple Silicon + Intel)"
rustup target list --installed | grep -q x86_64-apple-darwin || rustup target add x86_64-apple-darwin
args=(build --target universal-apple-darwin --config "{\"version\":\"$VERSION\"}")
[[ -n "$SIGN" ]] && args+=(--config "{\"bundle\":{\"macOS\":{\"signingIdentity\":\"$SIGN\"}}}")
# CI=true: skip the Finder AppleScript that styles the DMG window (it fails without a GUI session)
CI=true bun run tauri "${args[@]}"

bundle="tauri/target/universal-apple-darwin/release/bundle"
out="dist/v$VERSION"
asset="authd-$VERSION-darwin-universal.zip"
rm -rf "$out" && mkdir -p "$out"

echo "==> Packaging $out/$asset"
ditto -c -k --sequesterRsrc --keepParent "$bundle/macos/Authd.app" "$out/$asset"
cp "$bundle"/dmg/*.dmg "$out/"
scripts/manifest.sh "$VERSION" "$out/$asset" > "$out/manifest.json"
ls -lh "$out"

if [[ "$INSTALL" == "1" ]]; then
  echo "==> Installing locally"
  local_releases="$(mktemp -d)"
  mkdir -p "$local_releases/download"
  ln -s "$PWD/$out" "$local_releases/download/v$VERSION"
  AUTHD_RELEASES="file://$local_releases" ./install.sh "$VERSION"
  rm -rf "$local_releases"
fi

if [[ "$PUBLISH" == "1" ]]; then
  echo "==> Publishing GitHub release v$VERSION"
  command -v gh >/dev/null || { echo "gh (GitHub CLI) is required for --publish" >&2; exit 1; }
  gh release create "v$VERSION" "$out/$asset" "$out/manifest.json" "$out"/*.dmg \
    --title "v$VERSION" --generate-notes
fi

echo "==> Done: $out"
