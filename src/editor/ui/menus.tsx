import { NOTION_COLORS } from '../../lib/schema'
import { t } from '../../strings'
import { CONVERTIBLE_KINDS, type BlockKind } from '../blocks'
import type { MenuEntry } from './EditorMenu'
import { ITEM_ICONS } from './shared'

export function TextSwatch({ name }: { name: string | null }) {
  return (
    <span className="color-swatch is-text" style={{ color: name ? `var(--palette-text-${name})` : 'var(--text-primary)' }}>
      A
    </span>
  )
}

export function BgSwatch({ name }: { name: string | null }) {
  return <span className="color-swatch is-bg" style={{ background: name ? `var(--palette-bg-${name})` : 'transparent' }} />
}

/** UI-8: 預設 + nine text colours, then 預設 + nine background colours; a check on the current one. */
export function colorEntries(
  current: { color: string | null; bg: string | null },
  pick: (spec: string) => void,
): MenuEntry[] {
  const entries: MenuEntry[] = [{ type: 'section', label: t.editor.textColor }]
  entries.push({
    key: 'color:default',
    label: t.editor.defaultColor,
    icon: <TextSwatch name={null} />,
    checked: current.color === null,
    onSelect: () => pick('color:default'),
  })
  for (const name of NOTION_COLORS) {
    entries.push({
      key: `color:${name}`,
      label: t.editor.colors[name],
      icon: <TextSwatch name={name} />,
      checked: current.color === name,
      onSelect: () => pick(`color:${name}`),
    })
  }
  entries.push({ type: 'section', label: t.editor.bgColor })
  entries.push({
    key: 'bg:default',
    label: t.editor.defaultColor,
    icon: <BgSwatch name={null} />,
    checked: current.bg === null,
    onSelect: () => pick('bg:default'),
  })
  for (const name of NOTION_COLORS) {
    entries.push({
      key: `bg:${name}`,
      label: t.editor.bgColors[name],
      icon: <BgSwatch name={name} />,
      checked: current.bg === name,
      onSelect: () => pick(`bg:${name}`),
    })
  }
  return entries
}

/** 文字 ▾ / 轉換成…: the block types a block can become. */
export function turnIntoEntries(
  current: BlockKind | null,
  can: (kind: BlockKind) => boolean,
  pick: (kind: BlockKind) => void,
): MenuEntry[] {
  return CONVERTIBLE_KINDS.map((kind) => {
    const Icon = ITEM_ICONS[kind]
    return {
      key: kind,
      label: t.editor.blocks[kind],
      icon: <Icon size={16} />,
      checked: current === kind,
      disabled: !can(kind),
      onSelect: () => pick(kind),
    }
  })
}
