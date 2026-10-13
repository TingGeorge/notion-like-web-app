import { calloutKindForIcon } from '../../lib/schema'
import { t } from '../../strings'
import { Popover } from '../../ui/primitives'
import { calloutIconOf } from '../nodeViews'
import { useEditorUI, useUIState } from './shared'

/** A small curated set: the five alert icons first (DATA-12), then common ones. */
export const CALLOUT_EMOJIS = [
  'ℹ️', '💡', '❗', '⚠️', '🛑', '📌', '📝', '✅', '❓', '🔥', '⭐', '🎯',
  '🚀', '🧠', '📚', '💬', '🔒', '🎉', '👍', '👀', '🌱', '🔧', '📅', '💰',
  '🍀', '☕', '🏠', '❤️', '🔔', '📎', '🔍', '🧩', '⚡', '🌈', '🐛', '🎨',
]

/** Emoji picker for the callout icon. */
export function EmojiPicker() {
  const { view, ctx } = useEditorUI()
  const ui = useUIState(ctx)
  const picker = ui.emoji
  if (!picker) return null
  const node = view.state.doc.nodeAt(picker.pos)
  const current = node ? calloutIconOf(node) : ''
  const close = () => {
    ctx.ui.set({ emoji: null })
    view.focus()
  }
  return (
    <Popover anchor={picker.anchor} onClose={close} className="gn-emoji-popover">
      <div className="gn-emoji-grid" role="group" aria-label={t.editor.pickIcon}>
        {CALLOUT_EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            className={e === current ? 'gn-emoji is-current' : 'gn-emoji'}
            aria-label={e}
            onClick={() => {
              const { kind, icon } = calloutKindForIcon(e)
              view.dispatch(view.state.tr.setNodeMarkup(picker.pos, null, { kind, icon }))
              close()
            }}
          >
            {e}
          </button>
        ))}
      </div>
    </Popover>
  )
}
