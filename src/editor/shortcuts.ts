/**
 * Keyboard shortcuts (SPEC §7.1). Matching is done on `event.code` where `⌥` is involved, because
 * `⌥` changes `event.key` on a Mac. Nothing here reacts while an IME is composing (UI-17).
 *
 * Deliberately NOT bound (the app owns them): ⌘K without a selection, ⌘P, ⌘⌥N, ⌘\, ⌘⇧L, ⌘[ ⌘].
 */
import { chainCommands } from 'prosemirror-commands'
import { redo, undo } from 'prosemirror-history'
import { undoInputRule } from 'prosemirror-inputrules'
import { toggleMark } from 'prosemirror-commands'
import { NodeSelection, Plugin, PluginKey, type Command } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { schema } from '../lib/schema'
import { turnIntoAtSelection, type BlockKind } from './blocks'
import {
  backspaceToText,
  baseBackspace,
  duplicateBlock,
  enterInListItem,
  enterInTableCell,
  enterInToggleSummary,
  enterOnNodeSelection,
  exitCodeBlock,
  indentListItem,
  insertHardBreak,
  moveBlock,
  newlineInCodeBlock,
  outdentListItem,
  selectBlock,
  tabInTable,
  toggleCheckOrOpen,
} from './commands'
import { createParagraphNear, liftEmptyBlock, splitBlockKeepMarks } from 'prosemirror-commands'
import type { EditorContext } from './context'

export type MarkShortcut = 'bold' | 'italic' | 'underline' | 'strike' | 'code'

export type ShortcutAction =
  | { type: 'mark'; mark: MarkShortcut }
  | { type: 'link' }
  | { type: 'turn'; kind: BlockKind }
  | { type: 'check' }
  | { type: 'duplicate' }
  | { type: 'move'; dir: -1 | 1 }
  | { type: 'undo' }
  | { type: 'redo' }

/** ⌘⌥0 … ⌘⌥8. */
export const DIGIT_KINDS: BlockKind[] = ['text', 'h1', 'h2', 'h3', 'todo', 'bullet', 'number', 'toggle', 'code']

export interface KeyLike {
  key: string
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  return /Mac|iPhone|iPad|iPod/.test(nav.userAgentData?.platform ?? navigator.platform ?? '')
}

export function resolveShortcut(e: KeyLike, mac: boolean): ShortcutAction | null {
  // Block type digits: ⌘⌥<n> on a Mac, Ctrl+Shift+<n> elsewhere (matched on the physical key).
  const digit = /^(?:Digit|Numpad)([0-8])$/.exec(e.code)
  if (digit) {
    const ok = mac ? e.metaKey && e.altKey && !e.ctrlKey && !e.shiftKey : e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey
    return ok ? { type: 'turn', kind: DIGIT_KINDS[Number(digit[1])] } : null
  }
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  if (!mod || e.altKey) return null
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (!e.shiftKey) {
    switch (key) {
      case 'b':
        return { type: 'mark', mark: 'bold' }
      case 'i':
        return { type: 'mark', mark: 'italic' }
      case 'u':
        return { type: 'mark', mark: 'underline' }
      case 'e':
        return { type: 'mark', mark: 'code' }
      case 'k':
        return { type: 'link' }
      case 'd':
        return { type: 'duplicate' }
      case 'Enter':
        return { type: 'check' }
      case 'z':
        return { type: 'undo' }
      case 'y':
        return mac ? null : { type: 'redo' }
    }
    return null
  }
  switch (key) {
    case 's':
      return { type: 'mark', mark: 'strike' }
    case 'z':
      return { type: 'redo' }
    case 'ArrowUp':
      return { type: 'move', dir: -1 }
    case 'ArrowDown':
      return { type: 'move', dir: 1 }
  }
  return null
}

const enterChain: Command = chainCommands(
  enterOnNodeSelection,
  newlineInCodeBlock,
  enterInToggleSummary,
  enterInListItem,
  enterInTableCell,
  createParagraphNear,
  liftEmptyBlock,
  splitBlockKeepMarks,
)

/** Whether the caret is on the first line of the first text block of the page. */
function onFirstLine(view: EditorView): boolean {
  const { selection, doc } = view.state
  if (!selection.empty) return false
  const first = doc.firstChild
  if (!first) return false
  const $head = selection.$head
  // First textblock: the first leaf-most descendant.
  let node = first
  let start = 0
  while (!node.isTextblock && node.firstChild) {
    node = node.firstChild
    start += 1
  }
  return node.isTextblock && $head.parent === node && $head.start() === start + 1 && view.endOfTextblock('up')
}

export function runShortcut(view: EditorView, action: ShortcutAction, ctx: EditorContext): boolean {
  const { state, dispatch } = view
  switch (action.type) {
    case 'mark':
      return toggleMark(schema.marks[action.mark])(state, dispatch)
    case 'link':
      if (state.selection.empty) return false // ⌘K without a selection is the app's search
      ctx.ui.set({ link: { mode: 'mark', anchor: null }, toolbarMenu: 'link' })
      return true
    case 'turn':
      turnIntoAtSelection(state, dispatch, action.kind)
      return true
    case 'check':
      if (state.selection.$from.parent.type.spec.code) return exitCodeBlock(state, dispatch)
      return toggleCheckOrOpen(state, dispatch)
    case 'duplicate':
      return duplicateBlock(state, dispatch)
    case 'move':
      return moveBlock(action.dir)(state, dispatch)
    case 'undo':
      return undo(state, dispatch)
    case 'redo':
      return redo(state, dispatch)
  }
}

export function isComposingEvent(view: EditorView, event: KeyboardEvent): boolean {
  return view.composing || event.isComposing || event.keyCode === 229
}

/** Handle a keydown for the editor. Exported for tests. */
export function handleEditorKeyDown(view: EditorView, event: KeyboardEvent, ctx: EditorContext): boolean {
  if (isComposingEvent(view, event)) return false
  const action = resolveShortcut(event, isMacPlatform())
  if (action) {
    if (runShortcut(view, action, ctx)) {
      event.preventDefault()
      return true
    }
    return false
  }
  const plain = !event.metaKey && !event.ctrlKey && !event.altKey
  const run = (cmd: Command) => cmd(view.state, view.dispatch, view)
  switch (event.key) {
    case 'Enter':
      if (event.metaKey || event.ctrlKey) return false
      if (event.shiftKey) return run(insertHardBreak)
      return run(enterChain)
    case 'Backspace':
      if (!plain || event.shiftKey) return false
      return run(chainCommands(undoInputRule, backspaceToText(ctx.onExitTop), baseBackspace))
    case 'Tab': {
      if (event.metaKey || event.ctrlKey || event.altKey) return false
      // With a block selected (after Esc) Tab leaves the editor, so the keyboard is never trapped.
      if (view.state.selection instanceof NodeSelection) return false
      if (view.state.selection.$from.parent.type.name.startsWith('table_')) return run(tabInTable(event.shiftKey ? -1 : 1))
      if (event.shiftKey) run(outdentListItem)
      else run(indentListItem)
      // DATA-13: Tab on a paragraph or heading does nothing; it never moves focus away either.
      return true
    }
    case 'Escape':
      return plain ? run(selectBlock) : false
    case 'ArrowUp':
      if (plain && !event.shiftKey && onFirstLine(view) && ctx.onExitTop()) return true
      return false
  }
  return false
}

export const shortcutsKey = new PluginKey('gn-shortcuts')

export function shortcutsPlugin(ctx: EditorContext): Plugin {
  return new Plugin({
    key: shortcutsKey,
    props: {
      handleKeyDown(view, event) {
        return handleEditorKeyDown(view, event, ctx)
      },
    },
  })
}
