/** Test helpers: terse builders for editor documents. */
import type { Mark, Node as PMNode } from 'prosemirror-model'
import { schema, type NotionColor } from '../../schema'

const n = schema.nodes
const m = schema.marks

type Child = PMNode | string

function kids(children: Child[]): PMNode[] {
  return children.filter((c) => c !== '').map((c) => (typeof c === 'string' ? schema.text(c) : c))
}

export const doc = (...children: PMNode[]): PMNode => n.doc.create(null, children)
export const p = (...children: Child[]): PMNode => n.paragraph.create(null, kids(children))
export const h = (level: number, ...children: Child[]): PMNode => n.heading.create({ level }, kids(children))
export const ul = (...items: PMNode[]): PMNode => n.bullet_list.create(null, items)
export const ol = (start: number, ...items: PMNode[]): PMNode => n.ordered_list.create({ start }, items)
export const li = (...children: PMNode[]): PMNode => n.list_item.create({ checked: null }, children)
export const todo = (checked: boolean, ...children: PMNode[]): PMNode => n.list_item.create({ checked }, children)
export const quote = (...children: PMNode[]): PMNode => n.blockquote.create(null, children)
export const callout = (kind: string, icon: string | null, ...children: PMNode[]): PMNode =>
  n.callout.create({ kind, icon }, children)
export const toggle = (summary: string, ...children: PMNode[]): PMNode =>
  n.toggle.create(null, [n.toggle_summary.create(null, summary ? schema.text(summary) : null), ...children])
export const hr = (): PMNode => n.horizontal_rule.create()
export const code = (language: string, text: string): PMNode =>
  n.code_block.create({ language }, text ? schema.text(text) : null)
export const img = (src: string, alt = '', title: string | null = null): PMNode => n.image.create({ src, alt, title })
export const file = (href: string, name: string): PMNode => n.file.create({ href, name })
export const pageLink = (href: string, title: string): PMNode => n.page_link.create({ href, title })
export const raw = (text: string): PMNode => n.raw.create(null, schema.text(text))
export const br = (...marks: Mark[]): PMNode => n.hard_break.create(null, null, marks)

type Align = 'left' | 'center' | 'right' | null
export const table = (aligns: Align[], ...rows: Child[][][]): PMNode =>
  n.table.create(
    null,
    rows.map((cells, r) =>
      n.table_row.create(
        null,
        cells.map((content, c) => (r === 0 ? n.table_header : n.table_cell).create({ align: aligns[c] ?? null }, kids(content))),
      ),
    ),
  )

/** Text with marks. */
export const t = (text: string, ...marks: Mark[]): PMNode => {
  let set: readonly Mark[] = []
  for (const mk of marks) set = mk.addToSet(set)
  return schema.text(text, set)
}
export const bold = m.bold.create()
export const italic = m.italic.create()
export const strike = m.strike.create()
export const underline = m.underline.create()
export const inlineCode = m.code.create()
export const link = (href: string, title: string | null = null): Mark => m.link.create({ href, title })
export const color = (c: NotionColor): Mark => m.color.create({ color: c })
export const bg = (c: NotionColor): Mark => m.bg.create({ color: c })
