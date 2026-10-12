import { describe, expect, it } from 'vitest'
import { resolveShortcut, type KeyLike } from './shortcuts'

const key = (k: string, mods: Partial<KeyLike> = {}, code = ''): KeyLike => ({
  key: k,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
})

describe('shortcuts on a Mac', () => {
  const mac = (k: string, mods: Partial<KeyLike> = {}, code = '') => resolveShortcut(key(k, { metaKey: true, ...mods }, code), true)

  it('maps the mark shortcuts', () => {
    expect(mac('b')).toEqual({ type: 'mark', mark: 'bold' })
    expect(mac('i')).toEqual({ type: 'mark', mark: 'italic' })
    expect(mac('u')).toEqual({ type: 'mark', mark: 'underline' })
    expect(mac('S', { shiftKey: true })).toEqual({ type: 'mark', mark: 'strike' })
    expect(mac('e')).toEqual({ type: 'mark', mark: 'code' })
  })

  it('⌘⌥0…8 match on event.code, because ⌥ changes event.key', () => {
    // On a Mac ⌥1 types "¡": key is useless, code is Digit1.
    expect(mac('¡', { altKey: true }, 'Digit1')).toEqual({ type: 'turn', kind: 'h1' })
    expect(mac('º', { altKey: true }, 'Digit0')).toEqual({ type: 'turn', kind: 'text' })
    const kinds = ['text', 'h1', 'h2', 'h3', 'todo', 'bullet', 'number', 'toggle', 'code']
    kinds.forEach((kind, i) => expect(mac('x', { altKey: true }, `Digit${i}`)).toEqual({ type: 'turn', kind }))
    expect(mac('9', { altKey: true }, 'Digit9')).toBeNull()
  })

  it('⌘Enter, ⌘D, ⌘⇧↑/↓, ⌘Z, ⌘⇧Z, ⌘K', () => {
    expect(mac('Enter')).toEqual({ type: 'check' })
    expect(mac('d')).toEqual({ type: 'duplicate' })
    expect(mac('ArrowUp', { shiftKey: true })).toEqual({ type: 'move', dir: -1 })
    expect(mac('ArrowDown', { shiftKey: true })).toEqual({ type: 'move', dir: 1 })
    expect(mac('z')).toEqual({ type: 'undo' })
    expect(mac('Z', { shiftKey: true })).toEqual({ type: 'redo' })
    expect(mac('k')).toEqual({ type: 'link' })
  })

  it('leaves the app-level shortcuts alone', () => {
    expect(mac('p')).toBeNull() // search
    expect(mac('\\')).toBeNull() // sidebar
    expect(mac('L', { shiftKey: true })).toBeNull() // dark mode
    expect(mac('[')).toBeNull()
    expect(mac(']')).toBeNull()
    expect(mac('n', { altKey: true }, 'KeyN')).toBeNull() // new page
  })

  it('does not fire without the modifier or with extra ones', () => {
    expect(resolveShortcut(key('b'), true)).toBeNull()
    expect(resolveShortcut(key('b', { metaKey: true, altKey: true }), true)).toBeNull()
    expect(resolveShortcut(key('b', { ctrlKey: true }), true)).toBeNull()
  })
})

describe('shortcuts on Windows and Linux', () => {
  const win = (k: string, mods: Partial<KeyLike> = {}, code = '') => resolveShortcut(key(k, { ctrlKey: true, ...mods }, code), false)

  it('uses Ctrl for ⌘', () => {
    expect(win('b')).toEqual({ type: 'mark', mark: 'bold' })
    expect(win('y')).toEqual({ type: 'redo' })
    expect(win('S', { shiftKey: true })).toEqual({ type: 'mark', mark: 'strike' })
  })

  it('uses Ctrl+Shift+<n> for ⌘⌥<n>', () => {
    expect(win('!', { shiftKey: true }, 'Digit1')).toEqual({ type: 'turn', kind: 'h1' })
    expect(win('8', { shiftKey: true }, 'Digit8')).toEqual({ type: 'turn', kind: 'code' })
    expect(win('1', { altKey: true }, 'Digit1')).toBeNull()
    expect(win('1', {}, 'Digit1')).toBeNull()
  })
})
