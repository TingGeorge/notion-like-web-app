import { beforeEach, describe, expect, it } from 'vitest'
import { FakeGitHub } from '../../../test/fake-github'
import { GitHubClient } from '../../lib/github/client'
import { LINK_GIST_SECONDS, publishLinkGist } from '../../lib/link/gist'
import { db, NotesDB, setDb } from '../../lib/store/db'
import { deleteLeftoverLinkGist, forgetLinkGist, rememberLinkGist } from './linkGist'

const TOKEN = 'github_pat_11SOURCE_token_value_0123456789'
let gh: FakeGitHub
let client: GitHubClient
let n = 0

beforeEach(() => {
  setDb(new NotesDB(`link-gist-test-${n++}`))
  gh = new FakeGitHub()
  gh.addToken(TOKEN, { login: 'me', gists: true })
  client = new GitHubClient({ token: TOKEN, fetch: gh.fetch })
})

describe('a link gist left behind (LINK-5)', () => {
  it('is deleted at the next start once a code would have expired; until then, says when to try again', async () => {
    const { id } = await publishLinkGist(client, { o: 'me', r: 'diary', b: 'main', t: TOKEN, e: null }, 'K7QM2XPA9H')
    await rememberLinkGist(id)
    const createdAt = ((await db().config.get('linkGist'))?.value as { createdAt: number }).createdAt
    // A code still being shown (in another tab) is left alone, and looked at again after it expires.
    const wait = await deleteLeftoverLinkGist(client, createdAt + 1000)
    expect(wait).toBe(LINK_GIST_SECONDS * 1000 - 1000 + 1000)
    expect(gh.gistsOf('me')).toHaveLength(1)
    expect(await deleteLeftoverLinkGist(client, createdAt + LINK_GIST_SECONDS * 1000)).toBeNull()
    expect(gh.gistsOf('me')).toHaveLength(0)
    expect(await db().config.get('linkGist')).toBeUndefined()
  }, 30_000)

  it('is kept in mind when GitHub cannot be reached', async () => {
    await rememberLinkGist('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1')
    gh.offline = true
    expect(await deleteLeftoverLinkGist(client, Date.now() + LINK_GIST_SECONDS * 1000)).toBeNull()
    expect(await db().config.get('linkGist')).toBeDefined()
  })

  it('is forgotten once deleted, unless another gist was remembered since', async () => {
    await rememberLinkGist('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1')
    await rememberLinkGist('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2')
    await forgetLinkGist('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1')
    expect((await db().config.get('linkGist'))?.value).toMatchObject({ id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2' })
    await forgetLinkGist('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2')
    expect(await db().config.get('linkGist')).toBeUndefined()
  })
})
