import { beforeEach, describe, expect, it } from 'vitest'
import { FakeGitHub } from '../../../test/fake-github'
import { GitHubClient, GitHubError, parseDeviceTrailer } from './client'
import { gitBlobSha } from './encoding'

const TOKEN = 'github_pat_SECRET_token_value'

let gh: FakeGitHub
let client: GitHubClient

function makeClient(token = TOKEN, fetchImpl: typeof fetch = gh.fetch): GitHubClient {
  return new GitHubClient({ token, fetch: fetchImpl })
}

beforeEach(async () => {
  gh = new FakeGitHub()
  gh.addUser('me', { name: '小明' })
  gh.addToken(TOKEN, { login: 'me', repos: ['me/notes', 'me/empty'] })
  gh.addToken('github_pat_read', { login: 'me', repos: ['me/notes'], permission: 'read' })
  await gh.createRepo('me/notes', {
    files: {
      'README.md': '# 筆記\n',
      '工作.md': '工作\n',
      '工作/會議記錄.md': '會議\n',
      '.notes/settings.json': '{}\n',
      '_assets/2026/10/a.png': new Uint8Array([137, 80, 78, 71, 0, 1, 2]),
      'docs/readme.txt': 'not a page\n',
    },
  })
  await gh.createRepo('me/empty', { empty: true })
  client = makeClient()
})

async function catchError(p: Promise<unknown>): Promise<GitHubError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(GitHubError)
    return e as GitHubError
  }
  throw new Error('expected a GitHubError')
}

describe('GitHubClient: requests', () => {
  it('sends the token only in the Authorization header, with the API version and no-store', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = []
    const spy: typeof fetch = (input, init) => {
      seen.push({ url: String(input), init })
      return gh.fetch(input, init)
    }
    await makeClient(TOKEN, spy).getUser()
    expect(seen[0].url).toBe('https://api.github.com/user')
    expect(seen[0].url).not.toContain(TOKEN)
    const h = new Headers(seen[0].init?.headers)
    expect(h.get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(h.get('x-github-api-version')).toBe('2022-11-28')
    expect(seen[0].init?.cache).toBe('no-store')
  })

  it('maps errors to GitHubError kinds without leaking the token', async () => {
    const bad = await catchError(makeClient('github_pat_wrong').getUser())
    expect(bad.kind).toBe('unauthorized')
    expect(bad.status).toBe(401)
    expect(bad.message).not.toContain('github_pat_wrong')

    expect((await catchError(client.getRepo('me', 'missing'))).kind).toBe('not-found')

    gh.failNext({ kind: 'server', status: 502 })
    expect((await catchError(client.getUser())).kind).toBe('server')

    gh.failNext({ kind: 'network' })
    const net = await catchError(client.getUser())
    expect(net.kind).toBe('network')
    expect(net.status).toBe(0)

    gh.failNext({ kind: 'secondary', retryAfter: 42 })
    const sec = await catchError(client.getUser())
    expect([sec.kind, sec.retryAfter]).toEqual(['rate-limited', 42])

    gh.failNext({ kind: 'secondary', status: 429 })
    const sec2 = await catchError(client.getUser())
    expect([sec2.kind, sec2.retryAfter]).toEqual(['rate-limited', null])

    gh.failNext({ kind: 'secondary', status: 403 })
    expect((await catchError(client.getUser())).kind).toBe('rate-limited')

    gh.failNext({ kind: 'primary', resetInSeconds: 120 })
    const prim = await catchError(client.getUser())
    expect(prim.kind).toBe('rate-limited')
    expect(prim.retryAfter).toBeGreaterThan(100)
    expect(prim.retryAfter).toBeLessThanOrEqual(121)

    const ro = makeClient('github_pat_read')
    const forbidden = await catchError(ro.createBlob('me', 'notes', new Uint8Array([1])))
    expect([forbidden.kind, forbidden.status]).toEqual(['forbidden', 403])
  })

  it('tracks x-ratelimit-remaining and reset (SYNC-13)', async () => {
    gh.setRateLimit(TOKEN, { remaining: 150, resetAt: Date.UTC(2030, 0, 1) })
    await client.getUser()
    expect(client.rateLimit).toEqual({ remaining: 149, resetAt: Date.UTC(2030, 0, 1) })
  })

  it('runs requests one at a time', async () => {
    let inflight = 0
    let max = 0
    const slow: typeof fetch = async (input, init) => {
      inflight++
      max = Math.max(max, inflight)
      await new Promise((r) => setTimeout(r, 2))
      try {
        return await gh.fetch(input, init)
      } finally {
        inflight--
      }
    }
    const c = makeClient(TOKEN, slow)
    await Promise.all([c.getUser(), c.getRepo('me', 'notes'), c.listRepos(), c.getRef('me', 'notes', 'main')])
    expect(max).toBe(1)
  })
})

describe('GitHubClient: setup', () => {
  it('reads the user and every repo page', async () => {
    expect(await client.getUser()).toMatchObject({ login: 'me', name: '小明' })
    gh.addToken('ghp_classic', { login: 'me' })
    for (let i = 0; i < 120; i++) await gh.createRepo(`me/r${i}`, { empty: true })
    const repos = await makeClient('ghp_classic').listRepos()
    expect(repos).toHaveLength(122)
    expect(gh.count('GET', '/user/repos')).toBe(2)
    const notes = repos.find((r) => r.fullName === 'me/notes')!
    expect(notes).toMatchObject({ owner: 'me', name: 'notes', private: true, defaultBranch: 'main' })
  })

  it('probes write access (SETUP-8)', async () => {
    expect(await client.probeWrite('me', 'notes')).toBe('ok')
    expect(await client.probeWrite('me', 'empty')).toBe('empty')
    expect(await makeClient('github_pat_read').probeWrite('me', 'notes')).toBe('no-access')
    expect(await makeClient('github_pat_read').probeWrite('me', 'empty')).toBe('no-access')
    gh.failNext({ kind: 'secondary' })
    expect((await catchError(client.probeWrite('me', 'notes'))).kind).toBe('rate-limited')
  })

  it('initialises an empty repo with one commit (SETUP-9)', async () => {
    await client.createFile('me', 'empty', '歡迎使用.md', '# 歡迎\n', '建立「歡迎使用」')
    expect(await gh.readFile('me/empty', '歡迎使用.md')).toBe('# 歡迎\n')
    expect(gh.commits('me/empty')).toHaveLength(1)
  })

  it('counts pages (DATA-2)', async () => {
    expect(await client.countPages('me', 'notes', 'main')).toBe(3)
    expect(await client.countPages('me', 'empty', 'main')).toBe(0)
    gh.truncateTrees = true
    expect(await client.countPages('me', 'notes', 'main')).toBeNull()
  })
})

describe('GitHubClient: history', () => {
  it('lists commits for a path with the Device trailer', async () => {
    await gh.commit('me/notes', { files: { '工作.md': '工作 2\n' }, message: '更新「工作」', device: 'iPhone · Safari' })
    await gh.commit('me/notes', { files: { '工作.md': '工作 3\n' }, message: 'Update 工作.md' })
    const list = await client.listCommits('me', 'notes', '工作.md', 1)
    expect(list.map((c) => c.device)).toEqual([null, 'iPhone · Safari', null])
    expect(list[1]).toMatchObject({ message: '更新「工作」\n\nDevice: iPhone · Safari\nApp: GitHub Notes test', authorLogin: 'me' })
    expect(await client.listCommits('me', 'notes', '工作.md', 2)).toEqual([])
    expect(await client.listCommits('me', 'empty', 'x.md', 1)).toEqual([])
    expect(await client.getFileAt('me', 'notes', '工作.md', list[1].sha)).toBe('工作 2\n')
    const blob = await client.getFileBlob('me', 'notes', '_assets/2026/10/a.png', 'main')
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71, 0, 1, 2]))
  })

  it('parses the Device trailer', () => {
    expect(parseDeviceTrailer('x\n\nDevice: Mac · Safari\nApp: GitHub Notes 0.1.0')).toBe('Mac · Safari')
    expect(parseDeviceTrailer('no trailer')).toBeNull()
  })
})

describe('GitHubClient: git data', () => {
  it('returns 304 for an unchanged ref', async () => {
    const ref = await client.getRef('me', 'notes', 'main')
    if (ref.notModified) throw new Error('expected a ref')
    expect(ref.sha).toBe(gh.headSha('me/notes'))
    expect(ref.etag).toBeTruthy()
    expect(await client.getRef('me', 'notes', 'main', ref.etag)).toEqual({ notModified: true })
    expect((await catchError(client.getRef('me', 'empty', 'main'))).status).toBe(409)
  })

  it('reads commits, trees and UTF-8 blobs', async () => {
    const head = gh.headSha('me/notes')!
    const commit = await client.getCommit('me', 'notes', head)
    expect(commit.message).toBe('Initial commit')
    const tree = await client.getTree('me', 'notes', commit.treeSha)
    expect(tree.truncated).toBe(false)
    const page = tree.entries.find((e) => e.path === '工作/會議記錄.md')!
    expect(page).toMatchObject({ type: 'blob', mode: '100644' })
    expect(await client.getBlobText('me', 'notes', page.sha)).toBe('會議\n')
    expect(page.sha).toBe(await gitBlobSha('會議\n'))
  })

  it('downloads up to 20 blobs with REST, two at a time', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 20; i++) files[`p${i}.md`] = `第 ${i} 頁\n`
    await gh.commit('me/notes', { files })
    const shas = Object.keys(files).map((p) => gh.blobSha('me/notes', p)!)
    let inflight = 0
    let max = 0
    const slow: typeof fetch = async (input, init) => {
      inflight++
      max = Math.max(max, inflight)
      await new Promise((r) => setTimeout(r, 2))
      try {
        return await gh.fetch(input, init)
      } finally {
        inflight--
      }
    }
    const progress: number[] = []
    const texts = await makeClient(TOKEN, slow).getBlobTexts('me', 'notes', shas, (done) => progress.push(done))
    expect(texts.size).toBe(20)
    expect(texts.get(shas[7])).toBe('第 7 頁\n')
    expect(max).toBe(2)
    expect(gh.count('POST', '/graphql')).toBe(0)
    expect(progress.at(-1)).toBe(20)
  })

  it('downloads more than 20 blobs with GraphQL, 100 per query', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 230; i++) files[`p${i}.md`] = `第 ${i} 頁\n`
    files['big.md'] = 'x'.repeat(2000)
    await gh.commit('me/notes', { files })
    gh.graphqlTextLimit = 1000
    const shas = Object.keys(files).map((p) => gh.blobSha('me/notes', p)!)
    const texts = await client.getBlobTexts('me', 'notes', shas)
    expect(texts.size).toBe(231)
    expect(texts.get(gh.blobSha('me/notes', 'p229.md')!)).toBe('第 229 頁\n')
    expect(texts.get(gh.blobSha('me/notes', 'big.md')!)).toBe('x'.repeat(2000))
    expect(gh.count('POST', '/graphql')).toBe(3)
    // Only the truncated blob fell back to REST.
    expect(gh.count('GET', /\/git\/blobs\//)).toBe(1)
  })

  it('falls back to REST when GraphQL is refused', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 25; i++) files[`p${i}.md`] = `${i}\n`
    await gh.commit('me/notes', { files })
    gh.failNext({ kind: 'status', status: 403, message: 'Resource not accessible by personal access token' }, { match: (r) => r.path === '/graphql' })
    const shas = Object.keys(files).map((p) => gh.blobSha('me/notes', p)!)
    const texts = await client.getBlobTexts('me', 'notes', shas)
    expect(texts.size).toBe(25)
    expect(gh.count('GET', /\/git\/blobs\//)).toBe(25)
  })

  it('writes blobs, trees and commits and refuses a non-fast-forward ref update', async () => {
    const head = gh.headSha('me/notes')!
    const { treeSha } = await client.getCommit('me', 'notes', head)
    const img = await client.createBlob('me', 'notes', new Blob([new Uint8Array([1, 2, 3])]))
    expect(img).toBe(await gitBlobSha(new Uint8Array([1, 2, 3])))
    const tree = await client.createTree('me', 'notes', treeSha, [
      { path: '新頁面.md', mode: '100644', type: 'blob', content: '新\n' },
      { path: '_assets/2026/10/b.png', mode: '100644', type: 'blob', sha: img },
      { path: 'README.md', mode: '100644', type: 'blob', sha: null },
    ])
    const commit = await client.createCommit('me', 'notes', { message: '新增「新頁面」', tree: tree.sha, parents: [head] })
    expect(commit.parents).toEqual([head])
    await client.updateRef('me', 'notes', 'main', commit.sha)
    expect(gh.headSha('me/notes')).toBe(commit.sha)
    expect(gh.blobSha('me/notes', '新頁面.md')).toBe(await gitBlobSha('新\n'))
    expect(await gh.readFile('me/notes', 'README.md')).toBeNull()

    const stale = await client.createCommit('me', 'notes', { message: 'stale', tree: treeSha, parents: [head] })
    const err = await catchError(client.updateRef('me', 'notes', 'main', stale.sha))
    expect(err.status).toBe(422)

    const missing = await catchError(client.createTree('me', 'notes', tree.sha, [{ path: 'gone.md', mode: '100644', type: 'blob', sha: null }]))
    expect(missing.status).toBe(422)
  })
})
