# authd — handoff

> Display name: **Authd**. Everywhere else (bundle id, dirs, binary, repo): `authd`.

## What it is
A macOS desktop TOTP client. Solves one annoyance: not having to unlock a phone
to copy a 2FA code.

## Stack (decided)
- Tauri v2 (Rust shell)
- TypeScript + HTML frontend
- Bun as package manager / dev runtime
- No Effect-TS. Plain async/await — too few async calls to pay for the machinery.
- Light mode only for v1. Clean and minimal, following the house style of the `float` app
  (system font, overlay panels, pill buttons, 38x22 switches, hairline borders).
  Hover / press states are black at low opacity — no second surface colour.

## Scope (decided)
1. **Import**
   - paste `otpauth://totp/...` URI or raw base32 secret
   - decode QR from an image (drag/drop or paste)
   - bulk import from Google Authenticator export: `otpauth-migration://offline?data=<b64 protobuf>`
2. **List view** — all items, live codes, countdown, actionable (copy, edit, delete, reorder)
3. **Global shortcut** — summon the list without opening the main app window (Maccy-style)
4. **Settings page** — appearance, shortcut binding, auto-start at login

## Platform (decided)
macOS only for v1, but nothing mac-specific leaks upward.

- The frontend never touches a platform API. It calls Tauri commands only, so it is already portable.
- Everything OS-specific sits behind two narrow Rust seams, each with one impl per platform
  selected by `#[cfg(target_os)]`:
  1. **secret store** — `list / put / delete` over opaque entries.
     mac = Keychain. Later: Linux = Secret Service, Windows = Credential Manager.
  2. **quick panel** — show / hide a non-activating window.
     mac = `tauri-nspanel`. Later: a plain always-on-top window elsewhere.
- Global shortcut and launch-at-login use the cross-platform Tauri plugins as-is.
- A non-mac build fails to compile rather than silently degrading, until someone writes that impl.

## Dependencies (decided)
Default answer is no. A dependency has to beat the lazy inline version on correctness, not
on convenience.

**Frontend: none.**
- No framework, no state library, no CSS framework, no Effect. Plain TS + HTML + CSS, bundled by Bun.
- **QR: no dep.** macOS Vision finds and reads the code anywhere in the picture, at any size and
  angle. `jsqr` was dropped: it scans a whole bitmap at one scale and cannot locate a code, so it
  needed a rescaling ladder and still failed on anything with transparency.
- **TOTP: no dep.** WebCrypto HMAC-SHA1 + ~15 lines of base32. Already written and tested
  against an RFC 6238 vector in `preview.html`. Replaces `otpauth`.
- **Google Authenticator import: no dep.** Decode the three protobuf fields by hand (~30 lines
  of varint parsing). Replaces `protobufjs`.
- **Clipboard: no dep.** `navigator.clipboard.writeText` works in WKWebView.

**Rust: five, one of them borderline.**
- `tauri` — the shell. Unavoidable.
- `keyring` — the secret store seam. One crate covers Keychain, Secret Service and Credential
  Manager, so it is less code than writing a mac-only impl by hand.
  Never shell out to `/usr/bin/security`: the secret would land in argv, visible to `ps`.
- `tauri-plugin-global-shortcut` — official. Hand-rolling `RegisterEventHotKey` is not worth it.
- `objc2`, `objc2-foundation`, `objc2-vision` — the QR seam, macOS only.
- `tauri-plugin-autostart` — borderline. Writing a `~/Library/LaunchAgents` plist is ~20 lines
  with no dep; drop the plugin if it misbehaves.
- `tauri-nspanel` — not pulled in yet; the panel is a plain always-on-top window for now.

`preview.html` itself has zero dependencies and makes no network requests at all.

## Security posture (decided)
- Never persist generated codes. Never log them. No telemetry, no network calls at all.
- Seeds MUST be persisted (a TOTP app cannot work otherwise) → macOS Keychain, not a JSON file.
- No cloud sync in v1.

## Known hard / impossible constraints
See the "impossible things" section — recorded in the originating conversation:
1. Cannot read seeds from a Google account. Only the one-time export QR works.
2. "Store nothing sensitive" is impossible for the seed itself. Keychain is the mitigation.
3. Stock Tauri windows steal focus → need `tauri-nspanel` (Rust, community plugin) for a
   non-activating panel.
4. Auto-paste into another app needs macOS Accessibility permission + native event synthesis.
   v1 = clipboard only.
5. Camera QR scanning in WKWebView is unreliable. v1 = decode QR from image/screenshot.
6. macOS Secure Input Mode (focused password fields) can swallow global hotkeys.
7. Reserved system shortcuts (Cmd+Space, Cmd+Tab) will fail to register — need error surfacing.

## Status
v1 implemented and running. `preview.html` is kept as the design reference.

```
ui/ts/totp.ts      RFC 6238 + base32            (bun test)
ui/ts/otpauth.ts   links in/out, GA export      (bun test)
ui/ts/keys.ts      shortcut capture             (bun test)
ui/ts/store.ts     vault over the Tauri commands
ui/ts/main.ts      both windows
ui/src/index.html  markup + CSS
tauri/src/store.rs secret store seam (keyring)
tauri/src/qr.rs     QR seam (Vision)             (cargo test)
tauri/src/panel.rs quick panel seam
tauri/src/lib.rs   commands, shortcut, window events
```

`bun run dev` builds the frontend and runs the shell. `bun test` is 19 tests, `cargo test` is 2,
`bun run typecheck` is clean.

Not done yet:
- QR reading is macOS only; the seam returns an error elsewhere
- real `NSPanel` (the panel is always-on-top and takes focus while open)
- the panel does not follow a reorder until it is reopened
- no app menu, so ⌘Q/⌘W/⌘, are the system defaults only
- never been signed or notarised; `signingIdentity` is ad-hoc
