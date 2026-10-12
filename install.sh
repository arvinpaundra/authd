#!/usr/bin/env bash
# authd installer — downloads a release, verifies its SHA-256, installs Authd.app.
#
#   curl -fsSL https://raw.githubusercontent.com/arvinpaundra/authd/master/install.sh | bash
#   curl -fsSL …/install.sh | bash -s -- 0.1.0        # a specific version
#   curl -fsSL …/install.sh | bash -s -- --uninstall
#
# Installs to ~/Applications, no sudo. Env overrides: AUTHD_INSTALL_DIR, AUTHD_RELEASES.
set -euo pipefail

REPO="arvinpaundra/authd"
RELEASES="${AUTHD_RELEASES:-https://github.com/$REPO/releases}"
INSTALL_DIR="${AUTHD_INSTALL_DIR:-$HOME/Applications}"
TARGET="$INSTALL_DIR/Authd.app"
MIN_MACOS=14

die() { echo "Error: $*" >&2; exit 1; }

VERSION="latest"
UNINSTALL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --uninstall) UNINSTALL=1; shift ;;
    --help|-h) echo "Usage: install.sh [latest|VERSION] [--uninstall]"; exit 0 ;;
    latest) VERSION="latest"; shift ;;
    v*|[0-9]*) VERSION="${1#v}"; shift ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
done

[[ "$(uname -s)" == "Darwin" ]] || die "authd is macOS only for now."
[[ "$(sw_vers -productVersion | cut -d. -f1)" -ge "$MIN_MACOS" ]] || die "needs macOS $MIN_MACOS or newer."

quit_running() { pkill -f "$TARGET/Contents/MacOS/authd" 2>/dev/null && sleep 1 || true; }

if [[ "$UNINSTALL" == "1" ]]; then
  [[ -e "$TARGET" ]] || { echo "authd is not installed in $INSTALL_DIR"; exit 0; }
  quit_running
  rm -rf "$TARGET"
  echo "==> Removed $TARGET"
  echo "    Your keys are still in the Keychain under 'dev.authd.app'."
  echo "    Remove them in Keychain Access, or: security delete-generic-password -s dev.authd.app"
  exit 0
fi

# ---- manifest: version, asset name, checksum ----
if [[ "$VERSION" == "latest" ]]; then base="$RELEASES/latest/download"; else base="$RELEASES/download/v$VERSION"; fi
manifest="$(curl -fsSL "$base/manifest.json")" || die "could not download $base/manifest.json"

field() {
  local key="$1" json block re
  if command -v jq >/dev/null; then
    jq -r --arg k "$key" '(.platforms["darwin-universal"][$k] // .[$k]) // empty' <<<"$manifest"
    return 0
  fi
  json="$(tr -d '\n\r\t' <<<"$manifest")"
  block="${json#*\"darwin-universal\"}"
  block="${block%%\}*}"
  re="\"$key\"[[:space:]]*:[[:space:]]*\"?([^\",}]*)"
  if [[ -n "$block" && "$block" =~ $re ]]; then echo "${BASH_REMATCH[1]}"
  elif [[ "$json" =~ $re ]]; then echo "${BASH_REMATCH[1]}"; fi
  return 0
}
version="$(field version)"
asset="$(field asset)"
checksum="$(field sha256)"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]] || die "manifest has no valid version (got: ${version:-nothing})."
[[ "$asset" =~ ^[A-Za-z0-9._-]+$ ]] || die "manifest has no valid asset name."
[[ "$checksum" =~ ^[a-f0-9]{64}$ ]] || die "manifest has no valid SHA-256."

# ---- download + verify ----
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
echo "==> Downloading authd $version"
curl -fL --progress-bar -o "$tmp/$asset" "$base/$asset" || die "download failed: $base/$asset"
actual="$(shasum -a 256 "$tmp/$asset" | cut -d' ' -f1)"
[[ "$actual" == "$checksum" ]] || die "checksum verification failed (expected $checksum, got $actual)."
echo "==> Checksum verified"

# ---- install ----
mkdir -p "$INSTALL_DIR"
quit_running
ditto -x -k "$tmp/$asset" "$tmp/unpacked"
[[ -d "$tmp/unpacked/Authd.app" ]] || die "archive does not contain Authd.app."
codesign --verify --deep "$tmp/unpacked/Authd.app" 2>/dev/null || die "Authd.app signature is broken."
rm -rf "$TARGET"
ditto "$tmp/unpacked/Authd.app" "$TARGET"
# Ad-hoc signed, so Gatekeeper would otherwise refuse a downloaded build outright.
xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null || true

echo ""
echo "✅ Installed authd $version to $TARGET"
echo "   Open it with:  open \"$TARGET\""
echo "   Keys are stored in your Keychain; nothing ever leaves the machine."
