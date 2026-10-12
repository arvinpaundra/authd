#!/usr/bin/env bash
# Write the release manifest install.sh reads: scripts/manifest.sh <version> <file>... > manifest.json
set -euo pipefail

version="${1:?usage: manifest.sh <version> <file>...}"
shift
[[ $# -gt 0 ]] || { echo "manifest.sh: no files given" >&2; exit 2; }

sha_of() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
size_of() { if stat -f%z "$1" >/dev/null 2>&1; then stat -f%z "$1"; else stat -c%s "$1"; fi; }

entries=""
for f in "$@"; do
  name="$(basename "$f")"
  case "$name" in
    *darwin-universal.zip) platform="darwin-universal" ;;
    *) continue ;; # the dmg is published but never installed from
  esac
  entries+="${entries:+,}
    \"$platform\": { \"asset\": \"$name\", \"sha256\": \"$(sha_of "$f")\", \"size\": $(size_of "$f") }"
done
[[ -n "$entries" ]] || { echo "manifest.sh: none of the files look like an authd build" >&2; exit 1; }

cat <<EOF
{
  "version": "$version",
  "minimumSystemVersion": "14.0",
  "platforms": {${entries}
  }
}
EOF
