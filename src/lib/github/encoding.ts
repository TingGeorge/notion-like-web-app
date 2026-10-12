/**
 * Byte helpers shared by the GitHub client and the sync engine: UTF-8, base64 and the git blob
 * SHA-1 (SYNC-8 step 7), all with browser APIs only (TextEncoder/TextDecoder, atob/btoa, WebCrypto).
 */

const encoder = new TextEncoder()

export function utf8Encode(text: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(text)
}

/** UTF-8 decode. A byte-order mark is kept, so the text matches the bytes on GitHub. */
export function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** Decodes base64, ignoring the line breaks GitHub puts every 60 characters. */
export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64.replace(/\s/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function toHex(buf: ArrayBuffer): string {
  let s = ''
  for (const b of new Uint8Array(buf)) s += b.toString(16).padStart(2, '0')
  return s
}

/** SYNC-8 step 7: the git blob SHA-1 of `"blob <len>\0" + bytes`, computed with WebCrypto. */
export async function gitBlobSha(content: string | Uint8Array): Promise<string> {
  const body = typeof content === 'string' ? utf8Encode(content) : content
  const header = utf8Encode(`blob ${body.length}\0`)
  const all = new Uint8Array(header.length + body.length)
  all.set(header, 0)
  all.set(body, header.length)
  return toHex(await crypto.subtle.digest('SHA-1', all))
}
