# authd

A desktop TOTP client for macOS. It exists so you never have to unlock a phone to copy a 2FA code.

Keys live in the **Keychain**. Codes are generated on the spot, never written to disk, never logged.
The app makes **no network requests at all** — there is no sync, no account, no telemetry.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/arvinpaundra/authd/master/install.sh | bash
```

Verifies the release SHA-256 and installs `Authd.app` into `~/Applications`, no sudo. Pin a version
with `| bash -s -- 0.1.0`, remove with `| bash -s -- --uninstall` (your Keychain entry is kept).

macOS 14 or newer, Apple Silicon or Intel.

## Using it

**The list.** Every account with its live code and a countdown ring. Click a row to copy. Swipe a row
left — drag it, or two fingers on the trackpad — for Edit and Remove. Drag a row up or down to reorder.
`/` focuses the search box.

**Adding.** One box takes any of three things, and works out which it got:

| You paste | What happens |
|---|---|
| `JBSWY3DPEHPK3PXP` | added with the name you typed above |
| `otpauth://totp/…` | name, label, digits and period come from the link |
| `otpauth-migration://…` | every account in the export, duplicates skipped |

A QR works too: drop the image, click to choose a file, or paste a screenshot straight into the box.
A Google Authenticator export QR imports the whole batch.

**The quick panel.** ⌘⇧Y summons a compact list over whatever you are doing. `↑↓` to move, `↵` to copy,
`1`–`9` to jump straight to one, `esc` to dismiss. Copying closes it.

**Settings.** Reveal-on-hover for the codes, the shortcut, open-at-login, and how long a copied code
stays on the clipboard before it is wiped (only if it is still your code there).

## How it works

```
secret ─base32─▶ bytes ─HMAC-SHA1(counter = now/30)─▶ truncate ─▶ 6 digits
                                                                    │
  Keychain ◀── one JSON blob ── accounts + settings                 ▼
  (dev.authd.app/vault)                                     redrawn 4×/second
```

The code is a pure function of the secret and the clock, which is why nothing has to be stored except
the secrets. `ui/ts/totp.ts` is that function and is pinned to the RFC 6238 test vectors.

The webview never touches a platform API. It calls commands, and everything OS-specific sits behind one
small seam each:

| Seam | macOS |
|---|---|
| `tauri/src/store.rs` | Keychain, via `keyring` |
| `tauri/src/qr.rs` | Vision — finds the code anywhere in a screenshot, at any size or angle |
| `tauri/src/panel.rs` | the quick-panel window |
| clipboard | NSPasteboard, because WebKit only allows a write inside a user gesture |

## Develop

Needs [Rust](https://rustup.rs) and [bun](https://bun.sh).

```sh
bun install
bun run dev        # build the frontend, then run the shell
bun run test       # 19 tests: TOTP vectors, parsing, the export decoder, shortcuts
bun run typecheck
cd tauri && cargo test   # the QR seam against a real export QR
```

Layout:

```
ui/ts/     totp.ts  otpauth.ts  keys.ts  store.ts  main.ts
ui/src/    index.html (markup + CSS; the bundle lands in ui/src/js)
tauri/src/ lib.rs  store.rs  qr.rs  panel.rs
preview.html   the design reference, a standalone page with no dependencies
```

Two npm packages, neither at runtime; five cargo crates. No framework, no state library, no CSS
framework. See `HANDOFF.md` for why each one is there and what was deliberately left out.

## Release

```sh
git tag v0.1.0 && git push origin v0.1.0
```

The tag is the version — nothing in the repo stores it. CI builds a universal `.app`, zips it, writes
`manifest.json` and publishes the release that `install.sh` reads. Locally: `scripts/release.sh --publish`.

Builds are **ad-hoc signed, not notarised**, so the installer strips the quarantine flag. Sign properly
with `scripts/release.sh --sign "Developer ID Application: … (TEAMID)"`.

## Known limits

- Seeds cannot be read out of a Google account. Only the one-time export QR works.
- The quick panel takes keyboard focus while open; a real `NSPanel` would not.
- macOS Secure Input Mode (a focused password field) can swallow the global shortcut.
- Reserved system shortcuts (⌘Space, ⌘Tab …) are refused when you record one.
- No auto-paste into other apps: that needs Accessibility permission. Clipboard only.
