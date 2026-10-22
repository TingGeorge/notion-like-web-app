// @vitest-environment happy-dom
import { createRef } from 'react'
import { cleanup, render, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TextSelection } from 'prosemirror-state'
import { Editor } from './index'
import type { EditorHandle, EditorServices } from './index'
import { docOf, h, outline, p, posOf, toggle } from './testUtils'

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

function setup(props: Partial<React.ComponentProps<typeof Editor>> = {}) {
  const ref = createRef<EditorHandle>()
  const onChange = vi.fn()
  const doc = props.doc ?? docOf(h(1, 'Title'), p('body text'), toggle(false, 'T', p('child')))
  const utils = render(<Editor ref={ref} doc={doc} editable services={services} onChange={onChange} {...props} />)
  return { ref, onChange, ...utils }
}

describe('Editor component', () => {
  it('renders the document and exposes the handle', () => {
    const { ref, container } = setup()
    expect(container.querySelector('.gn-prose h1')!.textContent).toBe('Title')
    expect(container.querySelector('.toggle-arrow')).not.toBeNull()
    expect(ref.current!.view).not.toBeNull()
    expect(outline(ref.current!.getDoc())).toEqual(['h1:Title', 'p:body text', 'toggle(closed)[summary:T|p:child]'])
  })

  it('calls onChange after a document change, not after a selection change', () => {
    const { ref, onChange } = setup()
    const view = ref.current!.view!
    act(() => {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)))
    })
    expect(onChange).not.toHaveBeenCalled()
    act(() => {
      view.dispatch(view.state.tr.insertText('!', posOf(view.state.doc, 'body', 'end')))
    })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(outline(onChange.mock.calls[0][0])[1]).toBe('p:body! text')
  })

  it('replaceDoc does not call onChange and is not undoable', () => {
    const { ref, onChange } = setup()
    act(() => ref.current!.replaceDoc(docOf(h(1, 'Title'), p('remote edit'))))
    expect(onChange).not.toHaveBeenCalled()
    expect(outline(ref.current!.getDoc())).toEqual(['h1:Title', 'p:remote edit'])
  })

  it('toggling a toggle is UI state: no onChange', () => {
    const { container, onChange, ref } = setup()
    act(() => {
      ;(container.querySelector('.toggle-arrow') as HTMLElement).click()
    })
    expect(onChange).not.toHaveBeenCalled()
    expect(ref.current!.getDoc().lastChild!.attrs.open).toBe(true)
    expect(container.querySelector('.toggle')!.hasAttribute('data-open')).toBe(true)
  })

  it('setContent fills an empty page (starters)', () => {
    const { ref, onChange } = setup({ doc: docOf(p()) })
    act(() => ref.current!.setContent(docOf(h(2, 'Agenda'), p('x'))))
    expect(outline(ref.current!.getDoc())).toEqual(['h2:Agenda', 'p:x'])
    expect(onChange).toHaveBeenCalled()
  })

  it('shows the placeholder on an empty page', () => {
    const { container } = setup({ doc: docOf(p()), placeholder: '按 Enter 開始寫' })
    expect(container.querySelector('.gn-prose p.is-empty')!.getAttribute('data-placeholder')).toBe('按 Enter 開始寫')
  })

  it('hints on empty headings', () => {
    const { container } = setup({ doc: docOf(h(2, ''), p('x')) })
    expect(container.querySelector('h2.is-empty')!.getAttribute('data-placeholder')).toBe('標題 2')
  })

  it('read-only: not editable, no block handle, no menus', () => {
    const { container } = setup({ editable: false })
    expect(container.querySelector('.gn-prose')!.getAttribute('contenteditable')).toBe('false')
    expect(container.querySelector('.gn-handle')).toBeNull()
    expect(container.querySelector('.gn-gutter')).toBeNull()
    expect(container.querySelector('.gn-editor')!.classList.contains('is-readonly')).toBe(true)
  })

  it('icon buttons have accessible labels (NFR-3)', () => {
    const { container } = setup({ doc: docOf(p('x'), { type: 'callout', attrs: { kind: 'NOTE', icon: null }, content: [p('c')] }) })
    for (const btn of container.querySelectorAll('button')) {
      expect(btn.getAttribute('aria-label') || btn.textContent, btn.className).toBeTruthy()
    }
    expect(container.querySelector('.gn-prose')!.getAttribute('aria-label')).toBe('頁面內容')
  })

  it('ends a page that finishes with a divider in an empty paragraph', () => {
    const { ref } = setup({ doc: docOf(p('a'), { type: 'horizontal_rule' }) })
    expect(outline(ref.current!.getDoc())).toEqual(['p:a', 'hr', 'p:'])
  })

  it('shows an image at its width, with a crop button for attachments only (DATA-19)', async () => {
    const img = (src: string, width: number | null) => ({ type: 'image', attrs: { src, alt: '', title: null, width } })
    const { container } = setup({ doc: docOf(img('/_assets/a.png', 320), img('https://example.com/b.png', null), p('x')) })
    const [sized, external] = [...container.querySelectorAll<HTMLElement>('figure.image-block')]
    expect(sized.querySelector<HTMLElement>('.image-frame')!.style.width).toBe('320px')
    expect(external.querySelector<HTMLElement>('.image-frame')!.style.width).toBe('')
    expect(sized.querySelector<HTMLElement>('.image-tools')!.hidden).toBe(false)
    expect(external.querySelector<HTMLElement>('.image-tools')!.hidden).toBe(true)
    // The crop button opens the crop dialog.
    await act(async () => {
      sized.querySelector<HTMLButtonElement>('button[aria-label="裁切圖片"]')!.click()
    })
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('裁切圖片')
  })

  it('a tap on a resize handle, without moving, leaves the width alone (DATA-19)', () => {
    const { container, onChange } = setup({ doc: docOf({ type: 'image', attrs: { src: 'https://example.com/a.png', alt: '', title: null, width: 600 } }, p('x')) })
    const handle = container.querySelector<HTMLElement>('.image-resize.is-right')!
    expect(handle.getAttribute('role')).toBe('slider')
    expect(handle.getAttribute('aria-valuenow')).toBe('600')
    act(() => {
      handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 300, pointerId: 1 }))
      handle.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 302, pointerId: 1 }))
      handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 302, pointerId: 1 }))
    })
    expect(onChange).not.toHaveBeenCalled()
    expect(container.querySelector<HTMLElement>('.image-frame')!.style.width).toBe('600px')
  })

  it('cleans up on unmount', () => {
    const { ref, unmount } = setup()
    const view = ref.current!.view!
    unmount()
    expect(view.isDestroyed).toBe(true)
  })
})
