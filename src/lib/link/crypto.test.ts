import { describe, expect, it } from 'vitest'
import {
  InvalidPayloadError,
  NEVER_EXPIRES,
  PAIRING_ALPHABET,
  PAYLOAD_PREFIX,
  WrongPairingCodeError,
  decryptLinkPayload,
  encryptLinkPayload,
  formatPairingCode,
  generatePairingCode,
  isLinkPayload,
  normalizePairingCode,
  qrText,
  splitLinkText,
  type LinkData,
} from './crypto'

const data: LinkData = {
  o: 'alice',
  r: '筆記 notes',
  b: 'main',
  t: 'github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz',
  e: '2027-01-31',
}

describe('pairing code (LINK-1)', () => {
  it('has 8 characters from the alphabet and is random', () => {
    const codes = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const code = generatePairingCode()
      expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/)
      codes.add(code)
    }
    expect(codes.size).toBe(200)
  })

  it('uses every alphabet character about equally (no modulo bias)', () => {
    const counts = new Map<string, number>()
    for (let i = 0; i < 4000; i++) for (const ch of generatePairingCode()) counts.set(ch, (counts.get(ch) ?? 0) + 1)
    expect(counts.size).toBe(PAIRING_ALPHABET.length)
    const expected = (4000 * 8) / PAIRING_ALPHABET.length
    for (const n of counts.values()) expect(Math.abs(n - expected)).toBeLessThan(expected * 0.2)
  })

  it('formats as XXXX-XXXX (XXXXX-XXXXX for the LINK-5 code)', () => {
    expect(formatPairingCode('K7QM2XPA')).toBe('K7QM-2XPA')
    expect(formatPairingCode('K7QM2XPA9H')).toBe('K7QM2-XPA9H')
  })

  it('normalises a 10-character LINK-5 code only when asked for that length', () => {
    expect(normalizePairingCode('k7qm2-xpa9h', 10)).toBe('K7QM2XPA9H')
    expect(normalizePairingCode('K7QM2XPA9H')).toBeNull()
    expect(normalizePairingCode('K7QM2XPA', 10)).toBeNull()
  })

  it('normalises lowercase, spaces and dashes; rejects anything outside the alphabet', () => {
    expect(normalizePairingCode('k7qm-2xpa')).toBe('K7QM2XPA')
    expect(normalizePairingCode(' K7QM 2XPA ')).toBe('K7QM2XPA')
    expect(normalizePairingCode('K7-QM-2X-PA')).toBe('K7QM2XPA')
    expect(normalizePairingCode('K7QM2XP')).toBeNull() // too short
    expect(normalizePairingCode('K7QM2XPAA')).toBeNull() // too long
    for (const bad of ['O', '0', 'I', 'L', '1', '!']) expect(normalizePairingCode(`K7QM2XP${bad}`)).toBeNull()
    expect(normalizePairingCode('')).toBeNull()
  })

  it('recognises payloads', () => {
    expect(isLinkPayload('ghnotes:1:a.b.c')).toBe(true)
    expect(isLinkPayload('  ghnotes:1:a.b.c\n')).toBe(true)
    expect(isLinkPayload('https://example.com')).toBe(false)
  })
})

describe('link payload encryption (LINK-1, SEC-8)', () => {
  it('round-trips, with a differently written code', async () => {
    const payload = await encryptLinkPayload(data, 'K7QM2XPA')
    expect(payload.startsWith(PAYLOAD_PREFIX)).toBe(true)
    const [salt, iv, cipher] = payload.slice(PAYLOAD_PREFIX.length).split('.')
    expect(salt).toMatch(/^[A-Za-z0-9_-]{22}$/) // 16 bytes
    expect(iv).toMatch(/^[A-Za-z0-9_-]{16}$/) // 12 bytes
    expect(cipher).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(payload).not.toContain('github_pat')
    expect(await decryptLinkPayload(payload, 'k7qm-2xpa')).toEqual(data)
    // A fresh salt and IV every time.
    expect(await encryptLinkPayload(data, 'K7QM2XPA')).not.toBe(payload)
  }, 30_000)

  it('fails with the wrong code, a tampered ciphertext, or malformed payloads', async () => {
    const payload = await encryptLinkPayload(data, 'K7QM2XPA')
    await expect(decryptLinkPayload(payload, 'K7QM2XPB')).rejects.toBeInstanceOf(WrongPairingCodeError)
    await expect(decryptLinkPayload(payload, 'nope')).rejects.toBeInstanceOf(WrongPairingCodeError)

    const parts = payload.slice(PAYLOAD_PREFIX.length).split('.')
    const flipped = parts[2].startsWith('A') ? `B${parts[2].slice(1)}` : `A${parts[2].slice(1)}`
    await expect(
      decryptLinkPayload(`${PAYLOAD_PREFIX}${parts[0]}.${parts[1]}.${flipped}`, 'K7QM2XPA'),
    ).rejects.toBeInstanceOf(WrongPairingCodeError)

    await expect(decryptLinkPayload(payload.replace('ghnotes:1:', 'ghnotes:2:'), 'K7QM2XPA')).rejects.toBeInstanceOf(
      InvalidPayloadError,
    )
    await expect(decryptLinkPayload('hello', 'K7QM2XPA')).rejects.toBeInstanceOf(InvalidPayloadError)
    await expect(decryptLinkPayload(`${PAYLOAD_PREFIX}a.b`, 'K7QM2XPA')).rejects.toBeInstanceOf(InvalidPayloadError)
    await expect(decryptLinkPayload(`${PAYLOAD_PREFIX}a.b.c`, 'K7QM2XPA')).rejects.toBeInstanceOf(InvalidPayloadError)
    await expect(decryptLinkPayload(`${PAYLOAD_PREFIX}!!.b.c`, 'K7QM2XPA')).rejects.toBeInstanceOf(InvalidPayloadError)
  }, 60_000)

  it('carries a token that never expires as a far date older versions accept (SETUP-5)', async () => {
    const payload = await encryptLinkPayload({ ...data, e: null }, 'K7QM2XPA')
    expect(await decryptLinkPayload(payload, 'K7QM2XPA')).toEqual({ ...data, e: null })
    // On the wire it is a date, so a device still on an older version can link too.
    const legacy = await encryptLinkPayload({ ...data, e: NEVER_EXPIRES }, 'K7QM2XPA')
    expect(await decryptLinkPayload(legacy, 'K7QM2XPA')).toEqual({ ...data, e: null })
  }, 30_000)

  it('rejects decrypted JSON with missing or malformed fields', async () => {
    const bad = { ...data, e: 'tomorrow' } as LinkData
    const payload = await encryptLinkPayload(bad, 'K7QM2XPA')
    await expect(decryptLinkPayload(payload, 'K7QM2XPA')).rejects.toBeInstanceOf(InvalidPayloadError)
    const missing = await encryptLinkPayload({ ...data, t: '' }, 'K7QM2XPA')
    await expect(decryptLinkPayload(missing, 'K7QM2XPA')).rejects.toBeInstanceOf(InvalidPayloadError)
  }, 30_000)

  it('refuses to encrypt with an invalid code', async () => {
    await expect(encryptLinkPayload(data, 'short')).rejects.toThrow()
  })
})

describe('QR text (LINK-1)', () => {
  it('carries the pairing code after the payload, and decrypts without anything typed', async () => {
    const code = generatePairingCode()
    const payload = await encryptLinkPayload(data, code)
    const text = qrText(payload, formatPairingCode(code))
    expect(text).toBe(`${payload}.${code}`)
    const split = splitLinkText(`  ${text}\n`)
    expect(split).toEqual({ payload, code })
    expect(await decryptLinkPayload(split.payload, split.code!)).toEqual(data)
  })

  it('leaves a setup code without a pairing code as it is', async () => {
    const payload = await encryptLinkPayload(data, generatePairingCode())
    expect(splitLinkText(payload)).toEqual({ payload, code: null })
  })

  it('does not take a fourth part that cannot be a code as one', () => {
    expect(splitLinkText('ghnotes:1:a.b.c.O0IL1XYZ')).toEqual({ payload: 'ghnotes:1:a.b.c.O0IL1XYZ', code: null })
    expect(splitLinkText('hello')).toEqual({ payload: 'hello', code: null })
  })
})
