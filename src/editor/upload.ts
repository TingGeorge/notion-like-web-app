/**
 * Attachments (UI-18, DATA-18): files are handed to `services.uploadFile` and become image or file
 * blocks. While an upload runs a placeholder widget sits where the block will go.
 */
import { Plugin, PluginKey, Selection, type EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import { schema } from '../lib/schema'
import { t } from '../strings'
import { blockAtPos, blockAtSelection, isEmptyBlock } from './blocks'
import type { EditorContext } from './context'
import { icons } from './icons'
import type { UploadResult } from './types'

const N = schema.nodes

export const uploadKey = new PluginKey<DecorationSet>('gn-upload')

interface UploadMeta {
  add?: Decoration[]
  remove?: string
}

export function uploadPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: uploadKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        set = set.map(tr.mapping, tr.doc)
        const meta = tr.getMeta(uploadKey) as UploadMeta | undefined
        if (meta?.add) set = set.add(tr.doc, meta.add)
        if (meta?.remove) set = set.remove(set.find(undefined, undefined, (spec) => spec.id === meta.remove))
        return set
      },
    },
    props: {
      decorations(state) {
        return uploadKey.getState(state)
      },
    },
  })
}

function placeholderWidget(id: string, file: File, index: number, pos: number): Decoration {
  const dom = document.createElement('div')
  dom.className = 'upload-placeholder'
  dom.contentEditable = 'false'
  dom.setAttribute('role', 'status')
  const isImage = file.type.startsWith('image/')
  dom.innerHTML = `<span class="upload-spinner"></span><span class="upload-icon">${isImage ? icons.image(18) : icons.file(18)}</span><span class="upload-name"></span><span class="upload-state"></span>`
  dom.querySelector('.upload-name')!.textContent = file.name
  dom.querySelector('.upload-state')!.textContent = t.editor.uploading
  return Decoration.widget(pos, dom, { id, side: index, key: id, ignoreSelection: true } as Record<string, unknown>)
}

function findWidget(state: EditorState, id: string): Decoration | undefined {
  return uploadKey.getState(state)?.find(undefined, undefined, (spec) => spec.id === id)[0]
}

/**
 * Where an upload goes: in place of an empty paragraph, otherwise below the block at `pos` (or at
 * the selection). Inside a list the block goes below the whole list.
 *
 * For an empty paragraph the placeholders sit just after it, not at its start: replacing the
 * paragraph would otherwise delete every placeholder still waiting there.
 */
function insertionPoint(state: EditorState, at?: number): { pos: number; mode: 'insert' | 'replace' } {
  const ref = at === undefined ? blockAtSelection(state) : blockAtPos(state.doc, at)
  if (!ref) return { pos: state.doc.content.size, mode: 'insert' }
  if (ref.node.type === N.paragraph && isEmptyBlock(ref.node)) return { pos: ref.pos + ref.node.nodeSize, mode: 'replace' }
  if (ref.node.type === N.list_item) {
    const $p = state.doc.resolve(ref.pos)
    return { pos: $p.after(), mode: 'insert' }
  }
  return { pos: ref.pos + ref.node.nodeSize, mode: 'insert' }
}

function nodeFor(result: UploadResult) {
  return result.isImage
    ? N.image.create({ src: result.href, alt: '' })
    : N.file.create({ href: result.href, name: result.name })
}

/** At most this many uploads run at once: a dozen full-size photos at a time is too much for a phone. */
const MAX_PARALLEL_UPLOADS = 3

/** Start `fn` for each item, at most `max` at a time; the promises keep the items' order. */
function limited<T, R>(items: T[], max: number, fn: (item: T) => Promise<R>): Promise<R>[] {
  let active = 0
  const waiting: Array<() => void> = []
  return items.map(
    (item) =>
      new Promise<R>((resolve, reject) => {
        const run = () => {
          active++
          fn(item)
            .then(resolve, reject)
            .finally(() => {
              active--
              waiting.shift()?.()
            })
        }
        if (active < max) run()
        else waiting.push(run)
      }),
  )
}

/**
 * Upload files and insert them as blocks, in the order given. The first one that succeeds takes
 * the place of the empty paragraph it was dropped on. Errors show in the placeholder for a few
 * seconds.
 */
export async function insertFiles(view: EditorView, files: File[], ctx: EditorContext, at?: number): Promise<void> {
  if (!files.length || !view.editable) return
  const { pos, mode } = insertionPoint(view.state, at)
  let replace = mode === 'replace'
  const ids = files.map(() => `up-${Math.random().toString(36).slice(2)}-${Date.now()}`)
  view.dispatch(
    view.state.tr.setMeta(uploadKey, {
      add: files.map((f, i) => placeholderWidget(ids[i], f, i, pos)),
    } satisfies UploadMeta),
  )
  const uploads = limited(files, MAX_PARALLEL_UPLOADS, (f) =>
    ctx.services().uploadFile(f).then(
      (r) => ({ ok: true as const, r }),
      (e: unknown) => ({ ok: false as const, e }),
    ),
  )
  for (let i = 0; i < files.length; i++) {
    const res = await uploads[i]
    if (view.isDestroyed) return
    const widget = findWidget(view.state, ids[i])
    if (!widget) continue
    if (res.ok) {
      const tr = view.state.tr
      const at = widget.from
      const $at = tr.doc.resolve(at)
      const before = $at.nodeBefore
      const node = nodeFor(res.r)
      // The page's trailing paragraph (normalizePlugin adds one after an image) lands between the
      // block just inserted and the waiting placeholders; it is replaced too, so no gaps remain.
      const trailing = $at.depth === 0 && $at.index() === tr.doc.childCount
      let caretAfter: number | null = null
      if ((replace || trailing) && before && before.type === N.paragraph && before.content.size === 0) {
        const from = at - before.nodeSize
        const { selection } = view.state
        // The caret was in that paragraph: keep it typing after the image, not on it.
        if (selection.from >= from && selection.to <= at) caretAfter = from + node.nodeSize
        tr.replaceWith(from, at, node)
      } else tr.insert(at, node)
      replace = false
      tr.setMeta(uploadKey, { remove: ids[i] } satisfies UploadMeta)
      view.dispatch(tr)
      if (caretAfter !== null) {
        // After dispatch, so the trailing paragraph normalizePlugin appended is there to take it.
        const sel = Selection.findFrom(view.state.doc.resolve(caretAfter), 1, true)
        if (sel) view.dispatch(view.state.tr.setSelection(sel))
      }
    } else {
      const message = res.e instanceof Error && res.e.message ? res.e.message : t.editor.uploadFailed
      showUploadError(view, ids[i], message)
    }
  }
}

function showUploadError(view: EditorView, id: string, message: string) {
  // Replace the widget by an error variant, then drop it after a while.
  const widget = findWidget(view.state, id)
  if (!widget) return
  const dom = document.createElement('div')
  dom.className = 'upload-placeholder is-error'
  dom.contentEditable = 'false'
  dom.setAttribute('role', 'alert')
  dom.textContent = message === t.editor.uploadFailed ? message : t.editor.uploadFailedWith(message)
  const replacement = Decoration.widget(widget.from, dom, { id, side: (widget.spec as { side?: number }).side ?? 0, key: `${id}-err`, ignoreSelection: true } as Record<string, unknown>)
  view.dispatch(view.state.tr.setMeta(uploadKey, { remove: id } satisfies UploadMeta))
  view.dispatch(view.state.tr.setMeta(uploadKey, { add: [replacement] } satisfies UploadMeta))
  setTimeout(() => {
    if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(uploadKey, { remove: id } satisfies UploadMeta))
  }, 5000)
}

/** Open the system file picker; resolves with the chosen files (empty if cancelled). */
export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    if (accept) input.accept = accept
    input.multiple = multiple
    input.style.display = 'none'
    document.body.appendChild(input)
    const done = (files: File[]) => {
      input.remove()
      resolve(files)
    }
    input.addEventListener('change', () => done(Array.from(input.files ?? [])))
    input.addEventListener('cancel', () => done([]))
    input.click()
  })
}
