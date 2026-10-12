// @vitest-environment happy-dom
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { applyPairingInput, PairingInput, sanitizePairingInput } from './PairingInput'

afterEach(cleanup)

describe('sanitizePairingInput', () => {
  it('uppercases and drops dashes, spaces and characters outside the alphabet', () => {
    expect(sanitizePairingInput('k7qm-2xpa')).toBe('K7QM2XPA')
    expect(sanitizePairingInput(' k7 qm ')).toBe('K7QM')
    // 0, 1, O, I, L are not in the alphabet (LINK-1).
    expect(sanitizePairingInput('01OIL')).toBe('')
  })
})

describe('applyPairingInput', () => {
  it('appends a character and advances', () => {
    expect(applyPairingInput('K7', 2, 'q')).toEqual({ value: 'K7Q', focus: 3 })
  })
  it('replaces the character in a filled box', () => {
    expect(applyPairingInput('K7QM', 1, 'x')).toEqual({ value: 'KXQM', focus: 2 })
  })
  it('removes a character when a box is cleared', () => {
    expect(applyPairingInput('K7QM', 1, '')).toEqual({ value: 'KQM', focus: 1 })
  })
  it('spreads several characters (autofill) and caps at 8', () => {
    expect(applyPairingInput('', 0, 'k7qm2xpaZZ')).toEqual({ value: 'K7QM2XPA', focus: 7 })
  })
  it('ignores characters that are not allowed', () => {
    expect(applyPairingInput('K', 1, '0')).toEqual({ value: 'K', focus: 1 })
  })
})

function Harness({ onComplete }: { onComplete: (v: string) => void }) {
  const [value, setValue] = useState('')
  return <PairingInput value={value} onChange={setValue} onComplete={onComplete} />
}

const boxes = () => screen.getAllByRole('textbox') as HTMLInputElement[]
const joined = () => boxes().map((b) => b.value).join('')

describe('PairingInput', () => {
  it('renders eight boxes', () => {
    render(<Harness onComplete={() => {}} />)
    expect(boxes()).toHaveLength(8)
  })

  it('uppercases typed characters and moves focus to the next box', () => {
    render(<Harness onComplete={() => {}} />)
    fireEvent.change(boxes()[0], { target: { value: 'k' } })
    expect(joined()).toBe('K')
    expect(document.activeElement).toBe(boxes()[1])
    fireEvent.change(boxes()[1], { target: { value: '7' } })
    expect(joined()).toBe('K7')
    expect(document.activeElement).toBe(boxes()[2])
  })

  it('paste fills all boxes and completes', () => {
    const onComplete = vi.fn()
    render(<Harness onComplete={onComplete} />)
    fireEvent.paste(boxes()[3], { clipboardData: { getData: () => 'k7qm-2xpa' } })
    expect(joined()).toBe('K7QM2XPA')
    expect(onComplete).toHaveBeenCalledWith('K7QM2XPA')
  })

  it('completes once, on the eighth character', () => {
    const onComplete = vi.fn()
    render(<Harness onComplete={onComplete} />)
    'K7QM2XP'.split('').forEach((ch, i) => fireEvent.change(boxes()[i], { target: { value: ch } }))
    expect(onComplete).not.toHaveBeenCalled()
    fireEvent.change(boxes()[7], { target: { value: 'a' } })
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith('K7QM2XPA')
  })

  it('backspace in an empty box deletes the previous character and goes back', () => {
    render(<Harness onComplete={() => {}} />)
    fireEvent.paste(boxes()[0], { clipboardData: { getData: () => 'K7Q' } })
    fireEvent.keyDown(boxes()[3], { key: 'Backspace' })
    expect(joined()).toBe('K7')
    expect(document.activeElement).toBe(boxes()[2])
  })

  it('rejects characters outside the pairing alphabet', () => {
    render(<Harness onComplete={() => {}} />)
    fireEvent.change(boxes()[0], { target: { value: '0' } })
    expect(joined()).toBe('')
  })
})
