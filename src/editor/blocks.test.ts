import { describe, expect, it } from 'vitest'
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state'
import { schema } from '../lib/schema'
import {
  applyColor,
  blockAtSelection,
  blockRefAt,
  buildBlock,
  canTurnInto,
  createTable,
  deleteBlockTr,
  duplicateBlockTr,
  insertBlocksTr,
  joinAdjacentLists,
  moveBlockToTr,
  moveBlockTr,
  turnIntoTr,
  activeColors,
  type BlockKind,
} from './blocks'
import { callout, code, docOf, h, hr, li, ol, outline, p, posOf, quote, stateAt, text, toggle, ul } from './testUtils'

function turn(doc: ReturnType<typeof docOf>, needle: string, kind: BlockKind, at: 'start' | 'end' = 'end') {
  const state = stateAt(doc, needle, at)
  const ref = blockAtSelection(state)!
  const tr = turnIntoTr(state, ref, kind)
  return tr ? state.apply(tr) : null
}

describe('turn into', () => {
  it('text to heading keeps marks and the caret offset', () => {
    const doc = docOf(p(text('hello', [{ type: 'bold' }]), ' world'))
    const next = turn(doc, 'hello', 'h2')!
    expect(outline(next.doc)).toEqual(['h2:hello world'])
    expect(next.doc.firstChild!.firstChild!.marks[0].type.name).toBe('bold')
    expect(next.selection.head).toBe(1 + 5)
  })

  it('heading to code drops marks; code to text turns newlines into breaks', () => {
    const doc = docOf(h(1, 'x'))
    const asCode = turn(doc, 'x', 'code')!
    expect(outline(asCode.doc)).toEqual(['code():x'])
    const doc2 = docOf(code('a\nb'))
    const asText = turn(doc2, 'a', 'text')!
    expect(asText.doc.firstChild!.childCount).toBe(3)
    expect(asText.doc.firstChild!.child(1).type.name).toBe('hard_break')
  })

  it('a heading cannot keep a hard break', () => {
    const doc = docOf({ type: 'paragraph', content: [text('a'), { type: 'hard_break' }, text('b')] })
    expect(outline(turn(doc, 'a', 'h1')!.doc)).toEqual(['h1:a b'])
  })

  it('bullet and to-do toggle in place without splitting the list', () => {
    const doc = docOf(ul(li(null, 'a'), li(null, 'b'), li(null, 'c')))
    const next = turn(doc, 'b', 'todo')!
    expect(outline(next.doc)).toEqual(['ul[a|[ ] b|c]'])
    expect(outline(turn(next.doc, 'b', 'bullet')!.doc)).toEqual(['ul[a|b|c]'])
  })

  it('the middle item of a list becomes a heading and splits the list', () => {
    const doc = docOf(ul(li(null, 'a'), li(null, 'b'), li(null, 'c')))
    expect(outline(turn(doc, 'b', 'h1')!.doc)).toEqual(['ul[a]', 'h1:b', 'ul[c]'])
  })

  it('a numbered item becomes a bullet; neighbours merge into one list again', () => {
    const doc = docOf(ul(li(null, 'a')), ol(li(null, 'b')), ul(li(null, 'c')))
    expect(outline(turn(doc, 'b', 'bullet')!.doc)).toEqual(['ul[a|b|c]'])
  })

  it('a paragraph between two lists of one kind merges them when it joins', () => {
    const doc = docOf(ul(li(null, 'a')), p('b'), ul(li(null, 'c')))
    expect(outline(turn(doc, 'b', 'bullet')!.doc)).toEqual(['ul[a|b|c]'])
  })

  it('children stay nested when a list item becomes another list kind', () => {
    const doc = docOf(ul(li(null, p('a'), ul(li(null, 'child')))))
    expect(outline(turn(doc, 'a', 'number')!.doc)).toEqual(['ol[a/ul[child]]'])
  })

  it('a toggle with children becomes text followed by the children', () => {
    const doc = docOf(toggle(true, 'T', p('c1'), p('c2')))
    expect(outline(turn(doc, 'T', 'text')!.doc)).toEqual(['p:T', 'p:c1', 'p:c2'])
  })

  it('text becomes a toggle; summary has no marks', () => {
    const doc = docOf(p(text('hi', [{ type: 'bold' }])))
    const next = turn(doc, 'hi', 'toggle')!
    expect(outline(next.doc)).toEqual(['toggle(closed)[summary:hi]'])
    expect(next.doc.firstChild!.firstChild!.firstChild!.marks).toHaveLength(0)
  })

  it('quote and callout swap, callouts only at the top level (DATA-13)', () => {
    const doc = docOf(quote(p('q')))
    expect(outline(turn(doc, 'q', 'callout')!.doc)).toEqual(['callout[p:q]'])
    expect(outline(turn(docOf(callout(p('c'))), 'c', 'quote')!.doc)).toEqual(['quote[p:c]'])
    expect(outline(turn(docOf(ul(li(null, 'a'))), 'a', 'callout')!.doc)).toEqual(['callout[p:a]'])
    const nested = docOf(ul(li(null, p('a'), ul(li(null, 'b')))))
    expect(turn(nested, 'b', 'callout')).toBeNull()
    const inToggle = docOf(toggle(true, 'T', p('child')))
    expect(turn(inToggle, 'child', 'callout')).toBeNull()
    const state = stateAt(inToggle, 'child')
    expect(canTurnInto(state, blockAtSelection(state)!, 'callout')).toBe(false)
    expect(canTurnInto(state, blockAtSelection(state)!, 'quote')).toBe(true)
  })

  it('quote with one paragraph turns into text (unwraps)', () => {
    expect(outline(turn(docOf(quote(p('q'))), 'q', 'text')!.doc)).toEqual(['p:q'])
  })

  it('same kind is a no-op; dividers and tables cannot be converted', () => {
    expect(turn(docOf(p('a')), 'a', 'text')).toBeNull()
    const state = stateAt(docOf(p('a'), hr(), p('b')), 'a')
    expect(blockRefAt(state.doc, 3)!.kind).toBeNull()
  })

  it('ordered lists restart at 1 after a split', () => {
    const doc = docOf(ol(li(null, 'a'), li(null, 'b'), li(null, 'c')))
    const next = turn(doc, 'b', 'text')!
    expect(next.doc.child(2).attrs.start).toBe(1)
  })
})

describe('blockAtSelection', () => {
  it('finds list items, toggles and single-child quotes', () => {
    const doc = docOf(ul(li(null, 'item')), toggle(false, 'sum'), quote(p('q')), quote(p('a'), p('b')))
    expect(blockAtSelection(stateAt(doc, 'item'))!.node.type.name).toBe('list_item')
    expect(blockAtSelection(stateAt(doc, 'sum'))!.node.type.name).toBe('toggle')
    expect(blockAtSelection(stateAt(doc, 'q'))!.node.type.name).toBe('blockquote')
    expect(blockAtSelection(stateAt(doc, 'b'))!.node.type.name).toBe('paragraph')
  })

  it('a node selection is its own block', () => {
    const doc = docOf(p('a'), hr())
    const state = stateAt(doc, 'a')
    const sel = state.apply(state.tr.setSelection(NodeSelection.create(doc, 3)))
    expect(blockAtSelection(sel)!.node.type.name).toBe('horizontal_rule')
  })
})

describe('insert', () => {
  it('replaces an empty paragraph', () => {
    const doc = docOf(p('a'), p())
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, doc.child(0).nodeSize + 1) })
    const next = state.apply(insertBlocksTr(state, [createTable(2, 2)]))
    expect(outline(next.doc)).toEqual(['p:a', 'table'])
    // The caret is in the first header cell.
    expect(next.selection.$from.parent.type.name).toBe('table_header')
  })

  it('a divider gets a paragraph to put the caret in', () => {
    const state = stateAt(docOf(p('a')), 'a')
    const next = state.apply(insertBlocksTr(state, [schema.nodes.horizontal_rule.create()]))
    expect(outline(next.doc)).toEqual(['p:a', 'hr', 'p:'])
    expect(next.selection.$from.parent.type.name).toBe('paragraph')
    expect(next.selection.$from.parent.content.size).toBe(0)
  })

  it('splits a list when the block is not a list item', () => {
    const state = stateAt(docOf(ul(li(null, 'a'), li(null, 'b'))), 'a')
    const next = state.apply(insertBlocksTr(state, [schema.nodes.horizontal_rule.create()]))
    expect(outline(next.doc)).toEqual(['ul[a]', 'hr', 'ul[b]'])
  })

  it('new empty blocks of a kind go below a block with content', () => {
    const state = stateAt(docOf(p('a')), 'a')
    const next = state.apply(insertBlocksTr(state, buildBlock('todo'), { forceAfter: true }))
    expect(outline(next.doc)).toEqual(['p:a', 'ul[[ ] ]'])
  })
})

describe('delete, duplicate, move', () => {
  it('deleting the only item removes the list; the last block leaves an empty paragraph', () => {
    const doc = docOf(ul(li(null, 'a')))
    const state = stateAt(doc, 'a')
    const next = state.apply(deleteBlockTr(state.tr, 1))
    expect(outline(next.doc)).toEqual(['p:'])
  })

  it('deleting the only child of a quote removes the quote', () => {
    const doc = docOf(p('x'), quote(p('q')))
    const state = stateAt(doc, 'x')
    const pos = doc.child(0).nodeSize + 1
    expect(outline(state.apply(deleteBlockTr(state.tr, pos)).doc)).toEqual(['p:x'])
  })

  it('duplicate puts a copy after and moves the caret into it', () => {
    const state = stateAt(docOf(ul(li(true, 'a'))), 'a')
    const ref = blockAtSelection(state)!
    const next = state.apply(duplicateBlockTr(state, ref))
    expect(outline(next.doc)).toEqual(['ul[[x] a|[x] a]'])
    expect(next.selection.head).toBe(posOf(next.doc, 'a', 'end') + 5)
  })

  it('move up / down swaps with the sibling and keeps the caret', () => {
    const doc = docOf(p('one'), p('two'), p('three'))
    const state = stateAt(doc, 'two', 'end')
    const ref = blockAtSelection(state)!
    const up = state.apply(moveBlockTr(state, ref, -1)!)
    expect(outline(up.doc)).toEqual(['p:two', 'p:one', 'p:three'])
    expect(up.selection.$from.parent.textContent).toBe('two')
    const state2 = stateAt(doc, 'two')
    expect(outline(state2.apply(moveBlockTr(state2, blockAtSelection(state2)!, 1)!).doc)).toEqual(['p:one', 'p:three', 'p:two'])
    const first = stateAt(doc, 'one')
    expect(moveBlockTr(first, blockAtSelection(first)!, -1)).toBeNull()
  })

  it('list items move within their list but never above a toggle summary', () => {
    const state = stateAt(docOf(ul(li(null, 'a'), li(null, 'b'))), 'b')
    expect(outline(state.apply(moveBlockTr(state, blockAtSelection(state)!, -1)!).doc)).toEqual(['ul[b|a]'])
    const t = stateAt(docOf(toggle(true, 'T', p('c'))), 'c')
    expect(moveBlockTr(t, blockAtSelection(t)!, -1)).toBeNull()
  })

  it('drag: a list item dropped among page blocks gets its own list', () => {
    const doc = docOf(p('x'), ul(li(null, 'a'), li(null, 'b')), p('y'))
    const state = stateAt(doc, 'x')
    const aPos = posOf(doc, 'a') - 2
    const tr = moveBlockToTr(state, aPos, 0, 'before')!
    expect(outline(state.apply(tr).doc)).toEqual(['ul[a]', 'p:x', 'ul[b]', 'p:y'])
  })

  it('drag: a block dropped between list items splits the list', () => {
    const doc = docOf(h(2, 'H'), ul(li(null, 'a'), li(null, 'b'), li(null, 'c')))
    const state = stateAt(doc, 'H')
    const aPos = posOf(doc, 'a') - 2
    const tr = moveBlockToTr(state, 0, aPos, 'after')!
    expect(outline(state.apply(tr).doc)).toEqual(['ul[a]', 'h2:H', 'ul[b|c]'])
  })

  it('drag: items reorder inside one list, no-ops and self-drops are refused', () => {
    const doc = docOf(ul(li(null, 'a'), li(null, 'b'), li(null, 'c')))
    const state = stateAt(doc, 'a')
    const a = posOf(doc, 'a') - 2
    const c = posOf(doc, 'c') - 2
    expect(outline(state.apply(moveBlockToTr(state, a, c, 'after')!).doc)).toEqual(['ul[b|c|a]'])
    expect(moveBlockToTr(state, a, a, 'before')).toBeNull()
    expect(moveBlockToTr(state, a, posOf(doc, 'b') - 2, 'before')).toBeNull()
  })

  it('drag: a block cannot be dropped into itself', () => {
    const doc = docOf(toggle(true, 'T', p('c')))
    const state = stateAt(doc, 'c')
    expect(moveBlockToTr(state, 0, posOf(doc, 'c') - 1, 'after')).toBeNull()
  })
})

describe('adjacent lists', () => {
  it('joins lists of one kind (DATA-16) but not different kinds', () => {
    const state = stateAt(docOf(ul(li(null, 'a')), ul(li(null, 'b')), ol(li(null, 'c')), ol(li(null, 'd'))), 'a')
    const tr = state.tr
    expect(joinAdjacentLists(tr)).toBe(true)
    expect(outline(tr.doc)).toEqual(['ul[a|b]', 'ol[c|d]'])
  })
})

describe('colours', () => {
  it('applies and removes text and background colours on a selection', () => {
    const doc = docOf(p('hello world'))
    const state = stateAt(doc, 'world', 'select')
    let next = state
    applyColor(state, (tr) => (next = state.apply(tr)), 'color:red')
    expect(activeColors(next)).toEqual({ color: 'red', bg: null })
    const s2 = next
    applyColor(s2, (tr) => (next = s2.apply(tr)), 'bg:yellow')
    expect(activeColors(next)).toEqual({ color: 'red', bg: 'yellow' })
    const s3 = next
    applyColor(s3, (tr) => (next = s3.apply(tr)), 'color:default')
    expect(activeColors(next).color).toBeNull()
    expect(applyColor(next, undefined, 'color:chartreuse')).toBe(false)
  })

  it('a colour at a caret applies to the next typed text', () => {
    const state = stateAt(docOf(p('a')), 'a')
    let next = state
    applyColor(state, (tr) => (next = state.apply(tr)), 'color:blue')
    expect(next.storedMarks?.[0].type.name).toBe('color')
  })
})

describe('createTable', () => {
  it('has a header row and the requested size', () => {
    const t = createTable(3, 4)
    expect(t.childCount).toBe(3)
    expect(t.firstChild!.childCount).toBe(4)
    expect(t.firstChild!.firstChild!.type.name).toBe('table_header')
    expect(t.child(1).firstChild!.type.name).toBe('table_cell')
    expect(() => t.check()).not.toThrow()
  })
})
