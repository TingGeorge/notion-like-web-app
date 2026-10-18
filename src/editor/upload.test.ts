// @vitest-environment happy-dom
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import type { EditorContext } from './context'
import { normalizePlugin } from './normalize'
import { docOf, h, outline, p, posOf } from './testUtils'
import type { UploadResult } from './types'
import { insertFiles, uploadKey, uploadPlugin } from './upload'

let views: EditorView[] = []
afterEach(() => {
  views.forEach((v) => v.destroy())
  views = []
})

function viewFor(doc: ReturnType<typeof docOf>, needle: string) {
  const state = EditorState.create({ doc, plugins: [uploadPlugin(), normalizePlugin()] })
  const view = new EditorView(document.createElement('div'), {
    state: state.apply(state.tr.setSelection(TextSelection.create(doc, posOf(doc, needle, 'end')))),
  })
  views.push(view)
  return view
}

function ctxWith(upload: (f: File) => Promise<UploadResult>): EditorContext {
  return { services: () => ({ uploadFile: upload }) } as unknown as EditorContext
}

const image = (name: string) => new File(['x'], name, { type: 'image/png' })
const ok = async (f: File): Promise<UploadResult> => ({ href: `/_assets/${f.name}`, name: f.name, isImage: true })
const srcs = (view: EditorView) => {
  const out: string[] = []
  view.state.doc.descendants((n) => {
    if (n.type.name === 'image') out.push(n.attrs.src as string)
  })
  return out
}

describe('insertFiles', () => {
  it('inserts every image, in order, in place of an empty paragraph', async () => {
    const view = viewFor(docOf(h(1, 'Title'), p(''), p('after')), 'Title')
    // Put the caret in the empty paragraph.
    const empty = view.state.doc.child(0).nodeSize + 1
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, empty)))
    await insertFiles(view, [image('a.png'), image('b.png'), image('c.png')], ctxWith(ok))
    expect(srcs(view)).toEqual(['/_assets/a.png', '/_assets/b.png', '/_assets/c.png'])
    expect(outline(view.state.doc)[0]).toBe('h1:Title')
    expect(outline(view.state.doc).at(-1)).toBe('p:after')
    expect(uploadKey.getState(view.state)!.find()).toHaveLength(0)
  })

  it('inserts every image, in order, below a non-empty block', async () => {
    const view = viewFor(docOf(p('one'), p('two')), 'one')
    await insertFiles(view, [image('a.png'), image('b.png'), image('c.png')], ctxWith(ok))
    expect(srcs(view)).toEqual(['/_assets/a.png', '/_assets/b.png', '/_assets/c.png'])
    expect(outline(view.state.doc)[0]).toBe('p:one')
    expect(outline(view.state.doc).at(-1)).toBe('p:two')
  })

  it('keeps the order when later uploads finish first', async () => {
    const view = viewFor(docOf(p(''), p('after')), 'after')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
    const delays: Record<string, number> = { 'a.png': 30, 'b.png': 10, 'c.png': 0 }
    const slow = (f: File) => new Promise<UploadResult>((r) => setTimeout(() => r({ href: `/_assets/${f.name}`, name: f.name, isImage: true }), delays[f.name]))
    await insertFiles(view, [image('a.png'), image('b.png'), image('c.png')], ctxWith(slow))
    expect(srcs(view)).toEqual(['/_assets/a.png', '/_assets/b.png', '/_assets/c.png'])
  })

  it('still inserts the others when the first upload fails', async () => {
    const view = viewFor(docOf(p(''), p('after')), 'after')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
    const failFirst = (f: File) => (f.name === 'a.png' ? Promise.reject(new Error('nope')) : ok(f))
    await insertFiles(view, [image('a.png'), image('b.png'), image('c.png')], ctxWith(failFirst))
    expect(srcs(view)).toEqual(['/_assets/b.png', '/_assets/c.png'])
  })

  it('leaves no empty lines between images at the end of the page, and keeps the caret after them', async () => {
    const view = viewFor(docOf(p('上面'), p('')), '上面')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.content.size - 1)))
    await insertFiles(view, [image('a.png'), image('b.png'), image('c.png')], ctxWith(ok))
    expect(outline(view.state.doc)).toEqual(['p:上面', 'image', 'image', 'image', 'p:'])
    expect(srcs(view)).toEqual(['/_assets/a.png', '/_assets/b.png', '/_assets/c.png'])
    // Typing goes into the trailing paragraph, not over an image.
    const sel = view.state.selection
    expect(sel).toBeInstanceOf(TextSelection)
    expect(sel.$from.parent.type.name).toBe('paragraph')
    expect(sel.from).toBe(view.state.doc.content.size - 1)
  })

  it('leaves no empty lines when inserting below the last block', async () => {
    const view = viewFor(docOf(p('one')), 'one')
    await insertFiles(view, [image('a.png'), image('b.png')], ctxWith(ok))
    expect(outline(view.state.doc)).toEqual(['p:one', 'image', 'image', 'p:'])
    expect(view.state.selection.$from.parent.textContent).toBe('one')
  })

  it('runs at most three uploads at a time', async () => {
    const view = viewFor(docOf(p('one')), 'one')
    let active = 0
    let peak = 0
    const counted = async (f: File) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return ok(f)
    }
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => image(`${n}.png`))
    await insertFiles(view, files, ctxWith(counted))
    expect(peak).toBe(3)
    expect(srcs(view)).toEqual(files.map((f) => `/_assets/${f.name}`))
  })
})
