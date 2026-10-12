const GLYPH: Record<string, string> = { Control: "⌃", Alt: "⌥", Shift: "⇧", Command: "⌘" }
const ORDER = ["Control", "Alt", "Shift", "Command"] as const
const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta"])

/** macOS owns these; registering one fails, so refuse it while it can still be explained. */
const RESERVED = new Set([
  "Command+Space",
  "Command+Tab",
  "Command+KeyQ",
  "Command+KeyW",
  "Command+KeyH",
  "Command+KeyM",
  "Command+Shift+Digit3",
  "Command+Shift+Digit4",
  "Command+Shift+Digit5",
  "Command+Control+Space",
])

export class BadShortcut extends Error {}

export const fromEvent = (e: KeyboardEvent): string => {
  if (MODIFIER_KEYS.has(e.key)) throw new BadShortcut("Hold the modifiers, then press a key.")
  const mods = ORDER.filter((m) => e.getModifierState(m === "Command" ? "Meta" : m))
  if (!mods.length) throw new BadShortcut("Hold ⌘ or ⌥ as well.")
  const accelerator = [...mods, e.code].join("+")
  if (RESERVED.has(accelerator)) throw new BadShortcut("That one is already taken.")
  return accelerator
}

const label = (code: string): string =>
  code.replace(/^(Key|Digit|Numpad)/, "").replace(/^(Arrow)?(Up|Down|Left|Right)$/, (_, _a, d: string) =>
    ({ Up: "↑", Down: "↓", Left: "←", Right: "→" })[d] ?? d,
  )

export const display = (accelerator: string): string => {
  const parts = accelerator.split("+")
  const code = parts.pop() ?? ""
  return [...parts.map((m) => GLYPH[m] ?? m), label(code)].join(" ")
}
