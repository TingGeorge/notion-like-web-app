import { describe, expect, it, vi } from 'vitest'
import { NodeSelection, TextSelection } from 'prosemirror-state'
import {
  backspaceToText,
  enterInListItem,
  enterInToggleSummary,
  exitCodeBlock,
  indentListItem,
  newlineInCodeBlock,
  outdentListItem,
  selectBlock,
  setToggleOpen,
  toggleCheckOrOpen,
} from './commands'
import { code, docOf, h, li, outline, p, quote, run, stateAt, toggle, ul, callout } from './testUtils'

describe('Enter', () => {
  it('in a code block inserts a newline', () => {
    const next = run(stateAt(docOf(code('ab')), 'a'), newlineInCodeBlock)!
    expect(outline(next.doc)).toEqual(['code():a\nb'])
  })

  it('on an empty top-level list item leaves the list', () => {
    const doc = docOf(ul(li(null, 'a'), li(null, '')))
    const state = stateAt(doc, 'a', 'end')
    const emptyPos = state.doc.child(0).child(0).nodeSize + 3
    const s2 = state.apply(state.tr.setSelection(TextSelection.create(state.doc, emptyPos)))
    expect(outline(run(s2, enterInListItem)!.doc)).toEqual(['ul[a]', 'p:'])
  })

  it('on an empty nested item outdents it', () => {
    const doc = docOf(ul(li(null, p('a'), ul(li(null, '')))))
    const state = stateAt(doc, 'a')
    const nestedEmpty = state.doc.nodeSize - 2 - 6
    const s2 = state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(nestedEmpty))))
    expect(outline(run(s2, enterInListItem)!.doc)).toEqual(['ul[a|]'])
  })

  it('on a to-do creates an unchecked to-do', () => {
    const next = run(stateAt(docOf(ul(li(true, 'done'))), 'done'), enterInListItem)!
    expect(outline(next.doc)).toEqual(['ul[[x] done|[ ] ]'])
  })

  it('on a bullet splits it', () => {
    const next = run(stateAt(docOf(ul(li(null, 'ab'))), 'a'), enterInListItem)!
    expect(outline(next.doc)).toEqual(['ul[a|b]'])
  })

  it('at the end of a toggle summary opens the toggle and creates the first child', () => {
    const next = run(stateAt(docOf(toggle(false, 'T')), 'T'), enterInToggleSummary)!
    expect(outline(next.doc)).toEqual(['toggle(open)[summary:T|p:]'])
    expect(next.selection.$from.parent.type.name).toBe('paragraph')
  })

  it('in the middle of a summary the tail moves into the child', () => {
    const next = run(stateAt(docOf(toggle(false, 'Title')), 'Ti'), enterInToggleSummary)!
    expect(outline(next.doc)).toEqual(['toggle(open)[summary:Ti|p:tle]'])
  })

  it('on an empty summary without children turns the toggle into text', () => {
    const doc = docOf(toggle(false, ''))
    const state = stateAt(docOf(toggle(false, 'x')), 'x', 'start')
    const empty = state.apply(state.tr.delete(2, 3))
    expect(outline(run(empty, enterInToggleSummary)!.doc)).toEqual(['p:'])
    void doc
  })

  it('⌘Enter in code leaves the block', () => {
    const next = run(stateAt(docOf(code('x')), 'x'), exitCodeBlock)!
    expect(outline(next.doc)).toEqual(['code():x', 'p:'])
  })
})

describe('Backspace', () => {
  const noExit = vi.fn(() => false)
  it('at the start of a heading turns it into text', () => {
    expect(outline(run(stateAt(docOf(h(2, 'x')), 'x', 'start'), backspaceToText())!.doc)).toEqual(['p:x'])
  })

  it('at the start of a list item turns it into text', () => {
    expect(outline(run(stateAt(docOf(ul(li(null, 'x'))), 'x', 'start'), backspaceToText())!.doc)).toEqual(['p:x'])
  })

  it('at the start of a to-do turns it into text', () => {
    expect(outline(run(stateAt(docOf(ul(li(false, 'x'))), 'x', 'start'), backspaceToText())!.doc)).toEqual(['p:x'])
  })

  it('at the start of a toggle summary / quote / callout / code unwraps to text', () => {
    expect(outline(run(stateAt(docOf(toggle(true, 'T', p('c'))), 'T', 'start'), backspaceToText())!.doc)).toEqual(['p:T', 'p:c'])
    expect(outline(run(stateAt(docOf(quote(p('q'))), 'q', 'start'), backspaceToText())!.doc)).toEqual(['p:q'])
    expect(outline(run(stateAt(docOf(callout(p('q'))), 'q', 'start'), backspaceToText())!.doc)).toEqual(['p:q'])
    expect(outline(run(stateAt(docOf(code('q')), 'q', 'start'), backspaceToText())!.doc)).toEqual(['p:q'])
  })

  it('in the middle of text does nothing special', () => {
    expect(run(stateAt(docOf(h(1, 'xy')), 'x'), backspaceToText())).toBeNull()
  })

  it('at the very start of the page calls onExitTop and keeps the doc', () => {
    const exit = vi.fn(() => true)
    const state = stateAt(docOf(p('first'), p('second')), 'first', 'start')
    expect(backspaceToText(exit)(state)).toBe(true)
    expect(exit).toHaveBeenCalledTimes(1)
    expect(backspaceToText(noExit)(state)).toBe(false)
  })

  it('a heading at the start of the page becomes text first, then exits', () => {
    const exit = vi.fn(() => true)
    const state = stateAt(docOf(h(1, 'first')), 'first', 'start')
    const next = run(state, backspaceToText(exit))!
    expect(exit).not.toHaveBeenCalled()
    expect(outline(next.doc)).toEqual(['p:first'])
    expect(backspaceToText(exit)(next)).toBe(true)
    expect(exit).toHaveBeenCalledTimes(1)
  })
})

describe('Tab', () => {
  it('indents a list item under the previous one and outdents again', () => {
    const doc = docOf(ul(li(null, 'a'), li(null, 'b')))
    const indented = run(stateAt(doc, 'b'), indentListItem)!
    expect(outline(indented.doc)).toEqual(['ul[a/ul[b]]'])
    const back = run(indented, outdentListItem)!
    expect(outline(back.doc)).toEqual(['ul[a|b]'])
  })

  it('the first item cannot be indented; Tab on a paragraph does nothing (DATA-13)', () => {
    const first = stateAt(docOf(ul(li(null, 'a'))), 'a')
    expect(run(first, indentListItem)).toBeNull() // swallowed by the key handler, no change
    expect(indentListItem(stateAt(docOf(p('x')), 'x'))).toBe(false)
    expect(indentListItem(stateAt(docOf(h(1, 'x')), 'x'))).toBe(false)
  })
})

describe('toggle and to-do state', () => {
  it('⌘Enter checks a to-do and opens a toggle', () => {
    const todo = run(stateAt(docOf(ul(li(false, 'a'))), 'a'), toggleCheckOrOpen)!
    expect(outline(todo.doc)).toEqual(['ul[[x] a]'])
    const tg = run(stateAt(docOf(toggle(false, 'T')), 'T'), toggleCheckOrOpen)!
    expect(outline(tg.doc)).toEqual(['toggle(open)[summary:T]'])
    expect(toggleCheckOrOpen(stateAt(docOf(p('x')), 'x'))).toBe(false)
  })

  it('toggle open/close is UI only: not in history, not an onChange', () => {
    const state = stateAt(docOf(toggle(false, 'T', p('c'))), 'c')
    const tr = setToggleOpen(state.tr, 0, true)
    expect(tr.getMeta('addToHistory')).toBe(false)
    expect(tr.getMeta('gn-ui-only')).toBe(true)
  })

  it('closing a toggle moves a caret out of the hidden children', () => {
    const state = stateAt(docOf(toggle(true, 'T', p('child'))), 'child')
    const next = state.apply(setToggleOpen(state.tr, 0, false))
    expect(next.selection.$from.parent.type.name).toBe('toggle_summary')
  })
})

describe('Esc', () => {
  it('selects the current block', () => {
    const next = run(stateAt(docOf(ul(li(null, 'a'))), 'a'), selectBlock)!
    expect(next.selection).toBeInstanceOf(NodeSelection)
    expect((next.selection as NodeSelection).node.type.name).toBe('list_item')
    expect(selectBlock(next)).toBe(false)
  })
})
