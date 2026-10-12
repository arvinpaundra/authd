import { expect, test } from "bun:test"
import { BadLink, fromExport, parse, toLink } from "./otpauth.ts"
import { BadKey } from "./totp.ts"

test("parses a full link", () => {
  const a = parse("otpauth://totp/GitHub:you@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&digits=8&period=60")
  expect(a).toEqual({ issuer: "GitHub", label: "you@example.com", secret: "JBSWY3DPEHPK3PXP", period: 60, digits: 8 })
})

test("falls back to the path prefix, then to Unknown", () => {
  expect(parse("otpauth://totp/Stripe:live?secret=JBSWY3DPEHPK3PXP").issuer).toBe("Stripe")
  expect(parse("otpauth://totp/?secret=JBSWY3DPEHPK3PXP").issuer).toBe("Unknown")
})

test("takes a bare key", () => {
  expect(parse("  jbswy3dp ehpk3pxp ").secret).toBe("jbswy3dpehpk3pxp")
})

test("refuses what it cannot generate", () => {
  expect(() => parse("otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=1")).toThrow(BadLink)
  expect(() => parse("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256")).toThrow(BadLink)
  expect(() => parse("otpauth://totp/x")).toThrow(BadLink)
  expect(() => parse("otpauth://totp/x?secret=!!!")).toThrow(BadKey)
  expect(() => parse("")).toThrow(BadLink)
})

test("out of range period and digits fall back", () => {
  const a = parse("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&period=0&digits=99")
  expect([a.period, a.digits]).toEqual([30, 6])
})

test("a link survives the round trip", () => {
  const a = parse("otpauth://totp/Amazon:root%20%C2%B7%20prod?secret=JBSWY3DPEHPK3PXP&issuer=Amazon&digits=8")
  expect(parse(toLink(a))).toEqual(a)
})

// Built with the same wire format Google Authenticator exports.
const payload = (...entries: Array<{ secret: number[]; name: string; issuer: string; digits?: number; type?: number }>) => {
  const bytes: number[] = []
  const str = (s: string) => [...new TextEncoder().encode(s)]
  for (const e of entries) {
    const body = [
      0x0a, e.secret.length, ...e.secret,
      0x12, str(e.name).length, ...str(e.name),
      0x1a, str(e.issuer).length, ...str(e.issuer),
      0x20, 1,
      0x28, e.digits ?? 1,
      0x30, e.type ?? 2,
    ]
    bytes.push(0x0a, body.length, ...body)
  }
  bytes.push(0x10, 1) // version = 1
  return "otpauth-migration://offline?data=" + btoa(String.fromCharCode(...bytes))
}

test("imports an export", () => {
  const accounts = fromExport(payload(
    { secret: [72, 101, 108, 108, 111], name: "you@example.com", issuer: "GitHub" },
    { secret: [72, 101, 108, 108, 111], name: "Stripe:live", issuer: "", digits: 2 },
  ))
  expect(accounts).toEqual([
    { issuer: "GitHub", label: "you@example.com", secret: "JBSWY3DP", period: 30, digits: 6 },
    { issuer: "Stripe", label: "live", secret: "JBSWY3DP", period: 30, digits: 8 },
  ])
})

test("skips entries it cannot generate, and says so when none are left", () => {
  expect(() => fromExport(payload({ secret: [1, 2, 3, 4, 5], name: "x", issuer: "y", type: 1 }))).toThrow(BadLink)
})

test("rejects damaged or foreign export links", () => {
  expect(() => fromExport("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP")).toThrow(BadLink)
  expect(() => fromExport("otpauth-migration://offline")).toThrow(BadLink)
  expect(() => fromExport("otpauth-migration://offline?data=%%%")).toThrow(BadLink)
})
