import { expect, test } from "bun:test"
import { BadKey, base32, code, codeAt, secondsLeft } from "./totp.ts"

// RFC 6238 appendix B, the SHA-1 rows. The seed there is ASCII "12345678901234567890".
const SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

test("RFC 6238 vectors", async () => {
  for (const [time, want] of [[59, "94287082"], [1111111109, "07081804"], [1234567890, "89005924"], [2000000000, "69279037"]] as const) {
    expect(await codeAt(SEED, Math.floor(time / 30), 8)).toBe(want)
  }
})

test("digits and period come through", async () => {
  expect(await code(SEED, 30, 6, 59_000)).toBe("287082")
  expect(await code(SEED, 60, 8, 59_000)).toBe(await codeAt(SEED, 0, 8))
})

test("base32 tolerates padding, spaces and dashes", () => {
  expect(base32("JBSWY3DP")).toEqual(new Uint8Array([72, 101, 108, 108, 111]))
  expect(base32("jbsw y3dp")).toEqual(base32("JBSWY3DP"))
  expect(base32("ONSWG4TFOQ======")).toEqual(base32("onswg4tfoq"))
})

test("base32 rejects junk", () => {
  expect(() => base32("not!valid")).toThrow(BadKey)
  expect(() => base32("A")).toThrow(BadKey)
})

test("secondsLeft walks down the period", () => {
  expect(secondsLeft(0, 30)).toBe(30)
  expect(secondsLeft(29_000, 30)).toBe(1)
})
