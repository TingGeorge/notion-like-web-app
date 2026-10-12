// @vitest-environment happy-dom
/**
 * The editor and the Markdown converter must not fight (DATA-9, DATA-16):
 * - opening a page never changes it: loading `parse(md)` for app-written `md` and serializing
 *   the editor's document (after its normalisers ran) gives `md` back;
 * - the editor's normalisers and `canonicalize` agree: serialize → parse → reload → serialize
 *   is byte-identical, so a page that was saved once is never saved again just for being opened.
 * Uses the real `Editor` component (all its plugins, including the normalisers).
 */
import { createRef } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Node as PMNode } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { parseMarkdown, serializeMarkdown } from '../lib/markdown'
import { firstDifference } from '../lib/markdown/testing/diff'
import { randomDoc } from '../lib/markdown/testing/randomDoc'
import { replaceDocTr } from './docOps'
import { Editor } from './index'
import { withTrailingParagraph } from './normalize'
import { looksLikeMarkdown, sliceFromText } from './paste'
import type { EditorHandle, EditorServices } from './index'

afterEach(cleanup)

const services: EditorServices = {
  uploadFile: async (f) => ({ href: `/_assets/${f.name}`, name: f.name, isImage: false }),
  resolveAsset: async () => null,
  createChildPage: async () => ({ href: '/x.md', title: 'x', icon: null }),
  openPage: () => undefined,
  searchPages: async () => [],
  pageInfo: () => null,
  moveBlocksToPage: async () => undefined,
  getLastColor: () => null,
  setLastColor: () => undefined,
}

function mount(doc: PMNode) {
  const ref = createRef<EditorHandle>()
  const onChange = vi.fn()
  const utils = render(<Editor ref={ref} doc={doc} editable services={services} onChange={onChange} />)
  return { ref, onChange, unmount: utils.unmount }
}

/** A structural transaction that changes nothing visible, so the appendTransaction normalisers run. */
function nudge(view: EditorView): void {
  const first = view.state.doc.firstChild
  if (!first) return
  act(() => view.dispatch(view.state.tr.setNodeMarkup(0, null, first.attrs)))
}

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
const SEEDS = Number(env.MD_EDITOR_SEEDS ?? 60)

describe('editor ⇄ Markdown', () => {
  it('replaceDoc (a pull while the page is open) shows exactly the incoming document', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const before = withTrailingParagraph(randomDoc(seed + 20_000, { maxBlocks: 5 }))
      const incoming = parseMarkdown(serializeMarkdown(before))
      const tr = replaceDocTr(EditorState.create({ doc: before }), incoming)
      const after = tr ? tr.doc : before
      // Toggles keep their open state; everything else is the incoming document.
      expect(serializeMarkdown(after), `seed ${seed}`).toBe(serializeMarkdown(incoming))
      expect(after.childCount, `seed ${seed}`).toBe(withTrailingParagraph(incoming).childCount)
    }
  })

  it('pasting app-written Markdown gives the same blocks', () => {
    const editorOnly = new Set(['paragraph', 'text', 'doc'])
    for (let seed = 1; seed <= 200; seed++) {
      const md = serializeMarkdown(randomDoc(seed + 30_000, { maxBlocks: 3 }))
      const doc = parseMarkdown(md)
      let structured = false
      doc.descendants((n) => {
        if (!editorOnly.has(n.type.name) || n.marks.length > 0) structured = true
      })
      // Everything but plain text and Markdown kept raw (HTML blocks, math, definitions) is seen.
      if (structured && !doc.content.content.every((b) => b.type.name === 'raw' || b.type.name === 'paragraph')) {
        expect(looksLikeMarkdown(md), `seed ${seed}: ${JSON.stringify(md)}`).toBe(true)
      }
      if (!looksLikeMarkdown(md)) continue
      const pasted = sliceFromText(md)
      expect(doc.type.create(null, pasted.content).eq(doc), `seed ${seed}`).toBe(true)
    }
  })

  it('opening app-written Markdown in the editor and saving gives the same Markdown', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const md = serializeMarkdown(randomDoc(seed, { maxBlocks: 5 }))
      const { ref, onChange, unmount } = mount(parseMarkdown(md))
      // Opening alone reports no change.
      expect(onChange, `seed ${seed}`).not.toHaveBeenCalled()
      const view = ref.current!.view!
      nudge(view)
      const out = serializeMarkdown(ref.current!.getDoc())
      if (out !== md) throw new Error(`seed ${seed}\nmd:  ${JSON.stringify(md)}\nout: ${JSON.stringify(out)}`)
      unmount()
    }
  }, 120_000)

  it('serialize → parse → reload → serialize is stable for documents edited in the editor', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { ref, unmount } = mount(randomDoc(seed + 10_000, { maxBlocks: 5 }))
      const view = ref.current!.view!
      nudge(view)
      const first = serializeMarkdown(ref.current!.getDoc())
      act(() => ref.current!.replaceDoc(parseMarkdown(first)))
      nudge(view)
      const reloaded = ref.current!.getDoc()
      const second = serializeMarkdown(reloaded)
      if (second !== first) {
        throw new Error(`seed ${seed}\nfirst:  ${JSON.stringify(first)}\nsecond: ${JSON.stringify(second)}`)
      }
      // The normalisers have reached a fixed point: another structural transaction changes nothing.
      nudge(view)
      const diff = firstDifference(reloaded, ref.current!.getDoc())
      expect(diff, `seed ${seed}: ${diff}`).toBeNull()
      unmount()
    }
  }, 120_000)
})
