import { expect, test } from "bun:test"
import { BadShortcut, display, fromEvent } from "./keys.ts"

const press = (code: string, mods: string[] = []) =>
  ({ key: code.replace(/^Key/, ""), code, getModifierState: (m: string) => mods.includes(m) }) as unknown as KeyboardEvent

test("builds an accelerator in a fixed modifier order", () => {
  expect(fromEvent(press("KeyY", ["Meta", "Shift"]))).toBe("Shift+Command+KeyY")
  expect(fromEvent(press("Digit7", ["Alt", "Control"]))).toBe("Control+Alt+Digit7")
})

test("needs a modifier", () => {
  expect(() => fromEvent(press("KeyY"))).toThrow(BadShortcut)
})

test("refuses what macOS has already taken", () => {
  expect(() => fromEvent(press("Space", ["Meta"]))).toThrow(BadShortcut)
  expect(() => fromEvent(press("KeyQ", ["Meta"]))).toThrow(BadShortcut)
})

test("a held modifier alone is not a shortcut", () => {
  expect(() => fromEvent({ key: "Meta", code: "MetaLeft", getModifierState: () => true } as unknown as KeyboardEvent)).toThrow(BadShortcut)
})

test("renders glyphs", () => {
  expect(display("Command+Shift+KeyY")).toBe("⌘ ⇧ Y")
  expect(display("Control+Alt+Digit7")).toBe("⌃ ⌥ 7")
  expect(display("Command+ArrowUp")).toBe("⌘ ↑")
})
