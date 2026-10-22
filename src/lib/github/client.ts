/**
 * GitHub REST + GraphQL client (ARCH-3, SYNC-5, SYNC-8, SYNC-13, SETUP-6 to SETUP-9).
 *
 * CONTRACT — the setup screens and the sync engine use this class. All requests go to
 * `https://api.github.com` (or `baseUrl` in tests) with the token only in the Authorization
 * header (SEC-2). Errors are thrown as `GitHubError`.
 *
 * - Requests run one at a time (SYNC-13); only `getBlobTexts` downloads two blobs in parallel.
 * - `cache: 'no-store'` plus a manual `If-None-Match`, so a `304` reaches the caller.
 * - `x-ratelimit-remaining` / `x-ratelimit-reset` are tracked in `rateLimit` (SYNC-13).
 */
import { isPagePath } from '../data/names'
import type { SyncErrorKind, TreeItem } from '../types'
import { base64ToBytes, bytesToBase64, utf8Decode, utf8Encode } from './encoding'

export const GITHUB_API = 'https://api.github.com'
export const GITHUB_API_VERSION = '2022-11-28'

/** SETUP-8: the unreferenced blob written by the write probe. */
export const WRITE_PROBE_CONTENT = 'github-notes write check'

/** SYNC-5 step 3: up to this many files are downloaded with REST, more with GraphQL. */
export const REST_DOWNLOAD_LIMIT = 20
/** SYNC-5 step 3: blobs per GraphQL query. */
export const GRAPHQL_BATCH = 100

export class GitHubError extends Error {
  constructor(
    public kind: SyncErrorKind,
    public status: number,
    message: string,
    /** Seconds to wait (from `retry-after`, or until `x-ratelimit-reset`). */
    public retryAfter: number | null = null,
  ) {
    super(message)
    this.name = 'GitHubError'
  }
}

export interface GitHubUser {
  login: string
  name: string | null
  avatarUrl: string | null
}

export interface RepoSummary {
  owner: string
  name: string
  fullName: string
  private: boolean
  defaultBranch: string
  /** KB, as reported by GitHub. 0 usually means empty. */
  size: number
  pushedAt: string | null
  description: string | null
}

export interface CommitSummary {
  sha: string
  message: string
  /** ISO 8601 committer date. */
  date: string
  authorLogin: string | null
  /** From the `Device:` trailer (SYNC-9), or null. */
  device: string | null
}

export type WriteProbe = 'ok' | 'empty' | 'no-access'

/** LINK-5: a gist as listed (no file contents). */
export interface GistSummary {
  id: string
  description: string | null
  /** ISO 8601. */
  createdAt: string
  /** File names. */
  files: string[]
}

interface RawGist {
  id: string
  description: string | null
  created_at: string
  owner?: { login: string } | null
  files: Record<string, { filename?: string; content?: string; truncated?: boolean } | null>
}

function toGistSummary(g: RawGist): GistSummary {
  return { id: g.id, description: g.description ?? null, createdAt: g.created_at, files: Object.keys(g.files ?? {}) }
}

export interface GitHubClientOptions {
  /** '' for anonymous requests (LINK-5 on the new device): no Authorization header is sent. */
  token: string
  /** Injected in tests to use the fake GitHub. */
  fetch?: typeof fetch
  baseUrl?: string
  /** For tests (rate-limit arithmetic). */
  now?: () => number
}

export interface RateLimitInfo {
  remaining: number | null
  /** ms since epoch. */
  resetAt: number | null
}

/** `getRef` result. `notModified` when GitHub answered `304` to `If-None-Match`. */
export type RefResult = { notModified: true } | { notModified: false; sha: string; etag: string | null }

export interface TreeEntryInfo extends TreeItem {
  path: string
}

export interface TreeResult {
  sha: string
  truncated: boolean
  entries: TreeEntryInfo[]
}

export interface GitCommit {
  sha: string
  treeSha: string
  message: string
  parents: string[]
  /** ISO 8601 committer date. */
  date: string
}

/** One entry of `POST /git/trees`: inline `content`, an existing blob `sha`, or `sha: null` to delete. */
export type NewTreeEntry =
  | { path: string; mode: string; type: 'blob'; content: string }
  | { path: string; mode: string; type: 'blob' | 'tree' | 'commit'; sha: string | null }

interface RequestOptions {
  body?: unknown
  accept?: string
  etag?: string | null
  /** Status codes that are returned instead of thrown. */
  allow?: number[]
  /** Sent even if the page is being unloaded (`fetch` keepalive), and not queued. */
  keepalive?: boolean
}

/** The `Device:` trailer of a commit message (SYNC-9), or null. The last one wins. */
export function parseDeviceTrailer(message: string): string | null {
  const matches = [...message.matchAll(/^Device:[ \t]*(.+?)[ \t]*$/gm)]
  return matches.length > 0 ? matches[matches.length - 1][1] : null
}

/** `a/b c.md` → `a/b%20c.md`: every segment encoded, slashes kept. */
function encodePath(path: string): string {
  return path
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/')
}

function repoPath(owner: string, repo: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
}

interface RawRepo {
  name: string
  full_name: string
  private: boolean
  default_branch: string
  size: number
  pushed_at: string | null
  description: string | null
  owner: { login: string }
}

function toRepoSummary(r: RawRepo): RepoSummary {
  return {
    owner: r.owner.login,
    name: r.name,
    fullName: r.full_name,
    private: r.private,
    defaultBranch: r.default_branch,
    size: r.size,
    pushedAt: r.pushed_at ?? null,
    description: r.description ?? null,
  }
}

export class GitHubClient {
  constructor(public readonly options: GitHubClientOptions) {}

  /** Last `x-ratelimit-*` values seen for the REST (`core`) resource (SYNC-13). */
  rateLimit: RateLimitInfo = { remaining: null, resetAt: null }

  private tail: Promise<unknown> = Promise.resolve()

  private get baseUrl(): string {
    return (this.options.baseUrl ?? GITHUB_API).replace(/\/$/, '')
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  /** SYNC-13: one request at a time. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn)
    this.tail = run.catch(() => undefined)
    return run
  }

  /** One HTTP request, not queued. Throws `GitHubError` (never with the token in it, SEC-2). */
  private async send(method: string, path: string, opts: RequestOptions = {}): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: opts.accept ?? 'application/vnd.github+json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    }
    if (this.options.token) headers.Authorization = `Bearer ${this.options.token}`
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
    if (opts.etag) headers['If-None-Match'] = opts.etag
    const doFetch = this.options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init))
    let res: Response
    try {
      res = await doFetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'follow',
        ...(opts.keepalive ? { keepalive: true } : {}),
      })
    } catch {
      throw new GitHubError('network', 0, 'Network error')
    }
    this.trackRateLimit(res)
    if (res.ok || res.status === 304 || opts.allow?.includes(res.status)) return res
    throw await this.toError(res)
  }

  private request(method: string, path: string, opts: RequestOptions = {}): Promise<Response> {
    return this.serial(() => this.send(method, path, opts))
  }

  private async json<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    return this.serial(async () => (await (await this.send(method, path, opts)).json()) as T)
  }

  private trackRateLimit(res: Response): void {
    const resource = res.headers.get('x-ratelimit-resource')
    if (resource && resource !== 'core') return
    const remaining = res.headers.get('x-ratelimit-remaining')
    const reset = res.headers.get('x-ratelimit-reset')
    if (remaining !== null && remaining !== '' && Number.isFinite(Number(remaining))) this.rateLimit.remaining = Number(remaining)
    if (reset !== null && reset !== '' && Number.isFinite(Number(reset))) this.rateLimit.resetAt = Number(reset) * 1000
  }

  private async toError(res: Response): Promise<GitHubError> {
    let message = res.statusText || `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { message?: unknown }
      if (typeof body.message === 'string') message = body.message
    } catch {
      // not JSON
    }
    const status = res.status
    const text = `GitHub ${status}: ${message}`
    if (status === 401) return new GitHubError('unauthorized', status, text)
    if (status === 403 || status === 429) {
      const retryAfter = Number(res.headers.get('retry-after'))
      if (res.headers.get('retry-after') !== null && Number.isFinite(retryAfter)) {
        return new GitHubError('rate-limited', status, text, Math.max(0, retryAfter))
      }
      if (res.headers.get('x-ratelimit-remaining') === '0') {
        const reset = Number(res.headers.get('x-ratelimit-reset'))
        const wait = Number.isFinite(reset) && reset > 0 ? Math.max(1, Math.ceil(reset - this.now() / 1000)) : null
        return new GitHubError('rate-limited', status, text, wait)
      }
      if (status === 429 || /rate limit|abuse/i.test(message)) return new GitHubError('rate-limited', status, text, null)
      return new GitHubError('forbidden', status, text)
    }
    if (status === 404) return new GitHubError('not-found', status, text)
    if (status >= 500) return new GitHubError('server', status, text)
    return new GitHubError('unknown', status, text)
  }

  // ---------------------------------------------------------------------------------------------
  // Setup (SETUP-6 to SETUP-9)

  /** SETUP-6 step 1. 401 → GitHubError kind `unauthorized`. */
  async getUser(): Promise<GitHubUser> {
    const u = await this.json<{ login: string; name?: string | null; avatar_url?: string | null }>('GET', '/user')
    return { login: u.login, name: u.name ?? null, avatarUrl: u.avatar_url ?? null }
  }

  /** SETUP-6 step 2: `GET /user/repos?per_page=100&sort=updated`, all pages. */
  async listRepos(): Promise<RepoSummary[]> {
    const out: RepoSummary[] = []
    for (let page = 1; page <= 100; page++) {
      const res = await this.request('GET', `/user/repos?per_page=100&sort=updated&page=${page}`)
      const items = (await res.json()) as RawRepo[]
      out.push(...items.map(toRepoSummary))
      if (!/rel="next"/.test(res.headers.get('link') ?? '') || items.length === 0) break
    }
    return out
  }

  async getRepo(owner: string, repo: string): Promise<RepoSummary> {
    return toRepoSummary(await this.json<RawRepo>('GET', repoPath(owner, repo)))
  }

  /** SETUP-8: write probe with `POST /git/blobs`. 201 → ok, 409 → empty, 403/404 → no-access. */
  async probeWrite(owner: string, repo: string): Promise<WriteProbe> {
    const res = await this.request('POST', `${repoPath(owner, repo)}/git/blobs`, {
      body: { content: WRITE_PROBE_CONTENT, encoding: 'utf-8' },
      allow: [403, 404, 409],
    })
    if (res.status === 409) return 'empty'
    if (res.status === 403 || res.status === 404) {
      // A rate-limited 403 is not a permission answer.
      if (res.status === 403) {
        const err = await this.toError(res)
        if (err.kind === 'rate-limited') throw err
      }
      return 'no-access'
    }
    return 'ok'
  }

  // ---------------------------------------------------------------------------------------------
  // Gists, the mailbox of linking by typing a code (LINK-5)

  /**
   * `POST /gists` with one text file. Returns the gist id and its owner's login, or null when the
   * token may not create gists (a fine-grained token without Gists: Read and write answers 403, a
   * classic token without the `gist` scope 404).
   */
  async createGist(opts: { description: string; filename: string; content: string; public: boolean }): Promise<{ id: string; login: string | null } | null> {
    const res = await this.request('POST', '/gists', {
      body: { description: opts.description, public: opts.public, files: { [opts.filename]: { content: opts.content } } },
      allow: [403, 404],
    })
    if (res.status === 403 || res.status === 404) {
      // A rate-limited 403 is not a permission answer.
      if (res.status === 403) {
        const err = await this.toError(res)
        if (err.kind === 'rate-limited') throw err
      }
      return null
    }
    const gist = (await res.json()) as RawGist
    return { id: gist.id, login: gist.owner?.login ?? null }
  }

  /**
   * `DELETE /gists/{id}`. A gist that is already gone is not an error. `keepalive` sends it at once
   * and lets it finish while the page unloads.
   */
  async deleteGist(id: string, opts: { keepalive?: boolean } = {}): Promise<void> {
    const path = `/gists/${encodeURIComponent(id)}`
    if (opts.keepalive) await this.send('DELETE', path, { allow: [404], keepalive: true })
    else await this.request('DELETE', path, { allow: [404] })
  }

  /** `GET /gists/{id}` → the file's text, or null when the gist or the file does not exist. */
  async getGistFile(id: string, filename: string): Promise<string | null> {
    const res = await this.request('GET', `/gists/${encodeURIComponent(id)}`, { allow: [404] })
    if (res.status === 404) return null
    const file = ((await res.json()) as RawGist).files?.[filename]
    return file && typeof file.content === 'string' && !file.truncated ? file.content : null
  }

  /** `GET /users/{login}/gists`: the user's public gists, newest first. Works without a token. */
  async listUserGists(login: string): Promise<GistSummary[]> {
    return (await this.json<RawGist[]>('GET', `/users/${encodeURIComponent(login)}/gists?per_page=30`)).map(toGistSummary)
  }

  /** `GET /gists`: the token owner's gists, newest first. */
  async listOwnGists(): Promise<GistSummary[]> {
    return (await this.json<RawGist[]>('GET', '/gists?per_page=100')).map(toGistSummary)
  }

  /**
   * SETUP-9: `PUT /repos/{o}/{r}/contents/{path}` to create the first commit of an empty repo.
   * Also works on a non-empty repo for a path that does not exist yet.
   */
  async createFile(owner: string, repo: string, path: string, text: string, message: string, branch?: string): Promise<void> {
    await this.request('PUT', `${repoPath(owner, repo)}/contents/${encodePath(path)}`, {
      body: { message, content: bytesToBase64(utf8Encode(text)), ...(branch ? { branch } : {}) },
    })
  }

  /** Number of page files (DATA-2) on a branch, for the repo list (D13). null if unknown. */
  async countPages(owner: string, repo: string, branch: string): Promise<number | null> {
    try {
      const tree = await this.getTree(owner, repo, branch, true)
      if (tree.truncated) return null
      return tree.entries.filter((e) => e.type === 'blob' && isPagePath(e.path)).length
    } catch (e) {
      if (e instanceof GitHubError) {
        if (e.status === 409) return 0
        if (e.kind === 'unauthorized' || e.kind === 'rate-limited' || e.kind === 'network') throw e
        return null
      }
      throw e
    }
  }

  // ---------------------------------------------------------------------------------------------
  // History (SYNC-15)

  /** SYNC-15: commits touching a path, newest first, 30 per page (page starts at 1). */
  async listCommits(owner: string, repo: string, path: string, page: number): Promise<CommitSummary[]> {
    const q = new URLSearchParams({ path, per_page: '30', page: String(page) })
    const res = await this.request('GET', `${repoPath(owner, repo)}/commits?${q}`, { allow: [409] })
    if (res.status === 409) return []
    const items = (await res.json()) as Array<{
      sha: string
      commit: { message: string; committer?: { date?: string } | null; author?: { date?: string } | null }
      author?: { login?: string } | null
    }>
    return items.map((c) => ({
      sha: c.sha,
      message: c.commit.message,
      date: c.commit.committer?.date ?? c.commit.author?.date ?? '',
      authorLogin: c.author?.login ?? null,
      device: parseDeviceTrailer(c.commit.message),
    }))
  }

  /** SYNC-15: a file's text at a commit (`Accept: application/vnd.github.raw`). */
  async getFileAt(owner: string, repo: string, path: string, ref: string): Promise<string> {
    const res = await this.request('GET', `${repoPath(owner, repo)}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`, {
      accept: 'application/vnd.github.raw',
    })
    return utf8Decode(new Uint8Array(await res.arrayBuffer()))
  }

  /** An attachment's bytes at the branch head (for `_assets/…`, SEC-5). */
  async getFileBlob(owner: string, repo: string, path: string, ref: string): Promise<Blob> {
    const res = await this.request('GET', `${repoPath(owner, repo)}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`, {
      accept: 'application/vnd.github.raw',
    })
    return new Blob([await res.arrayBuffer()])
  }

  // ---------------------------------------------------------------------------------------------
  // Git data (SYNC-5, SYNC-8)

  /** SYNC-5 step 1: the branch head, with `If-None-Match`. 409 (empty repo) is thrown. */
  async getRef(owner: string, repo: string, branch: string, etag?: string | null): Promise<RefResult> {
    const res = await this.request('GET', `${repoPath(owner, repo)}/git/ref/heads/${encodePath(branch)}`, { etag })
    if (res.status === 304) return { notModified: true }
    const body = (await res.json()) as { object: { sha: string } }
    return { notModified: false, sha: body.object.sha, etag: res.headers.get('etag') }
  }

  async getCommit(owner: string, repo: string, sha: string): Promise<GitCommit> {
    const c = await this.json<{ sha: string; tree: { sha: string }; message: string; parents: Array<{ sha: string }>; committer?: { date?: string } }>(
      'GET',
      `${repoPath(owner, repo)}/git/commits/${encodeURIComponent(sha)}`,
    )
    return { sha: c.sha, treeSha: c.tree.sha, message: c.message, parents: c.parents.map((p) => p.sha), date: c.committer?.date ?? '' }
  }

  /** SYNC-5 step 2. `treeish` is a tree SHA (or a branch name). */
  async getTree(owner: string, repo: string, treeish: string, recursive = true): Promise<TreeResult> {
    const t = await this.json<{
      sha: string
      truncated: boolean
      tree: Array<{ path: string; mode: string; type: 'blob' | 'tree' | 'commit'; sha: string; size?: number }>
    }>('GET', `${repoPath(owner, repo)}/git/trees/${encodePath(treeish)}${recursive ? '?recursive=1' : ''}`)
    return {
      sha: t.sha,
      truncated: !!t.truncated,
      entries: t.tree.map((e) => ({ path: e.path, mode: e.mode, type: e.type, sha: e.sha, ...(e.size !== undefined ? { size: e.size } : {}) })),
    }
  }

  private async getBlobRaw(owner: string, repo: string, sha: string): Promise<Uint8Array<ArrayBuffer>> {
    const res = await this.send('GET', `${repoPath(owner, repo)}/git/blobs/${encodeURIComponent(sha)}`)
    const b = (await res.json()) as { content: string; encoding: string }
    return b.encoding === 'base64' ? base64ToBytes(b.content) : utf8Encode(b.content)
  }

  /** `GET /git/blobs/{sha}`: the content is base64, decoded here. */
  getBlob(owner: string, repo: string, sha: string): Promise<Uint8Array<ArrayBuffer>> {
    return this.serial(() => this.getBlobRaw(owner, repo, sha))
  }

  async getBlobText(owner: string, repo: string, sha: string): Promise<string> {
    return utf8Decode(await this.getBlob(owner, repo, sha))
  }

  /**
   * SYNC-5 step 3: the text of many blobs. Up to 20: `GET /git/blobs`, two at a time.
   * More: GraphQL, about 100 per query (binary or truncated ones fall back to REST).
   * `onProgress(done, total)` is called as files arrive.
   */
  getBlobTexts(owner: string, repo: string, shas: string[], onProgress?: (done: number, total: number) => void): Promise<Map<string, string>> {
    const unique = [...new Set(shas)]
    return this.serial(async () => {
      const out = new Map<string, string>()
      const total = unique.length
      onProgress?.(0, total)
      if (total === 0) return out
      let rest = unique
      if (total > REST_DOWNLOAD_LIMIT) {
        rest = []
        for (let i = 0; i < unique.length; i += GRAPHQL_BATCH) {
          const batch = unique.slice(i, i + GRAPHQL_BATCH)
          let got = new Map<string, string>()
          try {
            got = await this.graphqlBlobTexts(owner, repo, batch)
          } catch (e) {
            // GraphQL refused (e.g. a token type it does not accept): REST still works, only slower.
            if (!(e instanceof GitHubError) || (e.kind !== 'forbidden' && e.kind !== 'unknown')) throw e
          }
          for (const sha of batch) {
            const text = got.get(sha)
            if (text === undefined) rest.push(sha)
            else out.set(sha, text)
          }
          onProgress?.(out.size, total)
        }
      }
      // REST, two at a time (SYNC-13).
      let next = 0
      const worker = async () => {
        while (next < rest.length) {
          const sha = rest[next++]
          out.set(sha, utf8Decode(await this.getBlobRaw(owner, repo, sha)))
          onProgress?.(out.size, total)
        }
      }
      await Promise.all([worker(), worker()])
      return out
    })
  }

  /** One GraphQL query for up to 100 blobs. Blobs that are binary, truncated or missing are left out. */
  private async graphqlBlobTexts(owner: string, repo: string, shas: string[]): Promise<Map<string, string>> {
    const fields = shas
      .map((sha, i) => {
        if (!/^[0-9a-f]{40}$/.test(sha)) throw new GitHubError('unknown', 0, `Invalid blob id`)
        return `b${i}: object(oid: "${sha}") { ... on Blob { text isBinary isTruncated byteSize } }`
      })
      .join('\n    ')
    const query = `query($owner: String!, $name: String!) {\n  repository(owner: $owner, name: $name) {\n    ${fields}\n  }\n}`
    const res = await this.send('POST', '/graphql', { body: { query, variables: { owner, name: repo } } })
    const body = (await res.json()) as {
      data?: { repository?: Record<string, { text: string | null; isBinary: boolean; isTruncated?: boolean } | null> | null } | null
      errors?: Array<{ type?: string; message?: string }>
    }
    const repoData = body.data?.repository
    if (!repoData) {
      const err = body.errors?.[0]
      if (err?.type === 'NOT_FOUND') throw new GitHubError('not-found', 404, `GitHub GraphQL: ${err.message ?? 'not found'}`)
      if (err?.type === 'RATE_LIMITED') throw new GitHubError('rate-limited', 403, `GitHub GraphQL: ${err.message ?? 'rate limited'}`)
      throw new GitHubError('unknown', res.status, `GitHub GraphQL: ${err?.message ?? 'no data'}`)
    }
    const out = new Map<string, string>()
    shas.forEach((sha, i) => {
      const b = repoData[`b${i}`]
      if (b && !b.isBinary && !b.isTruncated && typeof b.text === 'string') out.set(sha, b.text)
    })
    return out
  }

  /** SYNC-8 step 3: upload an attachment (base64). Returns the blob SHA. */
  async createBlob(owner: string, repo: string, data: Uint8Array | Blob): Promise<string> {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer())
    const b = await this.json<{ sha: string }>('POST', `${repoPath(owner, repo)}/git/blobs`, {
      body: { content: bytesToBase64(bytes), encoding: 'base64' },
    })
    return b.sha
  }

  /** SYNC-8 step 4. */
  async createTree(owner: string, repo: string, baseTree: string | null, entries: NewTreeEntry[]): Promise<{ sha: string }> {
    const t = await this.json<{ sha: string }>('POST', `${repoPath(owner, repo)}/git/trees`, {
      body: { ...(baseTree ? { base_tree: baseTree } : {}), tree: entries },
    })
    return { sha: t.sha }
  }

  /** SYNC-8 step 5. */
  async createCommit(owner: string, repo: string, commit: { message: string; tree: string; parents: string[] }): Promise<GitCommit> {
    const c = await this.json<{ sha: string; tree: { sha: string }; message: string; parents: Array<{ sha: string }>; committer?: { date?: string } }>(
      'POST',
      `${repoPath(owner, repo)}/git/commits`,
      { body: commit },
    )
    return { sha: c.sha, treeSha: c.tree.sha, message: c.message, parents: c.parents.map((p) => p.sha), date: c.committer?.date ?? '' }
  }

  /** SYNC-8 step 6. A non-fast-forward update throws a `GitHubError` with status 422 (or 409). */
  async updateRef(owner: string, repo: string, branch: string, sha: string, force = false): Promise<void> {
    await this.request('PATCH', `${repoPath(owner, repo)}/git/refs/heads/${encodePath(branch)}`, { body: { sha, force } })
  }
}

export type { TreeItem }
