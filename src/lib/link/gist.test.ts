import { beforeEach, describe, expect, it } from 'vitest'
import { FakeGitHub } from '../../../test/fake-github'
import { GitHubClient } from '../github/client'
import { generatePairingCode, LONG_CODE_LENGTH, WrongPairingCodeError, type LinkData } from './crypto'
import {
  fetchLinkGist,
  LINK_GIST_DESCRIPTION,
  LINK_GIST_SECONDS,
  LINK_GIST_FILE,
  LinkGistNotFoundError,
  NoGistPermissionError,
  normalizeLogin,
  publishLinkGist,
  removeLinkGists,
} from './gist'

const TOKEN = 'github_pat_11SOURCE_token_value_0123456789'
const NO_GISTS = 'github_pat_11NOGISTS_token_value_0123456789'
const CLASSIC = 'ghp_classicTokenWithoutGistScope0123456789'
const data: LinkData = { o: 'me', r: 'diary', b: 'main', t: TOKEN, e: null }

let gh: FakeGitHub
const client = (token: string) => new GitHubClient({ token, fetch: gh.fetch })

beforeEach(() => {
  gh = new FakeGitHub()
  gh.addUser('me')
  gh.addToken(TOKEN, { login: 'me', gists: true })
  gh.addToken(NO_GISTS, { login: 'me' })
  gh.addToken(CLASSIC, { login: 'me' })
})

describe('linking by typing a code (LINK-5)', () => {
  it('uses a 10-character code', () => {
    expect(generatePairingCode(LONG_CODE_LENGTH)).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/)
  })

  it('publishes the encrypted payload in a public gist that the new device reads without a token', async () => {
    const code = generatePairingCode(LONG_CODE_LENGTH)
    const { id, login } = await publishLinkGist(client(TOKEN), data, code)
    // The login to type is the one GitHub filed the gist under.
    expect(login).toBe('me')
    const [gist] = gh.gistsOf('me')
    expect(gist.id).toBe(id)
    expect(gist.public).toBe(true)
    expect(gist.description).toBe(LINK_GIST_DESCRIPTION)
    const content = gist.files.get(LINK_GIST_FILE)!
    expect(content).toMatch(/^ghnotes:1:/)
    // Encrypted: neither the token nor the repo is readable.
    expect(content).not.toContain(TOKEN)
    expect(content).not.toContain('diary')

    const anonymous = client('')
    const found = await fetchLinkGist(anonymous, 'me', code.toLowerCase())
    expect(found).toEqual({ data, gistId: id })
    // GitHub logins are case-insensitive.
    expect((await fetchLinkGist(anonymous, 'ME', code)).gistId).toBe(id)
    // The anonymous requests carry no Authorization header.
    expect(gh.requests.filter((r) => r.path.startsWith('/users/me/gists') || r.path === `/gists/${id}`).length).toBeGreaterThan(0)
  }, 30_000)

  it('sends no Authorization header without a token', async () => {
    const seen: (string | null)[] = []
    gh.onRequest((r) => void seen.push(r.headers.get('authorization')))
    await client('').listUserGists('me')
    expect(seen).toEqual([null])
  })

  it('a wrong code is WrongPairingCodeError; no link gist is LinkGistNotFoundError', async () => {
    const anonymous = client('')
    await expect(fetchLinkGist(anonymous, 'me', 'ABCDEFGHJK')).rejects.toBeInstanceOf(LinkGistNotFoundError)
    await publishLinkGist(client(TOKEN), data, 'K7QM2XPA9H')
    await expect(fetchLinkGist(anonymous, 'me', 'ABCDEFGHJK')).rejects.toBeInstanceOf(WrongPairingCodeError)
  }, 30_000)

  it('ignores other gists and finds the right one among recent link gists', async () => {
    const source = client(TOKEN)
    await source.createGist({ description: 'my snippet', filename: 'a.js', content: 'x', public: true })
    const { id: first } = await publishLinkGist(source, data, 'K7QM2XPA9H')
    await publishLinkGist(source, { ...data, r: 'other' }, 'ABCDE23456')
    expect((await fetchLinkGist(client(''), 'me', 'K7QM2XPA9H')).gistId).toBe(first)
  }, 60_000)

  it('a token without the Gists permission cannot publish', async () => {
    await expect(publishLinkGist(client(NO_GISTS), data, 'K7QM2XPA9H')).rejects.toBeInstanceOf(NoGistPermissionError)
    await expect(publishLinkGist(client(CLASSIC), data, 'K7QM2XPA9H')).rejects.toBeInstanceOf(NoGistPermissionError)
    expect(gh.gistsOf('me')).toEqual([])
  }, 30_000)

  it('removes link gists older than a code lives, keeping younger ones and other gists', async () => {
    const source = client(TOKEN)
    await source.createGist({ description: 'my snippet', filename: 'a.js', content: 'x', public: true })
    const { id } = await publishLinkGist(source, data, 'K7QM2XPA9H')
    const second = await publishLinkGist(source, data, 'ABCDE23456')
    // Codes still on show (in another tab or device) are left alone; age is by GitHub's clock.
    await removeLinkGists(source, Date.parse(second.createdAt))
    expect(gh.gistsOf('me')).toHaveLength(3)
    // `keep` is spared even when old.
    await removeLinkGists(source, Date.parse(second.createdAt) + LINK_GIST_SECONDS * 1000, second.id)
    expect(gh.gistsOf('me').map((g) => g.id)).toEqual([second.id, expect.any(String)])
    await removeLinkGists(source, Date.parse(second.createdAt) + LINK_GIST_SECONDS * 1000)
    expect(gh.gistsOf('me').map((g) => g.description)).toEqual(['my snippet'])
    // Deleting a gist that is already gone is fine.
    await source.deleteGist(id)
  }, 30_000)

  it('normalises the GitHub account', () => {
    expect(normalizeLogin(' TingGeorge ')).toBe('TingGeorge')
    expect(normalizeLogin('@me')).toBe('me')
    expect(normalizeLogin('a-b-c')).toBe('a-b-c')
    for (const bad of ['', '-me', 'me-', 'a b', 'me/notes', 'x'.repeat(40)]) expect(normalizeLogin(bad)).toBeNull()
  })
})
