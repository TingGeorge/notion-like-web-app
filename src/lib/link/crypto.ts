/**
 * Device linking payload (LINK-1, SEC-8).
 *
 * CONTRACT — implemented in this folder.
 * Payload: `ghnotes:1:<salt>.<iv>.<ciphertext>`, all base64url (no padding).
 * Ciphertext: AES-GCM of the UTF-8 JSON `{"o","r","b","t","e"}`.
 * Key: PBKDF2-SHA-256 of the pairing code (normalised, without the dash), 600,000 iterations, 16-byte salt.
 * QR code: the payload, a dot, then the pairing code (`ghnotes:1:<salt>.<iv>.<ciphertext>.<CODE>`), so
 * scanning needs nothing typed. The setup code (copied text) is the payload alone.
 */

export interface LinkData {
  /** owner */
  o: string
  /** repo */
  r: string
  /** branch */
  b: string
  /** token */
  t: string
  /** tokenExpiresOn (YYYY-MM-DD) */
  e: string
}

export const PAIRING_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export const PAYLOAD_PREFIX = 'ghnotes:1:'

export class WrongPairingCodeError extends Error {
  constructor() {
    super('wrong pairing code')
    this.name = 'WrongPairingCodeError'
  }
}

export class InvalidPayloadError extends Error {
  constructor(message = 'invalid payload') {
    super(message)
    this.name = 'InvalidPayloadError'
  }
}

const PBKDF2_ITERATIONS = 600_000
const SALT_BYTES = 16
const IV_BYTES = 12
const CODE_LENGTH = 8

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new InvalidPayloadError('bad base64url')
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** 8 random characters from PAIRING_ALPHABET (crypto.getRandomValues, no modulo bias). */
export function generatePairingCode(): string {
  const n = PAIRING_ALPHABET.length
  // Reject bytes at or above the largest multiple of n that fits in a byte.
  const limit = 256 - (256 % n)
  let code = ''
  while (code.length < CODE_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH * 2))
    for (const b of bytes) {
      if (b < limit && code.length < CODE_LENGTH) code += PAIRING_ALPHABET[b % n]
    }
  }
  return code
}

/** `K7QM2XPA` → `K7QM-2XPA`. */
export function formatPairingCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

/**
 * User input → 8 canonical characters, or null if it cannot be a code. Removes spaces and dashes
 * and uppercases. Characters outside the alphabet (look-alikes such as `O`, `0`, `I`, `L`, `1`
 * are not in it) are rejected rather than guessed.
 */
export function normalizePairingCode(input: string): string | null {
  const code = input.replace(/[\s-]+/g, '').toUpperCase()
  if (code.length !== CODE_LENGTH) return null
  for (const ch of code) if (!PAIRING_ALPHABET.includes(ch)) return null
  return code
}

export function isLinkPayload(text: string): boolean {
  return text.trim().startsWith(PAYLOAD_PREFIX)
}

/** LINK-1: the text the QR code carries — the payload with its pairing code. */
export function qrText(payload: string, code: string): string {
  const normalized = normalizePairingCode(code)
  if (normalized === null) throw new Error('invalid pairing code')
  return `${payload}.${normalized}`
}

/**
 * Scanned or pasted text → the payload, and the pairing code if the text carries one (a QR code
 * does, a setup code does not). Base64url has no dots, so a fourth dot-separated part can only be
 * the code.
 */
export function splitLinkText(text: string): { payload: string; code: string | null } {
  const trimmed = text.trim()
  if (!trimmed.startsWith(PAYLOAD_PREFIX)) return { payload: trimmed, code: null }
  const parts = trimmed.slice(PAYLOAD_PREFIX.length).split('.')
  const code = parts.length === 4 ? normalizePairingCode(parts[3]) : null
  if (code === null) return { payload: trimmed, code: null }
  return { payload: PAYLOAD_PREFIX + parts.slice(0, 3).join('.'), code }
}

async function deriveKey(normalized: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(normalized), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptLinkPayload(data: LinkData, code: string): Promise<string> {
  const normalized = normalizePairingCode(code)
  if (normalized === null) throw new Error('invalid pairing code')
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(normalized, salt)
  const json = JSON.stringify({ o: data.o, r: data.r, b: data.b, t: data.t, e: data.e })
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, encoder.encode(json)),
  )
  return `${PAYLOAD_PREFIX}${toBase64Url(salt)}.${toBase64Url(iv)}.${toBase64Url(cipher)}`
}

/** Throws WrongPairingCodeError (authentication failed) or InvalidPayloadError (malformed). */
export async function decryptLinkPayload(payload: string, code: string): Promise<LinkData> {
  const text = payload.trim()
  if (!text.startsWith(PAYLOAD_PREFIX)) throw new InvalidPayloadError('bad prefix')
  const parts = text.slice(PAYLOAD_PREFIX.length).split('.')
  if (parts.length !== 3) throw new InvalidPayloadError('bad structure')
  const [salt, iv, cipher] = parts.map(fromBase64Url)
  // AES-GCM ciphertext carries a 16-byte tag.
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || cipher.length < 16) {
    throw new InvalidPayloadError('bad lengths')
  }
  const normalized = normalizePairingCode(code)
  if (normalized === null) throw new WrongPairingCodeError()
  const key = await deriveKey(normalized, salt)
  let plain: ArrayBuffer
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, cipher as BufferSource)
  } catch {
    throw new WrongPairingCodeError()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(decoder.decode(plain))
  } catch {
    throw new InvalidPayloadError('bad content')
  }
  if (!parsed || typeof parsed !== 'object') throw new InvalidPayloadError('bad content')
  const d = parsed as Record<string, unknown>
  const { o, r, b, t, e } = d
  if (
    typeof o !== 'string' || !o ||
    typeof r !== 'string' || !r ||
    typeof b !== 'string' || !b ||
    typeof t !== 'string' || !t ||
    typeof e !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e)
  ) {
    throw new InvalidPayloadError('bad fields')
  }
  return { o, r, b, t, e }
}
