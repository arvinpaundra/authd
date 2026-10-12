// ponytail: the whole vault is one entry in the secret store, not one per account. A TOTP list
// is read and written whole, so per-account entries would only add a migration.

import { invoke } from "@tauri-apps/api/core"
import type { Account } from "./otpauth.ts"

export type Settings = {
  mask: boolean
  shortcut: string
  autostart: boolean
  clipboardSeconds: number
}

export type Vault = { accounts: Account[]; settings: Settings }

export const DEFAULTS: Settings = {
  mask: false,
  shortcut: "Command+Shift+KeyY",
  autostart: false,
  clipboardSeconds: 30,
}

const isAccount = (v: unknown): v is Account => {
  const a = v as Account
  return !!a && typeof a.secret === "string" && typeof a.issuer === "string"
}

export const load = async (): Promise<Vault> => {
  const raw = await invoke<string | null>("vault_load")
  if (!raw) return { accounts: [], settings: { ...DEFAULTS } }
  const parsed = JSON.parse(raw) as Partial<Vault>
  return {
    accounts: (parsed.accounts ?? []).filter(isAccount).map((a) => ({
      ...a,
      label: a.label ?? "",
      period: a.period || 30,
      digits: a.digits || 6,
    })),
    settings: { ...DEFAULTS, ...parsed.settings },
  }
}

let pending: ReturnType<typeof setTimeout> | undefined

/** Debounced: a slider drag or a reorder would otherwise hit the Keychain on every frame. */
export const save = (vault: Vault): void => {
  clearTimeout(pending)
  pending = setTimeout(() => void invoke("vault_save", { json: JSON.stringify(vault) }), 150)
}

export const setShortcut = (accelerator: string): Promise<void> => invoke("set_shortcut", { accelerator })
export const setAutostart = (on: boolean): Promise<void> => invoke("set_autostart", { on })
export const exportLinks = (text: string): Promise<string> => invoke("export_links", { text })
export const copyCode = (text: string): Promise<void> => invoke("copy_code", { text })
export const clearCode = (expected: string): Promise<void> => invoke("clear_code", { expected })
export const hidePanel = (): Promise<void> => invoke("hide_panel")

// Vision finds and reads the code wherever it is in the picture, so the webview just hands
// over the bytes. A number array rather than a Uint8Array: that is what the IPC carries.
export const scanQR = (bytes: Uint8Array): Promise<string | null> =>
  invoke("scan_qr", { image: Array.from(bytes) })
