/** ULID (https://github.com/ulid/spec): 48-bit time + 80 random bits, Crockford base32. DATA-8 `id`. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function ulid(now: number = Date.now()): string {
  let time = ''
  let t = now
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time
    t = Math.floor(t / 32)
  }
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let rand = ''
  for (let i = 0; i < 16; i++) rand += ALPHABET[bytes[i] % 32]
  return time + rand
}

export function isUlid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value)
}

/** The time encoded in a ULID, in ms since epoch. */
export function ulidTime(id: string): number {
  let t = 0
  for (let i = 0; i < 10; i++) t = t * 32 + ALPHABET.indexOf(id[i])
  return t
}
