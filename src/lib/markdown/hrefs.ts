/**
 * Which links alone in a paragraph are blocks (§3.4): `[name](/_assets/…)` is a File block,
 * `[Title](/path/Title.md)` (optionally with `#fragment`) is a Link to page block.
 */

/** File block: a root-relative link into `_assets/` (DATA-18). */
export function isFileHref(href: string): boolean {
  return href.startsWith('/_assets/')
}

/** Link to page block: a root-relative link to a `.md` file, optionally with a fragment. */
export function isPageHref(href: string): boolean {
  return /^\/(?!\/)[^?#\n]*\.md(?:#[^\n]*)?$/.test(href)
}

/** The block a link alone in a paragraph becomes, if any. `title` must be null. */
export function aloneLinkKind(href: string, title: string | null): 'file' | 'page_link' | null {
  if (title !== null && title !== '') return null
  if (isFileHref(href)) return 'file'
  if (isPageHref(href)) return 'page_link'
  return null
}
