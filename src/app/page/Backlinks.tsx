/** UI-6: 「反向連結」 — the pages that link to this one (from the local index, DATA-17). */
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../lib/store/db'
import { t } from '../../strings'
import { PageIcon } from '../PageIcon'
import { navigate, pageHash } from '../router'

export function Backlinks({ path }: { path: string }) {
  const pages = useLiveQuery(
    () =>
      db()
        .pages.filter((p) => p.links.includes(path) && p.path !== path)
        .toArray(),
    [path],
  )
  if (!pages || pages.length === 0) return null
  return (
    <section className="backlinks" data-print="hide">
      <h2 className="backlinks-title">{t.page.backlinks}</h2>
      <ul>
        {pages.map((p) => (
          <li key={p.key}>
            <a
              href={pageHash(p.key)}
              onClick={(e) => {
                e.preventDefault()
                navigate({ name: 'page', key: p.key })
              }}
            >
              <PageIcon icon={p.icon} size={16} />
              <span>{p.title}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
