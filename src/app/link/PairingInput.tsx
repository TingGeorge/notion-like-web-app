/**
 * LINK-3 / M22: eight boxes for `XXXX-XXXX`. Auto-advance, backspace goes back, paste fills all boxes,
 * input is uppercased and limited to the pairing alphabet.
 */
import { useEffect, useRef } from 'react'
import { PAIRING_ALPHABET } from '../../lib/link/crypto'
import { t } from '../../strings'
import { cx } from '../../ui/primitives'
import './link.css'

export const PAIRING_LENGTH = 8

/** Uppercase and keep only characters of the pairing alphabet (dashes and spaces are dropped). */
export function sanitizePairingInput(raw: string): string {
  let out = ''
  for (const ch of raw.toUpperCase()) if (PAIRING_ALPHABET.includes(ch)) out += ch
  return out
}

/**
 * Applies what the user typed into box `index` to the current value.
 * `raw` is the box's new content. Returns the new value and the box to focus next.
 */
export function applyPairingInput(value: string, index: number, raw: string): { value: string; focus: number } {
  const chars = sanitizePairingInput(raw)
  if (chars === '') {
    // Cleared the box: remove that character.
    const next = value.slice(0, index) + value.slice(index + 1)
    return { value: next, focus: index }
  }
  const at = Math.min(index, value.length)
  const next = (value.slice(0, at) + chars + value.slice(at + (index < value.length ? 1 : 0))).slice(0, PAIRING_LENGTH)
  return { value: next, focus: Math.min(at + chars.length, PAIRING_LENGTH - 1) }
}

export interface PairingInputProps {
  value: string
  onChange(value: string): void
  /** Called when the 8th character has been entered. */
  onComplete?(value: string): void
  disabled?: boolean
  invalid?: boolean
  autoFocus?: boolean
}

export function PairingInput({ value, onChange, onComplete, disabled, invalid, autoFocus }: PairingInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const pendingFocus = useRef<number | null>(null)

  useEffect(() => {
    if (pendingFocus.current !== null) {
      refs.current[pendingFocus.current]?.focus()
      refs.current[pendingFocus.current]?.select()
      pendingFocus.current = null
    }
  })
  useEffect(() => {
    if (autoFocus) refs.current[Math.min(value.length, PAIRING_LENGTH - 1)]?.focus()
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const commit = (next: string, focus: number) => {
    pendingFocus.current = focus
    onChange(next)
    if (next.length === PAIRING_LENGTH && next !== value) onComplete?.(next)
  }

  const boxes = []
  for (let i = 0; i < PAIRING_LENGTH; i++) {
    boxes.push(
      <input
        key={i}
        ref={(el) => {
          refs.current[i] = el
        }}
        className={cx('pair-box', invalid && 'is-invalid')}
        value={value[i] ?? ''}
        inputMode="text"
        autoCapitalize="characters"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        maxLength={PAIRING_LENGTH}
        disabled={disabled}
        aria-label={t.link.codeBoxLabel(i + 1)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          const r = applyPairingInput(value, i, e.target.value)
          commit(r.value, r.focus)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Backspace' && !value[i] && i > 0) {
            e.preventDefault()
            commit(value.slice(0, i - 1) + value.slice(i), i - 1)
          } else if (e.key === 'ArrowLeft' && i > 0) {
            e.preventDefault()
            refs.current[i - 1]?.focus()
          } else if (e.key === 'ArrowRight' && i < PAIRING_LENGTH - 1) {
            e.preventDefault()
            refs.current[i + 1]?.focus()
          }
        }}
        onPaste={(e) => {
          e.preventDefault()
          const next = sanitizePairingInput(e.clipboardData.getData('text')).slice(0, PAIRING_LENGTH)
          if (next) commit(next, Math.min(next.length, PAIRING_LENGTH - 1))
        }}
      />,
    )
    if (i === 3) {
      boxes.push(
        <span key="dash" className="pair-dash" aria-hidden="true">
          –
        </span>,
      )
    }
  }
  return (
    <div className="pair-input" role="group" aria-label={t.link.pairingCode}>
      {boxes}
    </div>
  )
}
