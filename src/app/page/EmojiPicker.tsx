/** 加入圖示 (UI-2): a small emoji picker with categories, 隨機 and 移除. */
import { useState } from 'react'
import { t } from '../../strings/zh-TW'
import { cx } from '../../ui/primitives'
import './pickers.css'

const CATEGORIES: { name: string; emojis: string }[] = [
  { name: '常用', emojis: '📝📄📘📗📕📒📓📔📚🗂️📁📌📍✅☑️💡⭐️🔥🚀🎯🧠💬📅🗓️⏰🏠💼🧳✈️🍳🔍🎨🎵💰📈🛒❤️' },
  { name: '人物', emojis: '😀😃😄😁😆😅😂🙂😉😊😇🥰😍🤩😘😋😜🤓😎🤔🤨😐😴😷🤒🥳😭😤😡👍👎👏🙌🙏💪👀🧑‍💻👩‍🍳👨‍🏫🧑‍🎨' },
  { name: '自然', emojis: '🌱🌿🍀🌵🌴🌳🌲🍁🍂🌸🌼🌻🌹🌷🌙⭐️🌟☀️⛅️🌧️❄️🌈🌊🔥🐶🐱🐭🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🐧🐦🦋🐢🐟🐳' },
  { name: '食物', emojis: '🍎🍊🍋🍌🍉🍇🍓🫐🍒🍑🥭🍍🥝🍅🥑🥦🥕🌽🍞🥐🧀🥚🍳🥞🍔🍟🍕🌭🥪🌮🍜🍝🍣🍱🍙🍚🍛🍲🥗🍰🍪🍩🍫🍿☕️🍵🧋🍺🍷' },
  { name: '活動', emojis: '⚽️🏀🏈⚾️🎾🏐🏓🏸🥊🎽🏃🚴🏊🧘🎮🎲🧩🎯🎳🎸🎹🎺🎻🥁🎤🎧🎬🎨🖌️📷🎭🏆🥇🎉🎁' },
  { name: '旅行', emojis: '🚗🚕🚌🚎🚓🚑🚲🛵🚂🚄🚇✈️🛫🛬🚀🛸⛵️🚢🗺️🗾🏔️⛰️🏕️🏖️🏝️🏛️🏯🏰🗼🗽⛩️🏙️🌃🌉🎡🎢🏨🏠🏡🏢🏥🏫' },
  { name: '物品', emojis: '⌚️📱💻⌨️🖥️🖨️🖱️💾💿📷📹🎥📞☎️📺📻⏰⏳💡🔦🕯️🧯💸💵💳💎⚖️🔧🔨🛠️⚙️🧰🔒🔑🗝️🧪🔬🔭📦📫✏️✒️🖊️🖍️📎📐📏✂️🗑️' },
  { name: '符號', emojis: '❤️🧡💛💚💙💜🖤🤍🤎💯✔️❌⭕️❗️❓⚠️🚫♻️✳️❇️🔆🔅〽️⚜️🔱📛🔰✅☑️🔘🔴🟠🟡🟢🔵🟣⚫️⚪️🟥🟧🟨🟩🟦🟪⬛️⬜️🔶🔷' },
]

const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

function splitEmoji(s: string): string[] {
  return seg ? Array.from(seg.segment(s), (x) => x.segment) : Array.from(s)
}

const ALL = CATEGORIES.map((c) => ({ name: c.name, list: splitEmoji(c.emojis) }))

export function randomEmoji(): string {
  const list = ALL[0].list.concat(ALL[2].list, ALL[3].list, ALL[6].list)
  return list[Math.floor(Math.random() * list.length)]
}

export function EmojiPicker({ onPick, onRemove }: { onPick: (emoji: string) => void; onRemove?: () => void }) {
  const [tab, setTab] = useState(0)
  return (
    <div className="emoji-picker">
      <div className="picker-head">
        <div className="picker-tabs" role="tablist">
          {ALL.map((c, i) => (
            <button key={c.name} role="tab" aria-selected={tab === i} className={cx('picker-tab', tab === i && 'is-active')} onClick={() => setTab(i)}>
              {c.name}
            </button>
          ))}
        </div>
        <div className="picker-actions">
          <button type="button" className="picker-link" onClick={() => onPick(randomEmoji())}>
            {t.page.randomIcon}
          </button>
          {onRemove && (
            <button type="button" className="picker-link" onClick={onRemove}>
              {t.page.removeIcon}
            </button>
          )}
        </div>
      </div>
      <div className="emoji-grid" role="tabpanel">
        {ALL[tab].list.map((e, i) => (
          <button key={`${e}-${i}`} type="button" className="emoji-cell" onClick={() => onPick(e)} aria-label={e}>
            {e}
          </button>
        ))}
      </div>
    </div>
  )
}

export function CoverPicker({ onPick, onUpload, onRemove }: { onPick: (cover: string) => void; onUpload: (file: File) => void; onRemove?: () => void }) {
  return (
    <div className="cover-picker">
      <div className="picker-head">
        <span className="picker-title">{t.page.changeCover}</span>
        {onRemove && (
          <button type="button" className="picker-link" onClick={onRemove}>
            {t.page.removeCover}
          </button>
        )}
      </div>
      <div className="cover-grid">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
          <button
            key={n}
            type="button"
            className="cover-cell"
            style={{ background: `var(--cover-${n})` }}
            onClick={() => onPick(`gradient:${n}`)}
            aria-label={`gradient ${n}`}
          />
        ))}
      </div>
      <label className="btn btn-secondary btn-sm cover-upload">
        {t.editor.blocks.image}…
        <input
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onUpload(file)
            e.target.value = ''
          }}
        />
      </label>
    </div>
  )
}
