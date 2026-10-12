// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import { AssetCache, UIStore, type EditorContext } from '../context'
import type { EditorServices, PageRef } from '../types'
import { docOf, li, outline, p, ul } from '../testUtils'
import { BlockMenu } from './BlockMenu'
import { EditorUIContext } from './shared'

const serialize = vi.hoisted(() => vi.fn<(doc: PMNode) => string>())
vi.mock('../../lib/markdown', () => ({ serializeMarkdown: serialize }))

const PAGE: PageRef = { href: '/工作/專案%20A.md', title: '專案 A', icon: null, parentTitle: '工作' }

afterEach(() => {
  cleanup()
  serialize.mockReset()
})

function setup(doc: PMNode, moveBlocksToPage = vi.fn(async () => undefined)) {
  const host = document.createElement('div')
  document.body.append(host)
  const view = new EditorView(host, { state: EditorState.create({ doc }) })
  const services = { searchPages: async () => [PAGE], moveBlocksToPage } as unknown as EditorServices
  const ctx: EditorContext = {
    services: () => services,
    onExitTop: () => false,
    ui: new UIStore(),
    hover: { pos: null },
    view: () => view,
    assets: new AssetCache(async () => null),
  }
  const anchor = document.createElement('button')
  document.body.append(anchor)
  render(
    <EditorUIContext.Provider value={{ view, ctx, mobile: false }}>
      <BlockMenu />
    </EditorUIContext.Provider>,
  )
  const open = (pos: number) => act(() => ctx.ui.set({ blockMenu: { pos, anchor } }))
  return { view, ctx, open, moveBlocksToPage }
}

describe('block menu (UI-3)', () => {
  it('lists 刪除, 複製, 轉換成…, 顏色, 移到頁面…', () => {
    const { open } = setup(docOf(p('one'), p('two')))
    open(0)
    expect(screen.getAllByRole('menuitem').map((e) => e.textContent?.replace('✓', ''))).toEqual(['刪除', '複製', '轉換成…', '顏色', '移到頁面…'])
  })

  it('刪除 removes the block, 複製 duplicates it', () => {
    const { view, open } = setup(docOf(p('one'), p('two')))
    open(0)
    fireEvent.click(screen.getByText('複製'))
    expect(outline(view.state.doc)).toEqual(['p:one', 'p:one', 'p:two'])
    open(0)
    fireEvent.click(screen.getByText('刪除'))
    expect(outline(view.state.doc)).toEqual(['p:one', 'p:two'])
  })

  it('轉換成… lists the block types and converts', () => {
    const { view, open } = setup(docOf(p('one')))
    open(0)
    fireEvent.click(screen.getByText('轉換成…'))
    fireEvent.click(screen.getByText('標題 2'))
    expect(outline(view.state.doc)).toEqual(['h2:one'])
  })

  it('顏色 colours the whole block text', () => {
    const { view, open } = setup(docOf(p('one')))
    open(0)
    fireEvent.click(screen.getByText('顏色'))
    fireEvent.click(screen.getAllByText('橙色')[0])
    expect(view.state.doc.firstChild!.firstChild!.marks[0].attrs.color).toBe('orange')
  })

  it('移到頁面… sends the block as Markdown, then removes it', async () => {
    serialize.mockReturnValue('- a\n')
    const { view, open, moveBlocksToPage } = setup(docOf(ul(li(null, 'a'), li(null, 'b'))))
    open(1) // the first list item
    fireEvent.click(screen.getByText('移到頁面…'))
    fireEvent.click(await screen.findByText('專案 A'))
    await waitFor(() => expect(moveBlocksToPage).toHaveBeenCalledWith('- a\n', '/工作/專案%20A.md'))
    // The item travelled inside its list.
    expect(serialize.mock.calls[0][0].firstChild!.type.name).toBe('bullet_list')
    await waitFor(() => expect(outline(view.state.doc)).toEqual(['ul[b]']))
  })

  it('移到頁面… keeps the block and shows an error when it cannot be done', async () => {
    serialize.mockImplementation(() => {
      throw new Error('markdown: serializeMarkdown is not implemented yet')
    })
    const { view, open, moveBlocksToPage } = setup(docOf(p('keep')))
    open(0)
    fireEvent.click(screen.getByText('移到頁面…'))
    fireEvent.click(await screen.findByText('專案 A'))
    expect((await screen.findByRole('alert')).textContent).toBe('無法移動這個區塊，請再試一次。')
    expect(moveBlocksToPage).not.toHaveBeenCalled()
    expect(outline(view.state.doc)).toEqual(['p:keep'])
  })

  it('移到頁面… keeps the block when the service fails', async () => {
    serialize.mockReturnValue('keep\n')
    const fail = vi.fn(async () => {
      throw new Error('離線，稍後再試')
    })
    const { view, open } = setup(docOf(p('keep')), fail)
    open(0)
    fireEvent.click(screen.getByText('移到頁面…'))
    fireEvent.click(await screen.findByText('專案 A'))
    expect((await screen.findByRole('alert')).textContent).toBe('離線，稍後再試')
    expect(outline(view.state.doc)).toEqual(['p:keep'])
  })
})
