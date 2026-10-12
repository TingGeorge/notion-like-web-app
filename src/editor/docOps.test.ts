import { describe, expect, it } from 'vitest'
import { history, undo, undoDepth } from 'prosemirror-history'
import { EditorState, TextSelection } from 'prosemirror-state'
import { schema } from '../lib/schema'
import { replaceDocTr, setContentTr, withToggleState } from './docOps'
import { normalizePlugin, withTrailingParagraph } from './normalize'
import { docOf, h, li, outline, p, posOf, toggle, ul, hr } from './testUtils'

describe('replaceDoc (SYNC-5)', () => {
  it('keeps the caret at the same block index and text offset', () => {
    const doc = docOf(p('first'), p('second block'), p('third'))
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, posOf(doc, 'second block') + 3) })
    // A remote edit changed the text of the block and the one before it.
    const incoming = docOf(p('first (edited)'), p('second block, remote'), p('third'))
    const next = state.apply(replaceDocTr(state, incoming)!)
    expect(outline(next.doc)).toEqual(['p:first (edited)', 'p:second block, remote', 'p:third'])
    const $head = next.selection.$head
    expect($head.index(0)).toBe(1)
    expect($head.parentOffset).toBe(3)
  })

  it('clamps the caret when its block shrank or went away', () => {
    const doc = docOf(p('a'), p('long paragraph here'), p('c'))
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, posOf(doc, 'long paragraph here', 'end')) })
    const next = state.apply(replaceDocTr(state, docOf(p('a'), p('x'), p('c')))!)
    expect(next.selection.$head.index(0)).toBe(1)
    expect(next.selection.$head.parent.textContent).toBe('x')
    const gone = state.apply(replaceDocTr(state, docOf(p('a')))!)
    expect(gone.selection.$head.index(0)).toBe(0)
  })

  it('leaves the caret alone when it was outside the changed part', () => {
    const doc = docOf(p('keep me'), p('change'))
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 3) })
    const next = state.apply(replaceDocTr(state, docOf(p('keep me'), p('changed!')))!)
    expect(next.selection.head).toBe(3)
  })

  it('is flagged silent (no onChange) and not undoable', () => {
    const doc = docOf(p('a'))
    const state = EditorState.create({ doc, plugins: [history()] })
    const tr = replaceDocTr(state, docOf(p('b')))!
    expect(tr.getMeta('gn-silent')).toBe(true)
    expect(tr.getMeta('addToHistory')).toBe(false)
    const next = state.apply(tr)
    expect(undoDepth(next)).toBe(0)
    expect(undo(next, undefined)).toBe(false)
  })

  it('does not break local undo of earlier edits', () => {
    const doc = docOf(p('one'), p('two'))
    let state = EditorState.create({ doc, plugins: [history()] })
    state = state.apply(state.tr.insertText('!', posOf(state.doc, 'one', 'end')))
    expect(undoDepth(state)).toBe(1)
    state = state.apply(replaceDocTr(state, docOf(p('one!'), p('two (remote)')))!)
    expect(undoDepth(state)).toBe(1)
    let undone = state
    undo(state, (tr) => (undone = state.apply(tr)))
    expect(outline(undone.doc)).toEqual(['p:one', 'p:two (remote)'])
  })

  it('returns null when nothing changed', () => {
    const doc = docOf(p('same'))
    expect(replaceDocTr(EditorState.create({ doc }), docOf(p('same')))).toBeNull()
  })

  it('keeps the open state of toggles', () => {
    const old = docOf(toggle(true, 'A', p('x')), toggle(false, 'B', p('y')))
    const incoming = docOf(toggle(false, 'A', p('x2')), toggle(true, 'B', p('y')))
    const merged = withToggleState(old, incoming)
    expect(outline(merged)).toEqual(['toggle(open)[summary:A|p:x2]', 'toggle(closed)[summary:B|p:y]'])
  })

  it('adds the trailing paragraph the editor needs after an atom', () => {
    expect(outline(withTrailingParagraph(docOf(p('a'), hr())))).toEqual(['p:a', 'hr', 'p:'])
    expect(outline(withTrailingParagraph(docOf(p('a'))))).toEqual(['p:a'])
  })
})

describe('setContent (UI-10 starters)', () => {
  it('replaces an empty page', () => {
    const state = EditorState.create({ doc: docOf(p()) })
    const next = state.apply(setContentTr(state, docOf(h(1, 'Title'), p('body'))))
    expect(outline(next.doc)).toEqual(['h1:Title', 'p:body'])
  })

  it('goes at the top of a page that has content', () => {
    const state = EditorState.create({ doc: docOf(p('existing')) })
    const next = state.apply(setContentTr(state, docOf(p('starter'))))
    expect(outline(next.doc)).toEqual(['p:starter', 'p:existing'])
  })
})

describe('normalising plugin (DATA-16)', () => {
  const plugins = [normalizePlugin()]

  it('joins lists that become adjacent', () => {
    const doc = docOf(ul(li(null, 'a')), p('x'), ul(li(null, 'b')))
    const state = EditorState.create({ doc, plugins })
    const next = state.apply(state.tr.delete(doc.child(0).nodeSize, doc.child(0).nodeSize + doc.child(1).nodeSize))
    expect(outline(next.doc)).toEqual(['ul[a|b]'])
  })

  it('appends a paragraph after a trailing divider, and leaves typing alone', () => {
    const doc = docOf(p('a'), p('b'))
    const state = EditorState.create({ doc, plugins })
    const next = state.apply(state.tr.replaceWith(doc.child(0).nodeSize, doc.content.size, schema.nodes.horizontal_rule.create()))
    expect(outline(next.doc)).toEqual(['p:a', 'hr', 'p:'])
    const typed = next.apply(next.tr.insertText('x', 1))
    expect(typed.doc.childCount).toBe(3)
  })

  it('keeps appended changes out of the undo history when the cause was silent', () => {
    const doc = docOf(p('a'))
    const state = EditorState.create({ doc, plugins: [history(), normalizePlugin()] })
    const tr = state.tr.replaceWith(0, doc.content.size, schema.nodes.horizontal_rule.create()).setMeta('addToHistory', false)
    const next = state.apply(tr)
    expect(next.doc.childCount).toBe(2)
    expect(undoDepth(next)).toBe(0)
  })
})
