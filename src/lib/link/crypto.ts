/**
 * Device linking payload (LINK-1, SEC-8).
 *
 * CONTRACT — implemented in this folder.
 * Payload: `ghnotes:1:<salt>.<iv>.<ciphertext>`, all base64url (no padding).
 * Ciphertext: AES-GCM of the UTF-8 JSON `{"o","r","b","t","e"}`.
 * Key: PBKDF2-SHA-256 of the pairing code (normalised, without the dash), 600,000 iterations, 16-byte salt.
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

const notImplemented = (name: string): never => {
  throw new Error(`link: ${name} is not implemented yet`)
}

/** 8 random characters from PAIRING_ALPHABET (crypto.getRandomValues, no modulo bias). */
export function generatePairingCode(): string {
  return notImplemented('generatePairingCode')
}

/** `K7QM2XPA` → `K7QM-2XPA`. */
export function formatPairingCode(_code: string): string {
  return notImplemented('formatPairingCode')
}

/**
 * User input → 8 canonical characters, or null if it cannot be a code. Removes spaces and dashes,
 * uppercases, maps look-alikes (O→0 is not in the alphabet, so `O`, `0` → reject; `I`, `L`, `1` → reject).
 */
export function normalizePairingCode(_input: string): string | null {
  return notImplemented('normalizePairingCode')
}

export function isLinkPayload(_text: string): boolean {
  return notImplemented('isLinkPayload')
}

export function encryptLinkPayload(_data: LinkData, _code: string): Promise<string> {
  return notImplemented('encryptLinkPayload')
}

/** Throws WrongPairingCodeError (authentication failed) or InvalidPayloadError (malformed). */
export function decryptLinkPayload(_payload: string, _code: string): Promise<LinkData> {
  return notImplemented('decryptLinkPayload')
}
