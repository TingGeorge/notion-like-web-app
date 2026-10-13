/**
 * SYNC-9: the commit message for one push, derived from the set of changes.
 *
 *   更新「會議記錄」      ← or 更新 3 頁 / 新增「x」 / 移動「x」到「y」 / 刪除「x」 / 上傳圖片 …
 *                         ← blank line
 *   Device: iPhone · Safari
 *   App: GitHub Notes 0.1.0
 */
import { basename, childDirOf, dirname, isInside, parentPagePathOf, titleOf, trashEntryIdOf } from '../data/names'
import { parseTrashIndex } from '../data/notesFiles'
import { readPageMeta, splitPageFile } from '../markdown/frontmatter'
import { t } from '../../strings'
import { TRASH_INDEX_PATH, type FileKind } from '../types'

export type PushChange =
  | { op: 'write'; path: string; kind: FileKind; text: string; baseText: string | null; movedFrom?: string | null }
  | { op: 'delete'; path: string; kind: FileKind; baseText: string | null; movedTo?: string | null }
  | { op: 'upload'; path: string }

type OpType = 'add' | 'update' | 'delete' | 'move' | 'rename' | 'restore' | 'purge' | 'resolve'

interface Op {
  type: OpType
  /** Path the op is about (the old path for moves); used to fold child pages into their parent. */
  path: string
  text: string
}

const IMAGE = /\.(png|jpe?g|gif|webp|avif|heic|heif|bmp|svg)$/i

export function appVersion(): string {
  return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
}

/** DATA-5: the title of a page file. */
export function titleOfText(path: string, text: string | null): string {
  let fmTitle: string | null = null
  if (text) {
    const { frontmatter, hadFrontmatter } = splitPageFile(text)
    if (hadFrontmatter) fmTitle = readPageMeta(frontmatter).title
  }
  return titleOf(path, fmTitle)
}

function idOf(text: string | null): string | null {
  if (!text) return null
  const { frontmatter, hadFrontmatter } = splitPageFile(text)
  return hadFrontmatter ? readPageMeta(frontmatter).id : null
}

/**
 * The first line of the commit message.
 * `titleAt(path)` returns the title of the page at a path in the pushed state, if there is one;
 * it is used for 「移動「x」到「<parent>」」.
 */
export function commitSummary(changes: PushChange[], titleAt: (path: string) => string | null = () => null): string {
  const deletes = changes.filter((c): c is Extract<PushChange, { op: 'delete' }> => c.op === 'delete' && c.kind !== 'blob' && c.kind !== 'meta')
  const writes = changes.filter((c): c is Extract<PushChange, { op: 'write' }> => c.op === 'write' && c.kind !== 'blob' && c.kind !== 'meta')
  const uploads = changes.filter((c) => c.op === 'upload')
  const metaOnly = changes.some((c) => c.op !== 'upload' && c.kind === 'meta')

  const indexWrite = changes.find((c) => c.op === 'write' && c.path === TRASH_INDEX_PATH)
  const trashEntries = new Map(
    (indexWrite?.op === 'write' ? parseTrashIndex(indexWrite.text).value.entries : []).map((e) => [e.id, e] as const),
  )
  const writeAt = new Map(writes.map((w) => [w.path, w]))
  const pairedWrites = new Set<string>()
  const ops: Op[] = []
  const unpairedDeletes: typeof deletes = []

  for (const d of deletes) {
    let w = d.movedTo ? writeAt.get(d.movedTo) : undefined
    if (!w) w = writes.find((x) => x.movedFrom === d.path)
    if (!w) {
      const id = idOf(d.baseText)
      if (id) w = writes.find((x) => x.baseText === null && !pairedWrites.has(x.path) && idOf(x.text) === id)
    }
    if (!w || pairedWrites.has(w.path)) {
      unpairedDeletes.push(d)
      continue
    }
    pairedWrites.add(w.path)
    if (d.kind === 'page' && w.kind === 'trash') ops.push({ type: 'delete', path: d.path, text: titleOfText(d.path, d.baseText) })
    else if (d.kind === 'trash' && w.kind === 'page') ops.push({ type: 'restore', path: d.path, text: titleOfText(w.path, w.text) })
    else if (d.kind === 'page' && w.kind === 'page') {
      const title = titleOfText(w.path, w.text)
      if (dirname(d.path) === dirname(w.path)) {
        ops.push({ type: 'rename', path: d.path, text: t.commit.rename(titleOfText(d.path, d.baseText), title) })
      } else {
        const parent = parentPagePathOf(w.path)
        const parentTitle = parent ? (titleAt(parent) ?? basename(dirname(w.path))) : null
        ops.push({ type: 'move', path: d.path, text: parentTitle === null ? t.commit.moveToRoot(title) : t.commit.move(title, parentTitle) })
      }
    }
  }
  for (const d of unpairedDeletes) {
    if (d.kind === 'page') ops.push({ type: 'delete', path: d.path, text: titleOfText(d.path, d.baseText) })
    else if (d.kind === 'trash') ops.push({ type: 'purge', path: d.path, text: titleOfText(d.path, d.baseText) })
  }
  for (const w of writes) {
    if (pairedWrites.has(w.path)) continue
    if (w.kind === 'page') ops.push({ type: w.baseText === null ? 'add' : 'update', path: w.path, text: titleOfText(w.path, w.text) })
    else if (w.kind === 'trash' && w.baseText === null) {
      // A version saved to the trash on its own: replaced in a conflict, or a page that never reached GitHub.
      const entry = trashEntries.get(trashEntryIdOf(w.path) ?? '')
      const title = entry?.title || titleOfText(w.path, w.text)
      ops.push({ type: entry?.reason === 'deleted' ? 'delete' : 'resolve', path: w.path, text: title })
    }
  }

  // Child pages that moved, got deleted, restored, purged or added along with their parent fold into it.
  const folded = ops.filter(
    (op) => op.type === 'update' || !ops.some((other) => other !== op && other.type !== 'update' && isInside(op.path, childDirOf(other.path))),
  )
  const structural = folded.filter((op) => op.type !== 'update')
  const updates = folded.filter((op) => op.type === 'update')

  if (structural.length === 1) {
    const op = structural[0]
    switch (op.type) {
      case 'add':
        return t.commit.add(op.text)
      case 'delete':
        return t.commit.delete(op.text)
      case 'restore':
        return t.commit.restore(op.text)
      case 'purge':
        return t.commit.purge(op.text)
      case 'resolve':
        return t.commit.resolveConflict(op.text)
      default:
        return op.text
    }
  }
  if (structural.length > 1) return t.commit.updateMany(structural.length + updates.length)
  if (updates.length === 1) return t.commit.update(updates[0].text)
  if (updates.length > 1) return t.commit.updateMany(updates.length)
  if (uploads.length > 0) return uploads.every((u) => IMAGE.test(u.path)) ? t.commit.uploadImage : t.commit.uploadFile
  if (metaOnly) return t.commit.settings
  return t.commit.settings
}

/** SYNC-9: summary, blank line, `Device:` and `App:` trailers. */
export function commitMessage(summary: string, deviceName: string, version = appVersion()): string {
  return `${summary}\n\nDevice: ${deviceName}\nApp: GitHub Notes ${version}`
}
