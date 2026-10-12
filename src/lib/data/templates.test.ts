import { describe, expect, it } from 'vitest'
import {
  PAGE_TEMPLATES,
  TEMPLATE_BLANK,
  TEMPLATE_MEETING,
  TEMPLATE_TODO,
  WELCOME_PAGE_BODY,
  WELCOME_PAGE_PATH,
} from './templates'
import { isPagePath } from './names'

describe('templates (UI-10, SETUP-9)', () => {
  const bodies = { TEMPLATE_TODO, TEMPLATE_MEETING, WELCOME_PAGE_BODY }

  it.each(Object.entries(bodies))('%s is written the way the editor writes it', (_name, body) => {
    expect(body.endsWith('\n')).toBe(true)
    expect(body.endsWith('\n\n')).toBe(false)
    expect(body).not.toContain('\r')
    expect(body).not.toMatch(/^\s*\* /m) // `- ` bullets only
    expect(body).not.toMatch(/^\s*-\s*$/m) // no empty items
    expect(body).not.toMatch(/\n\n\n/) // one blank line between blocks
    expect(body).not.toMatch(/ +\n/) // no trailing spaces
    expect((body.match(/^```/gm) ?? []).length % 2).toBe(0)
  })

  it('the blank starter is empty', () => {
    expect(TEMPLATE_BLANK).toBe('')
    expect(PAGE_TEMPLATES.map((p) => p.id)).toEqual(['blank', 'todo', 'meeting'])
    expect(PAGE_TEMPLATES.map((p) => p.label)).toEqual(['空白頁面', '待辦清單', '會議記錄範本'])
  })

  it('the to-do list has unchecked to-dos', () => {
    expect(TEMPLATE_TODO.split('\n').filter(Boolean).every((l) => l.startsWith('- [ ] '))).toBe(true)
  })

  it('the meeting template has the expected sections', () => {
    const headings = TEMPLATE_MEETING.match(/^## .+$/gm)
    expect(headings).toEqual(['## 日期', '## 與會者', '## 議程', '## 決議事項', '## 待辦'])
  })

  it('the welcome page covers the basics and uses only §3.4 constructs', () => {
    for (const word of ['Markdown', '「/」', '同步', '離線', '連結新裝置', '垃圾桶']) expect(WELCOME_PAGE_BODY).toContain(word)
    expect(WELCOME_PAGE_BODY.startsWith('# ')).toBe(true)
    expect(WELCOME_PAGE_BODY).toContain('> [!TIP]')
    expect(WELCOME_PAGE_BODY).toContain('<details>\n<summary>')
    expect(WELCOME_PAGE_BODY).toContain('</details>')
    expect(WELCOME_PAGE_BODY).toContain('\n---\n')
    expect(WELCOME_PAGE_BODY).toContain('- [ ] ')
    // `<details>` is followed and preceded by a blank line (§3.4).
    expect(WELCOME_PAGE_BODY).toMatch(/<\/summary>\n\n[^\n]+\n\n<\/details>/)
    expect(isPagePath(WELCOME_PAGE_PATH)).toBe(true)
  })
})
