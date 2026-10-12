/** SETUP-4 and SETUP-5: token format and expiry date helpers. Pure functions, no I/O. */

export type TokenCheck =
  | { kind: 'empty' }
  | { kind: 'fine-grained'; token: string }
  | { kind: 'classic'; token: string }
  | { kind: 'invalid' }

/** SETUP-4. Leading and trailing whitespace is removed; inner whitespace makes it invalid. */
export function checkToken(input: string): TokenCheck {
  const token = input.trim()
  if (token === '') return { kind: 'empty' }
  if (/\s/.test(token)) return { kind: 'invalid' }
  if (/^github_pat_\S+$/.test(token)) return { kind: 'fine-grained', token }
  if (/^ghp_\S+$/.test(token)) return { kind: 'classic', token }
  return { kind: 'invalid' }
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** `YYYY-MM-DD` in local time (the value of an `<input type="date">`). */
export function toIsoDate(d: Date): string {
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** SETUP-5: today + 90 days, the lifetime of the pre-filled token form. */
export function defaultExpiry(today: Date): string {
  return toIsoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 90))
}

/** `2027-01-10` → `2027/01/10` (display format). */
export function formatExpiry(iso: string): string {
  return iso.replace(/-/g, '/')
}

export function isValidIsoDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(y, mo - 1, d)
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d
}

/** True when `iso` is before the local calendar day of `today`. */
export function isPastDate(iso: string, today: Date): boolean {
  return iso < toIsoDate(today)
}

/** `2027/01/10` or `2027-1-10` → `2027-01-10`, or null. */
export function parseExpiryText(text: string): string | null {
  const m = /^\s*(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})\s*$/.exec(text)
  if (!m) return null
  const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return isValidIsoDate(iso) ? iso : null
}
