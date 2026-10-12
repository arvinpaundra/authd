// RFC 6238 codes from WebCrypto: HMAC-SHA1 is built in, so this needs no dependency.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

export class BadKey extends Error {}

export const base32 = (text: string): Uint8Array => {
  let bits = ""
  for (const ch of text.replace(/[\s=-]/g, "").toUpperCase()) {
    const v = ALPHABET.indexOf(ch)
    if (v < 0) throw new BadKey("That key doesn't look right.")
    bits += v.toString(2).padStart(5, "0")
  }
  if (bits.length < 8) throw new BadKey("That key is too short.")
  const out = new Uint8Array(bits.length >> 3) // a trailing partial byte is padding
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2)
  return out
}

export const base32Encode = (bytes: Uint8Array): string => {
  let bits = ""
  for (const b of bytes) bits += b.toString(2).padStart(8, "0")
  let out = ""
  for (let i = 0; i < bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)]
  return out
}

const keyCache = new Map<string, Promise<CryptoKey>>()

const hmacKey = (secret: string): Promise<CryptoKey> => {
  let key = keyCache.get(secret)
  if (!key) {
    // Uint8Array<ArrayBufferLike> is not BufferSource on every lib.dom; the buffer always is.
    key = crypto.subtle.importKey("raw", base32(secret).buffer as ArrayBuffer, { name: "HMAC", hash: "SHA-1" }, false, ["sign"])
    keyCache.set(secret, key)
  }
  return key
}

export const forget = (secret: string): void => void keyCache.delete(secret)

export const counterAt = (now: number, period: number): number => Math.floor(now / 1000 / period)

export const secondsLeft = (now: number, period: number): number => period - ((now / 1000) % period)

export const codeAt = async (secret: string, counter: number, digits = 6): Promise<string> => {
  const msg = new Uint8Array(8)
  new DataView(msg.buffer).setBigUint64(0, BigInt(counter))
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), msg))
  const o = mac[19]! & 0xf // dynamic truncation: low nibble of the last byte picks the offset
  const n = ((mac[o]! & 0x7f) << 24) | (mac[o + 1]! << 16) | (mac[o + 2]! << 8) | mac[o + 3]!
  return String(n % 10 ** digits).padStart(digits, "0")
}

export const code = (secret: string, period = 30, digits = 6, now = Date.now()): Promise<string> =>
  codeAt(secret, counterAt(now, period), digits)
