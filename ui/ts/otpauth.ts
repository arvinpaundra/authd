import { base32, base32Encode, BadKey } from "./totp.ts"

export type Account = {
  issuer: string
  label: string
  secret: string
  period: number
  digits: number
}

export class BadLink extends Error {}

const clamp = (n: number, fallback: number, lo: number, hi: number): number =>
  Number.isFinite(n) && n >= lo && n <= hi ? n : fallback

export const parse = (raw: string): Account => {
  const text = raw.trim()
  if (!text) throw new BadLink("Nothing to add.")

  let account: Account
  if (!text.toLowerCase().startsWith("otpauth://")) {
    account = { issuer: "Unknown", label: "", secret: text.replace(/\s/g, ""), period: 30, digits: 6 }
  } else {
    const url = new URL(text)
    if (url.host.toLowerCase() === "hotp") throw new BadLink("Counter-based codes aren't supported.")
    if (url.host.toLowerCase() !== "totp") throw new BadLink("That isn't a code link.")
    const path = decodeURIComponent(url.pathname.replace(/^\//, ""))
    const [prefix, rest] = path.includes(":") ? path.split(/:(.+)/) : [undefined, path]
    const secret = url.searchParams.get("secret")
    if (!secret) throw new BadLink("That link has no key in it.")
    const algorithm = url.searchParams.get("algorithm")
    if (algorithm && algorithm.toUpperCase() !== "SHA1") throw new BadLink(`${algorithm} codes aren't supported.`)
    account = {
      issuer: url.searchParams.get("issuer") || prefix || "Unknown",
      label: rest ?? "",
      secret,
      period: clamp(Number(url.searchParams.get("period") ?? 30), 30, 1, 300),
      digits: clamp(Number(url.searchParams.get("digits") ?? 6), 6, 6, 10),
    }
  }
  base32(account.secret) // throws BadKey, which the caller shows as-is
  return account
}

export const toLink = (a: Account): string =>
  `otpauth://totp/${encodeURIComponent(a.issuer + (a.label ? `:${a.label}` : ""))}` +
  `?secret=${a.secret}&issuer=${encodeURIComponent(a.issuer)}` +
  (a.digits === 6 ? "" : `&digits=${a.digits}`) +
  (a.period === 30 ? "" : `&period=${a.period}`)

// Google Authenticator export: otpauth-migration://offline?data=<base64 protobuf>.
// Hand-decoded instead of pulling in protobufjs. The fields we read:
//   MigrationPayload { repeated OtpParameters otp_parameters = 1 }
//   OtpParameters { bytes secret = 1, string name = 2, string issuer = 3,
//                   Algorithm algorithm = 4, DigitCount digits = 5, OtpType type = 6 }

type Field = { no: number; wire: number; varint: number; bytes: Uint8Array }

function* fields(buf: Uint8Array): Generator<Field> {
  let i = 0
  const varint = (): number => {
    let value = 0
    let shift = 0
    for (;;) {
      const byte = buf[i++]
      if (byte === undefined) throw new BadLink("That export is cut short.")
      value += (byte & 0x7f) * 2 ** shift // not <<: the shift can exceed 31
      if (!(byte & 0x80)) return value
      shift += 7
    }
  }
  while (i < buf.length) {
    const tag = varint()
    const [no, wire] = [tag >>> 3, tag & 7]
    if (wire === 0) yield { no, wire, varint: varint(), bytes: new Uint8Array() }
    else if (wire === 2) {
      const len = varint()
      if (i + len > buf.length) throw new BadLink("That export is cut short.")
      yield { no, wire, varint: 0, bytes: buf.subarray(i, i + len) }
      i += len
    } else if (wire === 5) i += 4
    else if (wire === 1) i += 8
    else throw new BadLink("That export isn't readable.")
  }
}

const text = new TextDecoder()

export const fromExport = (raw: string): Account[] => {
  const url = new URL(raw.trim())
  if (url.protocol !== "otpauth-migration:") throw new BadLink("That isn't an export link.")
  const data = url.searchParams.get("data")
  if (!data) throw new BadLink("That export link has no data in it.")

  let payload: Uint8Array
  try {
    payload = Uint8Array.from(atob(data.replace(/ /g, "+")), (c) => c.charCodeAt(0))
  } catch {
    throw new BadLink("That export link is damaged.")
  }

  const out: Account[] = []
  let skipped = 0
  for (const entry of fields(payload)) {
    if (entry.no !== 1 || entry.wire !== 2) continue
    let secret = ""
    let name = ""
    let issuer = ""
    let digits = 6
    let totp = true
    for (const f of fields(entry.bytes)) {
      if (f.no === 1) secret = base32Encode(f.bytes)
      else if (f.no === 2) name = text.decode(f.bytes)
      else if (f.no === 3) issuer = text.decode(f.bytes)
      else if (f.no === 4 && f.varint > 1) totp = false // only SHA1 is in scope
      else if (f.no === 5) digits = f.varint === 2 ? 8 : 6
      else if (f.no === 6 && f.varint !== 2) totp = false // 1 = HOTP
    }
    if (!totp || !secret) {
      skipped++
      continue
    }
    try {
      base32(secret)
    } catch (e) {
      if (!(e instanceof BadKey)) throw e
      skipped++
      continue
    }
    // the export packs "Issuer:name" into name when it carries no issuer field
    const [prefix, rest] = name.includes(":") ? name.split(/:(.+)/) : [undefined, name]
    out.push({ issuer: issuer || prefix || "Unknown", label: rest ?? "", secret, period: 30, digits })
  }
  if (!out.length) throw new BadLink(skipped ? "Nothing in that export can be imported." : "That export is empty.")
  return out
}
