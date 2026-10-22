/**
 * LINK-5: link a device by typing the GitHub account and a 10-character code, for a device that cannot
 * scan the QR code (no camera, or a broken one).
 *
 * There is no server, and the new device has no token yet, so the encrypted payload (LINK-1, with the
 * longer code) is left for a few minutes in a public gist of the user's account, the only place both
 * devices can reach on `api.github.com`. The new device lists the account's public gists without a
 * token, decrypts the newest link gist with the code, and deletes it with the token it got. The source
 * device deletes it too when the code is hidden, expires or is replaced.
 */
import type { GitHubClient } from '../github/client'
import { decryptLinkPayload, encryptLinkPayload, InvalidPayloadError, WrongPairingCodeError, type LinkData } from './crypto'

export const LINK_GIST_FILE = 'github-notes-link.txt'
export const LINK_GIST_DESCRIPTION = 'GitHub Notes: device link (deleted automatically)'
/** How long the code is shown and the gist kept. */
export const LINK_GIST_SECONDS = 300
/** Link gists looked at, newest first, when the code is typed. */
const CANDIDATES = 3

export class LinkGistNotFoundError extends Error {
  constructor() {
    super('no link gist')
    this.name = 'LinkGistNotFoundError'
  }
}

/** The token may not create gists (no Gists permission, or no `gist` scope). */
export class NoGistPermissionError extends Error {
  constructor() {
    super('no gist permission')
    this.name = 'NoGistPermissionError'
  }
}

/** A gist id from `api.github.com` (hex). Anything else is not fetched. */
const isGistId = (id: string) => /^[0-9a-f]{20,40}$/i.test(id)

/** A GitHub login: letters, digits and single dashes, at most 39 characters. */
export function normalizeLogin(input: string): string | null {
  const login = input.trim().replace(/^@/, '')
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(login) ? login : null
}

/**
 * Source device: encrypt the link data with `code` and leave it in a new public gist. Returns its id
 * and the login it was created under (the one the new device must type, even after a rename).
 */
export async function publishLinkGist(client: GitHubClient, data: LinkData, code: string): Promise<{ id: string; login: string | null }> {
  const payload = await encryptLinkPayload(data, code)
  const gist = await client.createGist({ description: LINK_GIST_DESCRIPTION, filename: LINK_GIST_FILE, content: payload, public: true })
  if (gist === null) throw new NoGistPermissionError()
  return gist
}

/**
 * Source device: delete link gists older than a code lives (left by an app closed while a code was
 * shown). Younger ones may be on show in another tab or device, and are left alone.
 */
export async function removeLinkGists(client: GitHubClient, now = Date.now()): Promise<void> {
  const gists = await client.listOwnGists()
  for (const g of gists) {
    const young = now - Date.parse(g.createdAt) < LINK_GIST_SECONDS * 1000
    if (g.files.includes(LINK_GIST_FILE) && g.description === LINK_GIST_DESCRIPTION && !young) await client.deleteGist(g.id)
  }
}

/**
 * New device: find the account's newest link gists (with an anonymous client) and decrypt them with
 * `code`. Throws LinkGistNotFoundError when there is none, WrongPairingCodeError when none opens.
 */
export async function fetchLinkGist(anonymous: GitHubClient, login: string, code: string): Promise<{ data: LinkData; gistId: string }> {
  const gists = (await anonymous.listUserGists(login))
    .filter((g) => g.files.includes(LINK_GIST_FILE) && isGistId(g.id))
    .slice(0, CANDIDATES)
  let found = false
  for (const g of gists) {
    const payload = await anonymous.getGistFile(g.id, LINK_GIST_FILE)
    if (payload === null) continue
    found = true
    try {
      return { data: await decryptLinkPayload(payload, code), gistId: g.id }
    } catch (e) {
      if (e instanceof WrongPairingCodeError || e instanceof InvalidPayloadError) continue
      throw e
    }
  }
  if (!found) throw new LinkGistNotFoundError()
  throw new WrongPairingCodeError()
}
