import { beforeEach, describe, expect, it } from 'vitest'
import { FakeGitHub, FakeNetworkError, base64ToBytes, hashObject, utf8 } from './index'

const API = 'https://api.github.com'
const TOKEN = 'github_pat_write'
const READ_TOKEN = 'github_pat_read'
const CLASSIC = 'ghp_classic'

function headers(token = TOKEN, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...extra,
  }
}

describe('fake GitHub: git objects', () => {
  it('uses real git SHA-1 ids', async () => {
    // `git hash-object` of "hello\n", the empty blob and the empty tree.
    expect(await hashObject('blob', utf8('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
    expect(await hashObject('blob', utf8(''))).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
    expect(await hashObject('tree', new Uint8Array(0))).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904')
  })
})

describe('fake GitHub: HTTP', () => {
  let gh: FakeGitHub

  beforeEach(async () => {
    gh = new FakeGitHub()
    gh.addUser('me', { name: 'Me Myself' })
    gh.addToken(TOKEN, { login: 'me', repos: ['me/notes', 'me/empty'], expiresOn: '2099-01-31' })
    gh.addToken(READ_TOKEN, { login: 'me', repos: ['me/notes'], permission: 'read' })
    gh.addToken(CLASSIC, { login: 'me', permission: 'read' })
    await gh.createRepo('me/notes', { files: { 'README.md': '# Notes\n', '工作/會議記錄.md': '會議\n' } })
    await gh.createRepo('me/empty', { empty: true })
  })

  const get = (path: string, token = TOKEN, extra: Record<string, string> = {}) => gh.fetch(`${API}${path}`, { headers: headers(token, extra) })
  const send = (method: string, path: string, body: unknown, token = TOKEN) =>
    gh.fetch(`${API}${path}`, {
      method,
      headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('answers the CORS preflight with what GitHub allows', async () => {
    const res = await gh.handle(new Request(`${API}/user`, { method: 'OPTIONS' }))
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-headers')).toContain('If-None-Match')
    expect(res.headers.get('access-control-allow-headers')).toContain('X-GitHub-Api-Version')
    expect(res.headers.get('access-control-allow-methods')).toContain('PATCH')
  })

  it('hides headers GitHub does not expose to browsers', async () => {
    const raw = await gh.handle(new Request(`${API}/user`, { headers: headers() }))
    expect(raw.headers.get('github-authentication-token-expiration')).toBe('2099-01-31 23:59:59 UTC')
    const browser = await get('/user')
    expect(browser.status).toBe(200)
    expect(browser.headers.get('github-authentication-token-expiration')).toBeNull()
    expect(browser.headers.get('x-ratelimit-remaining')).not.toBeNull()
    expect(browser.headers.get('etag')).toMatch(/^W\/"/)
    expect(await browser.json()).toMatchObject({ login: 'me', name: 'Me Myself' })
  })

  it('fails a request whose headers would not pass the preflight', async () => {
    await expect(get('/user', TOKEN, { 'Cache-Control': 'no-cache' })).rejects.toThrow(TypeError)
  })

  it('401 for a bad or revoked token', async () => {
    expect((await get('/user', 'github_pat_nope')).status).toBe(401)
    gh.revokeToken(TOKEN)
    const res = await get('/user')
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ message: 'Bad credentials' })
  })

  it('lists repos with Link pagination', async () => {
    for (let i = 0; i < 3; i++) await gh.createRepo(`me/extra${i}`)
    const p1 = await get('/user/repos?per_page=2&sort=updated', CLASSIC)
    expect(p1.status).toBe(200)
    expect(await p1.json()).toHaveLength(2)
    expect(p1.headers.get('link')).toMatch(/page=2>; rel="next"/)
    const p3 = await get('/user/repos?per_page=2&sort=updated&page=3', CLASSIC)
    expect(await p3.json()).toHaveLength(1)
    expect(p3.headers.get('link')).not.toMatch(/rel="next"/)
    // A fine-grained token only sees its selected repos.
    const fine = (await (await get('/user/repos?per_page=100')).json()) as Array<{ full_name: string }>
    expect(fine.map((r) => r.full_name).sort()).toEqual(['me/empty', 'me/notes'])
  })

  it('409 for git endpoints on an empty repo; PUT contents creates the first commit', async () => {
    expect((await get('/repos/me/empty/git/ref/heads/main')).status).toBe(409)
    const probe = await send('POST', '/repos/me/empty/git/blobs', { content: 'x', encoding: 'utf-8' })
    expect(probe.status).toBe(409)
    expect(await probe.json()).toMatchObject({ message: 'Git Repository is empty.' })
    expect((await get('/repos/me/empty/contents/README.md')).status).toBe(404)
    const put = await send('PUT', `/repos/me/empty/contents/${encodeURIComponent('歡迎使用.md')}`, {
      message: '建立「歡迎使用」',
      content: btoa('hi\n'),
    })
    expect(put.status).toBe(201)
    expect(await gh.readFile('me/empty', '歡迎使用.md')).toBe('hi\n')
    expect((await get('/repos/me/empty/git/ref/heads/main')).status).toBe(200)
  })

  it('403 for writes with a read-only fine-grained token, 404 with a classic one', async () => {
    expect((await send('POST', '/repos/me/notes/git/blobs', { content: 'x' }, READ_TOKEN)).status).toBe(403)
    expect((await send('POST', '/repos/me/notes/git/blobs', { content: 'x' }, CLASSIC)).status).toBe(404)
    expect((await get('/repos/me/notes', READ_TOKEN)).status).toBe(200)
    expect((await get('/repos/me/other', READ_TOKEN)).status).toBe(404)
  })

  it('ETag + If-None-Match gives 304 that does not count against the rate limit', async () => {
    const first = await get('/repos/me/notes/git/ref/heads/main')
    const etag = first.headers.get('etag')!
    const remaining = Number(first.headers.get('x-ratelimit-remaining'))
    const second = await get('/repos/me/notes/git/ref/heads/main', TOKEN, { 'If-None-Match': etag })
    expect(second.status).toBe(304)
    expect(Number(second.headers.get('x-ratelimit-remaining'))).toBe(remaining)
    await gh.commit('me/notes', { files: { 'a.md': 'a\n' } })
    const third = await get('/repos/me/notes/git/ref/heads/main', TOKEN, { 'If-None-Match': etag })
    expect(third.status).toBe(200)
    expect(Number(third.headers.get('x-ratelimit-remaining'))).toBe(remaining - 1)
  })

  it('serves recursive trees, blobs (base64 in 60-char lines) and commits', async () => {
    const head = gh.headSha('me/notes')!
    const commit = (await (await get(`/repos/me/notes/git/commits/${head}`)).json()) as { tree: { sha: string }; message: string }
    expect(commit.message).toBe('Initial commit')
    const tree = (await (await get(`/repos/me/notes/git/trees/${commit.tree.sha}?recursive=1`)).json()) as {
      truncated: boolean
      tree: Array<{ path: string; type: string; sha: string; mode: string }>
    }
    expect(tree.truncated).toBe(false)
    expect(tree.tree.map((e) => `${e.type}:${e.path}`).sort()).toEqual(['blob:README.md', 'blob:工作/會議記錄.md', 'tree:工作'])
    const long = 'x'.repeat(200)
    await gh.commit('me/notes', { files: { 'long.md': long } })
    const sha = gh.blobSha('me/notes', 'long.md')!
    const blob = (await (await get(`/repos/me/notes/git/blobs/${sha}`)).json()) as { content: string; encoding: string; size: number }
    expect(blob.encoding).toBe('base64')
    expect(blob.content.split('\n')[0]).toHaveLength(60)
    expect(new TextDecoder().decode(base64ToBytes(blob.content))).toBe(long)
    gh.truncateTrees = true
    const truncated = (await (await get(`/repos/me/notes/git/trees/main?recursive=1`)).json()) as { truncated: boolean }
    expect(truncated.truncated).toBe(true)
  })

  it('creates trees, commits and moves refs fast-forward only', async () => {
    const head = gh.headSha('me/notes')!
    const base = gh.commits('me/notes')[0].tree
    const tree = (await (
      await send('POST', '/repos/me/notes/git/trees', {
        base_tree: base,
        tree: [
          { path: '新頁面.md', mode: '100644', type: 'blob', content: '新\n' },
          { path: '工作/會議記錄.md', mode: '100644', type: 'blob', sha: null },
        ],
      })
    ).json()) as { sha: string }
    const commit = (await (await send('POST', '/repos/me/notes/git/commits', { message: 'm', tree: tree.sha, parents: [head] })).json()) as { sha: string }
    expect((await send('PATCH', '/repos/me/notes/git/refs/heads/main', { sha: commit.sha, force: false })).status).toBe(200)
    expect(gh.listFiles('me/notes')).toEqual(['README.md', '新頁面.md'])
    // The emptied folder is gone.
    expect(gh.commits('me/notes')).toHaveLength(2)

    // A commit on the old head is not a fast-forward any more.
    const stale = (await (await send('POST', '/repos/me/notes/git/commits', { message: 'stale', tree: base, parents: [head] })).json()) as { sha: string }
    const rejected = await send('PATCH', '/repos/me/notes/git/refs/heads/main', { sha: stale.sha, force: false })
    expect(rejected.status).toBe(422)
    expect(await rejected.json()).toMatchObject({ message: 'Update is not a fast forward' })
    expect(gh.headSha('me/notes')).toBe(commit.sha)
  })

  it('fails to delete a path that does not exist', async () => {
    const base = gh.commits('me/notes')[0].tree
    const res = await send('POST', '/repos/me/notes/git/trees', {
      base_tree: base,
      tree: [{ path: 'nope.md', mode: '100644', type: 'blob', sha: null }],
    })
    expect(res.status).toBe(422)
  })

  it('lists commits for a path with the Device trailer, paged', async () => {
    await gh.commit('me/notes', { files: { 'a.md': '1\n' }, message: '新增「a」', device: 'iPhone · Safari' })
    await gh.commit('me/notes', { files: { 'b.md': '1\n' }, message: 'b' })
    await gh.commit('me/notes', { files: { 'a.md': '2\n' }, message: '更新「a」', device: 'Mac · Chrome' })
    const list = (await (await get(`/repos/me/notes/commits?path=a.md&per_page=1`)).json()) as Array<{ commit: { message: string }; author: { login: string } }>
    expect(list).toHaveLength(1)
    expect(list[0].commit.message).toContain('Device: Mac · Chrome')
    expect(list[0].author.login).toBe('me')
    const all = await get(`/repos/me/notes/commits?path=a.md&per_page=30`)
    expect(await all.json()).toHaveLength(2)
  })

  it('serves raw contents and JSON contents', async () => {
    const raw = await get(`/repos/me/notes/contents/${encodeURIComponent('工作')}/${encodeURIComponent('會議記錄.md')}?ref=main`, TOKEN, {
      Accept: 'application/vnd.github.raw',
    })
    expect(raw.status).toBe(200)
    expect(await raw.text()).toBe('會議\n')
    const json = (await (await get('/repos/me/notes/contents/README.md')).json()) as { content: string; encoding: string }
    expect(json.encoding).toBe('base64')
  })

  it('answers GraphQL blob batches', async () => {
    const a = gh.blobSha('me/notes', 'README.md')!
    const res = await send('POST', '/graphql', {
      query: `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) {
        b0: object(oid: "${a}") { ... on Blob { text byteSize isBinary } }
        b1: object(oid: "${'0'.repeat(40)}") { ... on Blob { text } }
      } }`,
      variables: { owner: 'me', name: 'notes' },
    })
    expect(res.headers.get('x-ratelimit-resource')).toBe('graphql')
    expect(await res.json()).toEqual({ data: { repository: { b0: { text: '# Notes\n', byteSize: 8, isBinary: false }, b1: null } } })
    const missing = await send('POST', '/graphql', {
      query: 'query { repository(owner: "me", name: "secret") { b0: object(oid: "x") { ... on Blob { text } } } }',
    })
    expect(await missing.json()).toMatchObject({ data: { repository: null }, errors: [{ type: 'NOT_FOUND' }] })
  })

  it('injects failures: 5xx, network, secondary and primary rate limits', async () => {
    gh.failNext({ kind: 'server', status: 503 })
    expect((await get('/user')).status).toBe(503)
    gh.failNext({ kind: 'network' })
    await expect(get('/user')).rejects.toBeInstanceOf(TypeError)
    await expect(gh.handle(new Request(`${API}/user`))).resolves.toBeInstanceOf(Response)
    gh.failNext({ kind: 'network' })
    await expect(gh.handle(new Request(`${API}/user`, { headers: headers() }))).rejects.toBeInstanceOf(FakeNetworkError)
    gh.failNext({ kind: 'secondary', status: 429, retryAfter: 7 })
    const sec = await get('/user')
    expect(sec.status).toBe(429)
    expect(sec.headers.get('retry-after')).toBe('7')
    gh.failNext({ kind: 'secondary' })
    const sec2 = await get('/user')
    expect(sec2.status).toBe(403)
    expect(sec2.headers.get('retry-after')).toBeNull()
    expect(((await sec2.json()) as { message: string }).message).toMatch(/secondary rate limit/)
    gh.failNext({ kind: 'primary', resetInSeconds: 30 })
    const prim = await get('/user')
    expect(prim.status).toBe(403)
    expect(prim.headers.get('x-ratelimit-remaining')).toBe('0')
    // Only requests that match are affected.
    gh.failNext({ kind: 'server' }, { match: (r) => r.method === 'PATCH' })
    expect((await get('/user')).status).toBe(200)
  })

  it('enforces the primary rate limit', async () => {
    gh.setRateLimit(TOKEN, { remaining: 1 })
    expect((await get('/user')).status).toBe(200)
    const res = await get('/user')
    expect(res.status).toBe(403)
    expect(res.headers.get('x-ratelimit-remaining')).toBe('0')
  })

  it('test helpers commit, read and list like another device', async () => {
    const sha = await gh.commit('me/notes', { files: { 'README.md': null, 'x/y.md': 'y\n' }, message: '刪除', device: 'Windows 電腦 · Edge' })
    expect(gh.headSha('me/notes')).toBe(sha)
    expect(gh.listFiles('me/notes')).toEqual(['x/y.md', '工作/會議記錄.md'])
    expect(await gh.readFile('me/notes', 'x/y.md')).toBe('y\n')
    expect(await gh.readFile('me/notes', 'README.md')).toBeNull()
    expect(await gh.readFile('me/notes', 'README.md', gh.commits('me/notes')[1].sha)).toBe('# Notes\n')
    expect(gh.commits('me/notes')[0].message).toBe('刪除\n\nDevice: Windows 電腦 · Edge\nApp: GitHub Notes test')
    expect(gh.count('GET', '/user')).toBe(0)
  })
})
