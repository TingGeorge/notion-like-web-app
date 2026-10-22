/**
 * LINK-5: remember the gist that holds a shown code, so a gist left behind by an app that was closed
 * (or a phone that went to sleep) while the code was shown is deleted at the next start.
 */
import type { GitHubClient } from '../../lib/github/client'
import { LINK_GIST_SECONDS } from '../../lib/link/gist'
import { db } from '../../lib/store/db'

export async function rememberLinkGist(id: string | null): Promise<void> {
  if (id) await db().config.put({ key: 'linkGist', value: { id, createdAt: Date.now() } })
  else await db().config.delete('linkGist')
}

/** Deletes the remembered gist once it is older than a code lives (a code shown in another tab is left alone). */
export async function deleteLeftoverLinkGist(client: GitHubClient, now = Date.now()): Promise<void> {
  const row = await db().config.get('linkGist')
  if (row?.key !== 'linkGist' || now - row.value.createdAt < LINK_GIST_SECONDS * 1000) return
  try {
    await client.deleteGist(row.value.id)
    await db().config.delete('linkGist')
  } catch {
    // Offline or no longer allowed: try again at the next start.
  }
}
