// @vitest-environment happy-dom
/**
 * UI-17: every input rule, the `/` trigger, Enter handling and shortcuts ignore events while an
 * IME is composing (注音, 倉頡) and act on `compositionend`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { history } from 'prosemirror-history'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { AssetCache, UIStore, type EditorContext } from './context'
import { buildInputRules } from './inputRules'
import { handleEditorKeyDown } from './shortcuts'
import { slashKey, slashPlugin } from './slash'
import type { EditorServices } from './types'
import { docOf, outline, p } from './testUtils'

const views: EditorView[] = []
afterEach(() => {
  views.splice(0).forEach((v) => v.destroy())
  document.body.innerHTML = ''
})

function mount(doc = docOf(p())) {
  const host = document.createElement('div')
  document.body.append(host)
  const onChoose = vi.fn()
  const view = new EditorView(host, {
    state: EditorState.create({ doc, plugins: [slashPlugin(onChoose), buildInputRules(), history()] }),
  })
  views.push(view)
  view.focus()
  return { view, onChoose }
}

const ctx = (): EditorContext => ({
  services: () => ({}) as EditorServices,
  onExitTop: () => false,
  ui: new UIStore(),
  hover: { pos: null },
  view: () => null,
  assets: new AssetCache(async () => null),
})

/** What the browser does for a typed character: ask the handlers first, insert if nobody took it. */
function type(view: EditorView, text: string) {
  const { from, to } = view.state.selection
  const handled = view.someProp('handleTextInput', (f) => f(view, from, to, text, () => view.state.tr.insertText(text, from, to)))
  if (!handled) view.dispatch(view.state.tr.insertText(text, from, to))
}

const startComposition = (view: EditorView) => view.dom.dispatchEvent(new window.Event('compositionstart', { bubbles: true }))
function endComposition(view: EditorView, data = '') {
  const ev = new window.Event('compositionend', { bubbles: true }) as Event & { data: string }
  ev.data = data
  view.dom.dispatchEvent(ev)
}
const settle = () => new Promise((r) => setTimeout(r, 60))

describe('input rules', () => {
  it('apply when typed outside composition', () => {
    const { view } = mount()
    type(view, '#')
    type(view, ' ')
    expect(outline(view.state.doc)).toEqual(['h1:'])
  })

  it('cover every row of the §7.1 table', () => {
    const cases: [string[], string][] = [
      [['#', ' '], 'h1:'],
      [['#', '#', ' '], 'h2:'],
      [['#', '#', '#', ' '], 'h3:'],
      [['-', ' '], 'ul[]'],
      [['*', ' '], 'ul[]'],
      [['1', '.', ' '], 'ol[]'],
      [['[', ']', ' '], 'ul[[ ] ]'],
      [['>', ' '], 'toggle(closed)[summary:]'],
      [['"', ' '], 'quote[p:]'],
      [['`', '`', '`'], 'code():'],
      [['-', '-', '-'], 'hr'],
    ]
    for (const [keys, expected] of cases) {
      const { view } = mount()
      keys.forEach((k) => type(view, k))
      expect(outline(view.state.doc)[0], keys.join('')).toBe(expected)
    }
  })

  it('inline rules: **bold**, *italic*, ~strike~, `code`', () => {
    const marks = (s: string) => {
      const { view } = mount()
      for (const ch of s) type(view, ch)
      return view.state.doc.firstChild!.content.content.map((n) => `${n.text}:${n.marks.map((m) => m.type.name).join('+')}`)
    }
    expect(marks('**b**')).toEqual(['b:bold'])
    expect(marks('*i*')).toEqual(['i:italic'])
    expect(marks('~s~')).toEqual(['s:strike'])
    expect(marks('`c`')).toEqual(['c:code'])
    expect(marks('a **b** c')).toEqual(['a :', 'b:bold', ' c:'])
    // After the rule the next character is not bold.
    const { view } = mount()
    for (const ch of '**b**x') type(view, ch)
    expect(view.state.doc.firstChild!.lastChild!.marks).toHaveLength(0)
  })

  it('do not fire inside code blocks or inline code', () => {
    const { view } = mount()
    for (const ch of '```') type(view, ch)
    expect(outline(view.state.doc)[0]).toBe('code():')
    type(view, '#')
    type(view, ' ')
    expect(outline(view.state.doc)[0]).toBe('code():# ')
  })

  it('do not fire while composing; they fire on compositionend', async () => {
    const { view } = mount()
    startComposition(view)
    expect(view.composing).toBe(true)
    type(view, '#')
    type(view, ' ')
    expect(outline(view.state.doc)).toEqual(['p:# '])
    // The IME commits its text, then the composition ends.
    endComposition(view, '# ')
    await settle()
    expect(view.composing).toBe(false)
    expect(outline(view.state.doc)).toEqual(['h1:'])
  })

  it('a block rule needs the trigger at the start of the paragraph', () => {
    const { view } = mount(docOf(p('x')))
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)))
    type(view, '#')
    type(view, ' ')
    expect(outline(view.state.doc)).toEqual(['p:x# '])
  })
})

describe('the / trigger', () => {
  it('opens on / and on the full-width ／', () => {
    for (const ch of ['/', '／']) {
      const { view } = mount()
      type(view, ch)
      expect(slashKey.getState(view.state)).toMatchObject({ from: 1, query: '' })
      expect(view.state.doc.textContent).toBe(ch)
    }
  })

  it('does not open while composing, and opens on compositionend', async () => {
    const { view } = mount()
    startComposition(view)
    type(view, '/')
    expect(slashKey.getState(view.state)).toBeNull()
    endComposition(view, '/')
    await settle()
    expect(slashKey.getState(view.state)).toMatchObject({ from: 1 })
  })

  it('tracks the query, closes on a space, and never opens in code', () => {
    const { view } = mount()
    type(view, '/')
    type(view, 'h')
    type(view, '1')
    expect(slashKey.getState(view.state)).toMatchObject({ query: 'h1' })
    type(view, ' ')
    expect(slashKey.getState(view.state)).toBeNull()

    const code = mount(docOf({ type: 'code_block', attrs: { language: '' } }))
    code.view.dispatch(code.view.state.tr.setSelection(TextSelection.create(code.view.state.doc, 1)))
    type(code.view, '/')
    expect(slashKey.getState(code.view.state)).toBeNull()
  })

  it('Enter picks the item, but not while composing', () => {
    const { view, onChoose } = mount()
    type(view, '/')
    type(view, 'h')
    type(view, '1')
    const enter = (init: KeyboardEventInit) => new window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true, ...init })
    startComposition(view)
    expect(view.someProp('handleKeyDown', (f) => f(view, enter({}) as KeyboardEvent))).toBeFalsy()
    expect(onChoose).not.toHaveBeenCalled()
    endComposition(view)
    expect(view.someProp('handleKeyDown', (f) => f(view, enter({ isComposing: true }) as KeyboardEvent))).toBeFalsy()
    expect(onChoose).not.toHaveBeenCalled()
    expect(view.someProp('handleKeyDown', (f) => f(view, enter({}) as KeyboardEvent))).toBe(true)
    expect(onChoose).toHaveBeenCalledTimes(1)
    expect(onChoose.mock.calls[0][1].id).toBe('h1')
  })
})

describe('keys', () => {
  it('Enter, Backspace, Tab and shortcuts do nothing while composing', () => {
    const { view } = mount(docOf(p('ab')))
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
    const before = view.state.doc
    startComposition(view)
    const keys: KeyboardEventInit[] = [
      { key: 'Enter' },
      { key: 'Backspace' },
      { key: 'Tab' },
      { key: 'b', ctrlKey: true, metaKey: true },
      { key: 'Escape' },
    ]
    for (const init of keys) {
      const ev = new window.KeyboardEvent('keydown', { cancelable: true, ...init })
      expect(handleEditorKeyDown(view, ev as KeyboardEvent, ctx()), init.key).toBe(false)
      expect(ev.defaultPrevented).toBe(false)
    }
    // keyCode 229 / isComposing mark IME key events even after compositionend (Safari).
    endComposition(view)
    for (const extra of [{ isComposing: true }, { keyCode: 229 }]) {
      const ev = new window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true, ...extra })
      expect(handleEditorKeyDown(view, ev as KeyboardEvent, ctx())).toBe(false)
    }
    expect(view.state.doc.eq(before)).toBe(true)
  })

  it('Enter splits the block once composition is over', () => {
    const { view } = mount(docOf(p('ab')))
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
    const ev = new window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    expect(handleEditorKeyDown(view, ev as KeyboardEvent, ctx())).toBe(true)
    expect(outline(view.state.doc)).toEqual(['p:a', 'p:b'])
  })
})
