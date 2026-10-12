/**
 * In-memory fake of the GitHub REST + GraphQL API (TEST-2).
 *
 * - `handle(request)` answers like `api.github.com` would on the wire: every header GitHub sends,
 *   CORS headers included. The e2e adapter passes these straight to `route.fulfill`, so the
 *   browser applies CORS itself.
 * - `fetch` is the browser's view for unit tests: it runs the CORS preflight check and hides
 *   every response header GitHub does not expose (for example
 *   `github-authentication-token-expiration`), like a browser would.
 *
 * No Node-only APIs (WebCrypto, TextEncoder, Request/Response only).
 */
import {
  ObjectStore,
  TreeError,
  concatBytes,
  sha1Hex,
  utf8,
  type Bytes,
  type CommitObject,
  type EntryType,
  type Signature,
  type TreeChange,
  type TreeEntry,
} from './git'

export const API_ORIGIN = 'https://api.github.com'

/** What GitHub sends in `Access-Control-Expose-Headers`. Nothing else is readable from a browser. */
export const EXPOSED_HEADERS = [
  'ETag',
  'Link',
  'Location',
  'Retry-After',
  'X-GitHub-OTP',
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Used',
  'X-RateLimit-Resource',
  'X-RateLimit-Reset',
  'X-OAuth-Scopes',
  'X-Accepted-OAuth-Scopes',
  'X-Poll-Interval',
  'X-GitHub-Media-Type',
  'X-GitHub-SSO',
  'X-GitHub-Request-Id',
  'Deprecation',
  'Sunset',
]

/** What GitHub answers in `Access-Control-Allow-Headers` to a preflight. */
export const ALLOWED_REQUEST_HEADERS = [
  'Authorization',
  'Content-Type',
  'If-Match',
  'If-Modified-Since',
  'If-None-Match',
  'If-Unmodified-Since',
  'Accept-Encoding',
  'X-GitHub-OTP',
  'X-Requested-With',
  'User-Agent',
  'GraphQL-Features',
  'X-Github-Next-Global-ID',
  'X-GitHub-Api-Version',
]

const SAFELISTED_RESPONSE_HEADERS = ['cache-control', 'content-language', 'content-length', 'content-type', 'expires', 'last-modified', 'pragma']
const SAFELISTED_REQUEST_HEADERS = ['accept', 'accept-language', 'content-language']
const SIMPLE_CONTENT_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain']

const DOCS = 'https://docs.github.com/rest'

export interface FakeUser {
  id: number
  login: string
  name: string | null
}

export interface FakeTokenOptions {
  login: string
  /** `github_pat_…` tokens are fine-grained, `ghp_…` are classic. Default: from the prefix. */
  kind?: 'fine-grained' | 'classic'
  /** Fine-grained: the selected repos (`owner/name`), or 'all'. Classic tokens reach every repo of the user. */
  repos?: string[] | 'all'
  /** Contents permission. Default 'write'. */
  permission?: 'read' | 'write'
  /** `YYYY-MM-DD`; sent in the (not CORS-exposed) `github-authentication-token-expiration` header. */
  expiresOn?: string | null
}

interface TokenInfo extends Required<Omit<FakeTokenOptions, 'expiresOn'>> {
  expiresOn: string | null
  revoked: boolean
}

export interface FakeRepoOptions {
  private?: boolean
  /** No commits at all (git endpoints answer 409). Default false. */
  empty?: boolean
  defaultBranch?: string
  description?: string | null
  /** Initial files (first commit). Ignored for an empty repo. */
  files?: Record<string, string | Uint8Array>
}

interface Repo {
  id: number
  owner: string
  name: string
  private: boolean
  description: string | null
  defaultBranch: string
  refs: Map<string, string>
  createdAt: string
  updatedAt: string
  pushedAt: string | null
}

export type FakeFailure =
  | { kind: 'server'; status?: number }
  | { kind: 'network' }
  /** Secondary rate limit: 403 or 429, with or without `retry-after` (seconds). */
  | { kind: 'secondary'; status?: 403 | 429; retryAfter?: number | null }
  /** Primary rate limit exhausted: 403 with `x-ratelimit-remaining: 0`. */
  | { kind: 'primary'; resetInSeconds?: number }
  | { kind: 'status'; status: number; message?: string }

export interface FakeRequestInfo {
  method: string
  /** Decoded path, e.g. `/repos/me/notes/git/trees/abc`. */
  path: string
  /** The query string including `?`, or ''. */
  search: string
  url: URL
  headers: Headers
  /** Parsed JSON body, if any. */
  body: unknown
}

export interface RequestLogEntry {
  method: string
  path: string
  search: string
  status: number
}

export interface CommitFilesOptions {
  /** path → new text/bytes, or null to delete. */
  files: Record<string, string | Uint8Array | null>
  message?: string
  /** Adds the `Device:` trailer (SYNC-9), like the app does. Leave out for a github.com edit. */
  device?: string
  branch?: string
  /** Login of the author (default: the repo owner). */
  author?: string
  /** ISO date (default: now). */
  date?: string
}

export interface FakeCommitInfo {
  sha: string
  message: string
  parents: string[]
  date: string
  tree: string
}

/** A network failure (no response at all). The e2e adapter maps it to `route.abort()`. */
export class FakeNetworkError extends TypeError {
  constructor() {
    super('Failed to fetch')
    this.name = 'TypeError'
  }
}

interface Bucket {
  limit: number
  remaining: number
  /** Epoch seconds. */
  reset: number
  used: number
}

interface Auth {
  token: string
  info: TokenInfo
  user: FakeUser
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public headers: Record<string, string> = {},
    public extra: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

interface Ctx {
  req: Request
  url: URL
  method: string
  auth: Auth | null
  match: string[]
  body: unknown
}

function isoSeconds(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z')
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export function base64ToBytes(b64: string): Bytes {
  const bin = atob(b64.replace(/\s/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** GitHub wraps base64 blob content at 60 characters. */
function wrapBase64(b64: string): string {
  return b64.replace(/.{1,60}/g, '$&\n')
}

function decodePath(raw: string): string {
  return raw
    .split('/')
    .map((s) => decodeURIComponent(s))
    .join('/')
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/')
}

const isBinary = (data: Uint8Array) => data.subarray(0, 8000).includes(0)

export class FakeGitHub {
  private users = new Map<string, FakeUser>()
  private tokens = new Map<string, TokenInfo>()
  private repos = new Map<string, Repo>()
  private stores = new Map<string, ObjectStore>()
  private commitAuthors = new Map<string, string>()
  private buckets = new Map<string, Bucket>()
  private failures: Array<{ failure: FakeFailure; times: number; match?: (r: FakeRequestInfo) => boolean }> = []
  private hooks: Array<(r: FakeRequestInfo) => void | Promise<void>> = []
  private nextId = 1
  private requestCounter = 0

  /** Every request handled, in order (OPTIONS preflights excluded). */
  readonly requests: RequestLogEntry[] = []
  /** Every recursive tree listing reports `truncated: true` (SYNC-5 step 2). */
  truncateTrees = false
  /** GraphQL `Blob.text` is cut off (with `isTruncated: true`) above this many bytes. */
  graphqlTextLimit = 512 * 1024
  /** Every request fails with a network error while true. */
  offline = false

  constructor(private readonly options: { now?: () => number } = {}) {}

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  // ---------------------------------------------------------------------------------------------
  // Test set-up helpers

  addUser(login: string, opts: { name?: string | null } = {}): FakeUser {
    const user: FakeUser = { id: this.nextId++, login, name: opts.name ?? null }
    this.users.set(login, user)
    return user
  }

  addToken(token: string, opts: FakeTokenOptions): void {
    if (!this.users.has(opts.login)) this.addUser(opts.login)
    this.tokens.set(token, {
      login: opts.login,
      kind: opts.kind ?? (token.startsWith('ghp_') ? 'classic' : 'fine-grained'),
      repos: opts.repos ?? 'all',
      permission: opts.permission ?? 'write',
      expiresOn: opts.expiresOn ?? null,
      revoked: false,
    })
  }

  revokeToken(token: string): void {
    const t = this.tokens.get(token)
    if (t) t.revoked = true
  }

  /** Creates `owner/name`. Unless `empty`, it gets a first commit with `files` (or a README). */
  async createRepo(fullName: string, opts: FakeRepoOptions = {}): Promise<void> {
    const [owner, name] = fullName.split('/')
    if (!this.users.has(owner)) this.addUser(owner)
    const at = isoSeconds(this.now())
    this.repos.set(fullName, {
      id: this.nextId++,
      owner,
      name,
      private: opts.private ?? true,
      description: opts.description ?? null,
      defaultBranch: opts.defaultBranch ?? 'main',
      refs: new Map(),
      createdAt: at,
      updatedAt: at,
      pushedAt: null,
    })
    this.stores.set(fullName, new ObjectStore())
    if (!opts.empty) {
      await this.commit(fullName, { files: opts.files ?? { 'README.md': `# ${name}\n` }, message: 'Initial commit' })
    }
  }

  /** Commits file changes straight to a branch, like another device or an edit on github.com. */
  async commit(fullName: string, opts: CommitFilesOptions): Promise<string> {
    const repo = this.repo(fullName)
    const store = this.store(fullName)
    const branch = opts.branch ?? repo.defaultBranch
    const head = repo.refs.get(branch) ?? null
    const baseTree = head ? store.commit(head)!.tree : null
    const changes: TreeChange[] = []
    for (const [path, content] of Object.entries(opts.files)) {
      if (content === null) {
        changes.push({ path, mode: '100644', type: 'blob', sha: null })
      } else {
        const sha = await store.writeBlob(typeof content === 'string' ? utf8(content) : new Uint8Array(content))
        changes.push({ path, mode: '100644', type: 'blob', sha })
      }
    }
    const tree = await store.applyChanges(baseTree, changes)
    let message = opts.message ?? 'Update files'
    if (opts.device) message += `\n\nDevice: ${opts.device}\nApp: GitHub Notes test`
    const login = opts.author ?? repo.owner
    const sig = this.signature(login, opts.date)
    const sha = await store.writeCommit({ tree, parents: head ? [head] : [], message, author: sig, committer: sig })
    this.commitAuthors.set(sha, login)
    this.moveRef(repo, branch, sha)
    return sha
  }

  /** A file's text at a ref (branch, commit or default branch), or null. */
  async readFile(fullName: string, path: string, ref?: string): Promise<string | null> {
    const bytes = this.readBytes(fullName, path, ref)
    return bytes === null ? null : new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
  }

  readBytes(fullName: string, path: string, ref?: string): Bytes | null {
    const store = this.store(fullName)
    const commit = this.resolveCommit(fullName, ref)
    if (!commit) return null
    const entry = store.entryAt(store.commit(commit)!.tree, path)
    return entry?.type === 'blob' ? store.blob(entry.sha) : null
  }

  /** The blob SHA at a path, or null. */
  blobSha(fullName: string, path: string, ref?: string): string | null {
    const store = this.store(fullName)
    const commit = this.resolveCommit(fullName, ref)
    if (!commit) return null
    const entry = store.entryAt(store.commit(commit)!.tree, path)
    return entry?.type === 'blob' ? entry.sha : null
  }

  /** Every file path at a ref, sorted. */
  listFiles(fullName: string, ref?: string): string[] {
    const store = this.store(fullName)
    const commit = this.resolveCommit(fullName, ref)
    if (!commit) return []
    return store
      .walk(store.commit(commit)!.tree)
      .filter((e) => e.type === 'blob')
      .map((e) => e.path)
      .sort()
  }

  /** Every text file at a ref: path → text. */
  async files(fullName: string, ref?: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    for (const path of this.listFiles(fullName, ref)) out[path] = (await this.readFile(fullName, path, ref))!
    return out
  }

  headSha(fullName: string, branch?: string): string | null {
    const repo = this.repo(fullName)
    return repo.refs.get(branch ?? repo.defaultBranch) ?? null
  }

  /** First-parent history of a branch, newest first. */
  commits(fullName: string, branch?: string): FakeCommitInfo[] {
    const store = this.store(fullName)
    const out: FakeCommitInfo[] = []
    let sha = this.headSha(fullName, branch)
    while (sha) {
      const c = store.commit(sha)!
      out.push({ sha, message: c.message, parents: c.parents, date: c.committer.date, tree: c.tree })
      sha = c.parents[0] ?? null
    }
    return out
  }

  /** Repo settings that tests may flip (visibility, description). */
  updateRepo(fullName: string, patch: Partial<Pick<Repo, 'private' | 'description'>>): void {
    Object.assign(this.repo(fullName), patch)
  }

  /** Makes the next matching request(s) fail. `times` defaults to 1. */
  failNext(failure: FakeFailure, opts: { times?: number; match?: (r: FakeRequestInfo) => boolean } = {}): void {
    this.failures.push({ failure, times: opts.times ?? 1, match: opts.match })
  }

  clearFailures(): void {
    this.failures = []
  }

  /** Runs before every request is handled (after CORS preflight). Returns an unsubscribe function. */
  onRequest(hook: (r: FakeRequestInfo) => void | Promise<void>): () => void {
    this.hooks.push(hook)
    return () => {
      this.hooks = this.hooks.filter((h) => h !== hook)
    }
  }

  /** Sets the core rate limit for a token (`x-ratelimit-remaining` / `x-ratelimit-reset`). */
  setRateLimit(token: string | null, opts: { remaining?: number; resetAt?: number; limit?: number; resource?: 'core' | 'graphql' }): void {
    const b = this.bucket(token, opts.resource ?? 'core')
    if (opts.limit !== undefined) b.limit = opts.limit
    if (opts.remaining !== undefined) b.remaining = opts.remaining
    if (opts.resetAt !== undefined) b.reset = Math.floor(opts.resetAt / 1000)
  }

  rateLimit(token: string | null, resource: 'core' | 'graphql' = 'core'): Bucket {
    return { ...this.bucket(token, resource) }
  }

  /** Number of logged requests matching a method and a path pattern. */
  count(method: string, path: RegExp | string): number {
    return this.requests.filter((r) => r.method === method && (typeof path === 'string' ? r.path === path : path.test(r.path))).length
  }

  // ---------------------------------------------------------------------------------------------
  // Transport

  /** The browser's view of `fetch` against the fake: CORS preflight check + hidden headers. */
  readonly fetch: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? new Request(input, init) : new Request(input instanceof URL ? input.href : input, init)
    const url = new URL(req.url)
    if (url.origin !== API_ORIGIN) throw new TypeError(`fake GitHub: unexpected origin ${url.origin}`)
    // CORS preflight: any non-safelisted request header must be allowed by GitHub.
    const allowed = new Set(ALLOWED_REQUEST_HEADERS.map((h) => h.toLowerCase()))
    for (const [name, value] of req.headers) {
      if (SAFELISTED_REQUEST_HEADERS.includes(name)) continue
      if (name === 'content-type' && SIMPLE_CONTENT_TYPES.includes(value.split(';')[0].trim())) continue
      if (!allowed.has(name)) throw new TypeError(`Failed to fetch (CORS: request header ${name} is not allowed)`)
    }
    const res = await this.handle(req)
    const exposed = new Set([...SAFELISTED_RESPONSE_HEADERS, ...EXPOSED_HEADERS.map((h) => h.toLowerCase())])
    const headers = new Headers()
    for (const [name, value] of res.headers) if (exposed.has(name)) headers.set(name, value)
    const body = res.status === 204 || res.status === 304 ? null : await res.arrayBuffer()
    return new Response(body, { status: res.status, statusText: res.statusText, headers })
  }

  /** Answers one request like api.github.com (all headers, including CORS headers). */
  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const method = req.method.toUpperCase()
    if (method === 'OPTIONS') return this.preflight()
    if (this.offline) throw new FakeNetworkError()

    let body: unknown = undefined
    const raw = method === 'GET' || method === 'HEAD' ? '' : await req.text()
    if (raw) {
      try {
        body = JSON.parse(raw)
      } catch {
        body = Symbol.for('invalid-json')
      }
    }
    const info: FakeRequestInfo = { method, path: decodePath(url.pathname), search: url.search, url, headers: req.headers, body }
    for (const hook of [...this.hooks]) await hook(info)

    const log: RequestLogEntry = { method, path: info.path, search: url.search, status: 0 }
    this.requests.push(log)

    const injected = this.takeFailure(info)
    if (injected?.kind === 'network') {
      log.status = 0
      throw new FakeNetworkError()
    }

    let auth: Auth | null = null
    let res: Response
    try {
      auth = this.authenticate(req)
      if (injected) throw this.failureError(injected, auth)
      const resource = info.path === '/graphql' ? 'graphql' : 'core'
      const bucket = this.bucket(auth?.token ?? null, resource)
      this.refill(bucket)
      if (bucket.remaining <= 0) {
        throw new HttpError(403, `API rate limit exceeded for user ID ${auth?.user.id ?? 0}.`, {
          'x-ratelimit-remaining': '0',
        })
      }
      if (body === Symbol.for('invalid-json')) throw new HttpError(400, 'Problems parsing JSON')
      res = await this.route({ req, url, method, auth, match: [], body })
      if (method === 'GET' && res.status === 200) res = await this.withEtag(req, res)
      if (res.status !== 304) {
        bucket.remaining = Math.max(0, bucket.remaining - 1)
        bucket.used++
      }
      res = this.finish(res, auth, resource)
    } catch (e) {
      if (!(e instanceof HttpError)) throw e
      res = this.finish(this.errorResponse(e), auth, info.path === '/graphql' ? 'graphql' : 'core', e.headers)
    }
    log.status = res.status
    return res
  }

  // ---------------------------------------------------------------------------------------------
  // Internals

  private repo(fullName: string): Repo {
    const r = this.repos.get(fullName)
    if (!r) throw new Error(`fake GitHub: no repo ${fullName}`)
    return r
  }

  private store(fullName: string): ObjectStore {
    return this.stores.get(fullName)!
  }

  private resolveCommit(fullName: string, ref?: string): string | null {
    const repo = this.repo(fullName)
    if (!ref) return repo.refs.get(repo.defaultBranch) ?? null
    if (repo.refs.has(ref)) return repo.refs.get(ref)!
    if (ref.startsWith('heads/') && repo.refs.has(ref.slice(6))) return repo.refs.get(ref.slice(6))!
    if (ref.startsWith('refs/heads/') && repo.refs.has(ref.slice(11))) return repo.refs.get(ref.slice(11))!
    return this.store(fullName).commit(ref) ? ref : null
  }

  private signature(login: string, date?: string): Signature {
    const user = this.users.get(login)
    return {
      name: user?.name ?? login,
      email: `${user?.id ?? 0}+${login}@users.noreply.github.com`,
      date: date ?? isoSeconds(this.now()),
    }
  }

  private moveRef(repo: Repo, branch: string, sha: string): void {
    repo.refs.set(branch, sha)
    repo.pushedAt = isoSeconds(this.now())
    repo.updatedAt = repo.pushedAt
  }

  private bucket(token: string | null, resource: 'core' | 'graphql'): Bucket {
    const key = `${token ?? 'anonymous'}:${resource}`
    let b = this.buckets.get(key)
    if (!b) {
      const limit = token ? 5000 : 60
      b = { limit, remaining: limit, reset: Math.floor(this.now() / 1000) + 3600, used: 0 }
      this.buckets.set(key, b)
    }
    return b
  }

  private refill(b: Bucket): void {
    const nowS = Math.floor(this.now() / 1000)
    if (nowS >= b.reset) {
      b.remaining = b.limit
      b.used = 0
      b.reset = nowS + 3600
    }
  }

  private takeFailure(info: FakeRequestInfo): FakeFailure | null {
    const i = this.failures.findIndex((f) => !f.match || f.match(info))
    if (i === -1) return null
    const f = this.failures[i]
    f.times--
    if (f.times <= 0) this.failures.splice(i, 1)
    return f.failure
  }

  private failureError(f: FakeFailure, auth: Auth | null): HttpError {
    switch (f.kind) {
      case 'server':
        return new HttpError(f.status ?? 502, 'Server Error')
      case 'secondary': {
        const headers: Record<string, string> = {}
        if (f.retryAfter != null) headers['retry-after'] = String(f.retryAfter)
        return new HttpError(
          f.status ?? 403,
          'You have exceeded a secondary rate limit. Please wait a few minutes before you try again. If you reach out to GitHub Support for help, please include the request ID.',
          headers,
        )
      }
      case 'primary': {
        const reset = Math.floor(this.now() / 1000) + (f.resetInSeconds ?? 600)
        return new HttpError(403, `API rate limit exceeded for user ID ${auth?.user.id ?? 0}.`, {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(reset),
        })
      }
      case 'status':
        return new HttpError(f.status, f.message ?? 'Injected failure')
      default:
        return new HttpError(500, 'Server Error')
    }
  }

  private authenticate(req: Request): Auth | null {
    const header = req.headers.get('authorization')
    if (!header) return null
    const m = /^(?:bearer|token)\s+(\S+)$/i.exec(header.trim())
    const token = m?.[1]
    const info = token ? this.tokens.get(token) : undefined
    const expired = info?.expiresOn ? Date.parse(`${info.expiresOn}T23:59:59Z`) < this.now() : false
    if (!token || !info || info.revoked || expired) throw new HttpError(401, 'Bad credentials')
    return { token, info, user: this.users.get(info.login)! }
  }

  private preflight(): Response {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': ALLOWED_REQUEST_HEADERS.join(', '),
        'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE',
        'access-control-expose-headers': EXPOSED_HEADERS.join(', '),
        'access-control-max-age': '86400',
        vary: 'Accept-Encoding, Accept, X-Requested-With',
      },
    })
  }

  private finish(res: Response, auth: Auth | null, resource: 'core' | 'graphql', extra: Record<string, string> = {}): Response {
    const headers = new Headers(res.headers)
    const b = this.bucket(auth?.token ?? null, resource)
    headers.set('x-ratelimit-limit', String(b.limit))
    headers.set('x-ratelimit-remaining', String(b.remaining))
    headers.set('x-ratelimit-reset', String(b.reset))
    headers.set('x-ratelimit-used', String(b.used))
    headers.set('x-ratelimit-resource', resource)
    for (const [k, v] of Object.entries(extra)) headers.set(k, v)
    headers.set('access-control-allow-origin', '*')
    headers.set('access-control-expose-headers', EXPOSED_HEADERS.join(', '))
    headers.set('x-github-api-version-selected', '2022-11-28')
    headers.set('x-github-media-type', 'github.v3; format=json')
    headers.set('x-github-request-id', `FAKE:${(++this.requestCounter).toString(16).toUpperCase()}`)
    headers.set('vary', 'Accept, Authorization, Cookie, X-GitHub-OTP')
    if (auth) {
      if (auth.info.kind === 'classic') headers.set('x-oauth-scopes', 'repo')
      if (auth.info.expiresOn) headers.set('github-authentication-token-expiration', `${auth.info.expiresOn} 23:59:59 UTC`)
    }
    return new Response(res.status === 204 || res.status === 304 ? null : res.body, { status: res.status, headers })
  }

  private errorResponse(e: HttpError): Response {
    if (e.status === 304) return new Response(null, { status: 304 })
    return this.json(e.status, { message: e.message, documentation_url: DOCS, status: String(e.status), ...e.extra })
  }

  private json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
    })
  }

  private async withEtag(req: Request, res: Response): Promise<Response> {
    const buf = new Uint8Array(await res.arrayBuffer())
    const etag = `W/"${await sha1Hex(concatBytes([buf]))}"`
    const inm = req.headers.get('if-none-match')
    const headers = new Headers(res.headers)
    headers.set('etag', etag)
    headers.set('cache-control', 'private, max-age=60, s-maxage=60')
    if (inm && inm.split(',').some((t) => t.trim() === etag || t.trim() === etag.slice(2))) {
      return new Response(null, { status: 304, headers })
    }
    return new Response(buf, { status: 200, headers })
  }

  private async route(ctx: Ctx): Promise<Response> {
    const p = ctx.url.pathname
    const m = (re: RegExp) => {
      const r = re.exec(p)
      if (r) ctx.match = r.slice(1).map((s) => (s === undefined ? '' : s))
      return !!r
    }
    const { method } = ctx
    if (method === 'GET' && m(/^\/user$/)) return this.getUser(ctx)
    if (method === 'GET' && m(/^\/user\/repos$/)) return this.listRepos(ctx)
    if (method === 'POST' && m(/^\/graphql$/)) return this.graphql(ctx)
    if (method === 'GET' && m(/^\/repos\/([^/]+)\/([^/]+)$/)) return this.getRepo(ctx)
    if (method === 'POST' && m(/^\/repos\/([^/]+)\/([^/]+)\/git\/blobs$/)) return this.createBlob(ctx)
    if (method === 'GET' && m(/^\/repos\/([^/]+)\/([^/]+)\/git\/blobs\/([^/]+)$/)) return this.getBlob(ctx)
    if (method === 'GET' && m(/^\/repos\/([^/]+)\/([^/]+)\/git\/ref\/(.+)$/)) return this.getRef(ctx)
    if (method === 'POST' && m(/^\/repos\/([^/]+)\/([^/]+)\/git\/refs$/)) return this.createRef(ctx)
    if (method === 'PATCH' && m(/^\/repos\/([^/]+)\/([^/]+)\/git\/refs\/(.+)$/)) return this.updateRef(ctx)
    if (method === 'GET' && m(/^\/repos\/([^/]+)\/([^/]+)\/git\/trees\/(.+)$/)) return this.getTree(ctx)
    if (method === 'POST' && m(/^\/repos\/([^/]+)\/([^/]+)\/git\/trees$/)) return this.createTree(ctx)
    if (method === 'GET' && m(/^\/repos\/([^/]+)\/([^/]+)\/git\/commits\/([^/]+)$/)) return this.getCommit(ctx)
    if (method === 'POST' && m(/^\/repos\/([^/]+)\/([^/]+)\/git\/commits$/)) return this.createCommit(ctx)
    if (method === 'GET' && m(/^\/repos\/([^/]+)\/([^/]+)\/commits$/)) return this.listCommits(ctx)
    if (method === 'GET' && m(/^\/repos\/([^/]+)\/([^/]+)\/contents(?:\/(.*))?$/)) return this.getContents(ctx)
    if (method === 'PUT' && m(/^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/)) return this.putContents(ctx)
    throw new HttpError(404, 'Not Found')
  }

  // ----- access ---------------------------------------------------------------------------------

  private canSee(auth: Auth | null, repo: Repo): boolean {
    if (!repo.private) return true
    if (!auth || auth.user.login !== repo.owner) return false
    if (auth.info.kind === 'classic') return true
    return auth.info.repos === 'all' || auth.info.repos.includes(`${repo.owner}/${repo.name}`)
  }

  private canWrite(auth: Auth | null, repo: Repo): boolean {
    if (!auth || auth.user.login !== repo.owner) return false
    if (auth.info.permission !== 'write') return false
    if (auth.info.kind === 'classic') return true
    return auth.info.repos === 'all' || auth.info.repos.includes(`${repo.owner}/${repo.name}`)
  }

  /** The repo from the URL, checked for read (and optionally write) access. */
  private access(ctx: Ctx, write = false): { repo: Repo; store: ObjectStore; fullName: string } {
    const fullName = `${decodeURIComponent(ctx.match[0])}/${decodeURIComponent(ctx.match[1])}`
    const repo = this.repos.get(fullName)
    if (!repo || !this.canSee(ctx.auth, repo)) throw new HttpError(404, 'Not Found')
    if (write && !this.canWrite(ctx.auth, repo)) {
      if (ctx.auth?.info.kind === 'fine-grained' && this.canSee(ctx.auth, repo)) {
        throw new HttpError(403, 'Resource not accessible by personal access token', {
          'x-accepted-github-permissions': 'contents=write',
        })
      }
      throw new HttpError(404, 'Not Found')
    }
    return { repo, store: this.store(fullName), fullName }
  }

  private requireNotEmpty(repo: Repo): void {
    if (repo.refs.size === 0) throw new HttpError(409, 'Git Repository is empty.')
  }

  private requireAuth(ctx: Ctx): Auth {
    if (!ctx.auth) throw new HttpError(401, 'Requires authentication')
    return ctx.auth
  }

  // ----- JSON shapes ----------------------------------------------------------------------------

  private api(path: string): string {
    return `${API_ORIGIN}${path}`
  }

  private userJson(user: FakeUser) {
    return {
      login: user.login,
      id: user.id,
      node_id: `U_${user.id}`,
      avatar_url: `https://avatars.githubusercontent.com/u/${user.id}?v=4`,
      url: this.api(`/users/${user.login}`),
      html_url: `https://github.com/${user.login}`,
      type: 'User',
      site_admin: false,
      name: user.name,
    }
  }

  private repoJson(repo: Repo, auth: Auth | null) {
    const owner = this.users.get(repo.owner)!
    const push = this.canWrite(auth, repo)
    const size = repo.refs.size === 0 ? 0 : Math.max(1, Math.ceil(this.repoBytes(repo) / 1024))
    return {
      id: repo.id,
      node_id: `R_${repo.id}`,
      name: repo.name,
      full_name: `${repo.owner}/${repo.name}`,
      private: repo.private,
      owner: this.userJson(owner),
      html_url: `https://github.com/${repo.owner}/${repo.name}`,
      description: repo.description,
      fork: false,
      url: this.api(`/repos/${repo.owner}/${repo.name}`),
      created_at: repo.createdAt,
      updated_at: repo.updatedAt,
      pushed_at: repo.pushedAt,
      size,
      default_branch: repo.defaultBranch,
      visibility: repo.private ? 'private' : 'public',
      archived: false,
      disabled: false,
      permissions: { admin: push, maintain: push, push, triage: push, pull: true },
    }
  }

  private repoBytes(repo: Repo): number {
    const fullName = `${repo.owner}/${repo.name}`
    const head = repo.refs.get(repo.defaultBranch)
    if (!head) return 0
    const store = this.store(fullName)
    return store
      .walk(store.commit(head)!.tree)
      .reduce((n, e) => n + (e.size ?? 0), 0)
  }

  private gitCommitJson(fullName: string, sha: string, c: CommitObject) {
    return {
      sha,
      node_id: `C_${sha.slice(0, 12)}`,
      url: this.api(`/repos/${fullName}/git/commits/${sha}`),
      html_url: `https://github.com/${fullName}/commit/${sha}`,
      author: c.author,
      committer: c.committer,
      tree: { sha: c.tree, url: this.api(`/repos/${fullName}/git/trees/${c.tree}`) },
      message: c.message,
      parents: c.parents.map((p) => ({
        sha: p,
        url: this.api(`/repos/${fullName}/git/commits/${p}`),
        html_url: `https://github.com/${fullName}/commit/${p}`,
      })),
      verification: { verified: false, reason: 'unsigned', signature: null, payload: null, verified_at: null },
    }
  }

  private refJson(fullName: string, branch: string, sha: string) {
    return {
      ref: `refs/heads/${branch}`,
      node_id: `REF_${branch}`,
      url: this.api(`/repos/${fullName}/git/refs/heads/${branch}`),
      object: { sha, type: 'commit', url: this.api(`/repos/${fullName}/git/commits/${sha}`) },
    }
  }

  private linkHeader(url: URL, page: number, lastPage: number): Record<string, string> {
    if (lastPage <= 1) return {}
    const at = (n: number) => {
      const u = new URL(url.href)
      u.searchParams.set('page', String(n))
      return `<${u.href}>`
    }
    const links: string[] = []
    if (page > 1) links.push(`${at(page - 1)}; rel="prev"`)
    if (page < lastPage) links.push(`${at(page + 1)}; rel="next"`, `${at(lastPage)}; rel="last"`)
    if (page > 1) links.push(`${at(1)}; rel="first"`)
    return links.length ? { link: links.join(', ') } : {}
  }

  private paging(url: URL, defaultPerPage = 30): { perPage: number; page: number } {
    const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get('per_page')) || defaultPerPage))
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
    return { perPage, page }
  }

  // ----- endpoints ------------------------------------------------------------------------------

  private getUser(ctx: Ctx): Response {
    const auth = this.requireAuth(ctx)
    return this.json(200, {
      ...this.userJson(auth.user),
      company: null,
      blog: '',
      location: null,
      email: null,
      bio: null,
      public_repos: [...this.repos.values()].filter((r) => r.owner === auth.user.login && !r.private).length,
      created_at: '2020-01-01T00:00:00Z',
      updated_at: '2020-01-01T00:00:00Z',
    })
  }

  private listRepos(ctx: Ctx): Response {
    const auth = this.requireAuth(ctx)
    const sort = ctx.url.searchParams.get('sort') ?? 'full_name'
    const direction = ctx.url.searchParams.get('direction') ?? (sort === 'full_name' ? 'asc' : 'desc')
    const repos = [...this.repos.values()].filter((r) => r.owner === auth.user.login && this.canSee(auth, r))
    const key = (r: Repo) =>
      sort === 'updated' ? r.updatedAt : sort === 'pushed' ? (r.pushedAt ?? '') : sort === 'created' ? r.createdAt : `${r.owner}/${r.name}`
    repos.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.id - b.id) * (direction === 'asc' ? 1 : -1))
    const { perPage, page } = this.paging(ctx.url)
    const lastPage = Math.max(1, Math.ceil(repos.length / perPage))
    const slice = repos.slice((page - 1) * perPage, page * perPage)
    return this.json(
      200,
      slice.map((r) => this.repoJson(r, auth)),
      this.linkHeader(ctx.url, page, lastPage),
    )
  }

  private getRepo(ctx: Ctx): Response {
    const { repo } = this.access(ctx)
    return this.json(200, this.repoJson(repo, ctx.auth))
  }

  private async createBlob(ctx: Ctx): Promise<Response> {
    const { repo, store, fullName } = this.access(ctx, true)
    this.requireNotEmpty(repo)
    const body = (ctx.body ?? {}) as { content?: unknown; encoding?: unknown }
    if (typeof body.content !== 'string') throw new HttpError(422, 'Invalid request.\n\n"content" wasn\'t supplied.')
    const encoding = body.encoding ?? 'utf-8'
    let data: Bytes
    if (encoding === 'base64') {
      try {
        data = base64ToBytes(body.content)
      } catch {
        throw new HttpError(422, 'Invalid request.\n\nInvalid base64 content.')
      }
    } else if (encoding === 'utf-8' || encoding === 'utf8') {
      data = utf8(body.content)
    } else {
      throw new HttpError(422, `Invalid request.\n\nencoding ${String(encoding)} is not a member of ["utf-8", "base64"].`)
    }
    const sha = await store.writeBlob(data)
    const url = this.api(`/repos/${fullName}/git/blobs/${sha}`)
    return this.json(201, { url, sha }, { location: url })
  }

  private getBlob(ctx: Ctx): Response {
    const { repo, store, fullName } = this.access(ctx)
    this.requireNotEmpty(repo)
    const sha = ctx.match[2]
    const data = store.blob(sha)
    if (!data) throw new HttpError(404, 'Not Found')
    return this.json(200, {
      sha,
      node_id: `B_${sha.slice(0, 12)}`,
      size: data.length,
      url: this.api(`/repos/${fullName}/git/blobs/${sha}`),
      content: wrapBase64(bytesToBase64(data)),
      encoding: 'base64',
    })
  }

  private getRef(ctx: Ctx): Response {
    const { repo, fullName } = this.access(ctx)
    this.requireNotEmpty(repo)
    const ref = decodePath(ctx.match[2])
    if (!ref.startsWith('heads/')) throw new HttpError(404, 'Not Found')
    const branch = ref.slice('heads/'.length)
    const sha = repo.refs.get(branch)
    if (!sha) throw new HttpError(404, 'Not Found')
    return this.json(200, this.refJson(fullName, branch, sha))
  }

  private createRef(ctx: Ctx): Response {
    const { repo, store, fullName } = this.access(ctx, true)
    this.requireNotEmpty(repo)
    const body = (ctx.body ?? {}) as { ref?: unknown; sha?: unknown }
    if (typeof body.ref !== 'string' || !body.ref.startsWith('refs/heads/')) throw new HttpError(422, 'Reference name must start with refs/heads/')
    if (typeof body.sha !== 'string' || !store.commit(body.sha)) throw new HttpError(422, 'Object does not exist')
    const branch = body.ref.slice('refs/heads/'.length)
    if (repo.refs.has(branch)) throw new HttpError(422, 'Reference already exists')
    this.moveRef(repo, branch, body.sha)
    return this.json(201, this.refJson(fullName, branch, body.sha))
  }

  private updateRef(ctx: Ctx): Response {
    const { repo, store, fullName } = this.access(ctx, true)
    this.requireNotEmpty(repo)
    const ref = decodePath(ctx.match[2])
    const branch = ref.startsWith('heads/') ? ref.slice('heads/'.length) : null
    const current = branch ? repo.refs.get(branch) : undefined
    if (!branch || !current) throw new HttpError(422, 'Reference does not exist')
    const body = (ctx.body ?? {}) as { sha?: unknown; force?: unknown }
    if (typeof body.sha !== 'string' || !store.commit(body.sha)) throw new HttpError(422, 'Object does not exist')
    if (body.force !== true && !store.isAncestor(current, body.sha)) throw new HttpError(422, 'Update is not a fast forward')
    this.moveRef(repo, branch, body.sha)
    return this.json(200, this.refJson(fullName, branch, body.sha))
  }

  private getTree(ctx: Ctx): Response {
    const { repo, store, fullName } = this.access(ctx)
    this.requireNotEmpty(repo)
    const ref = decodePath(ctx.match[2])
    let treeSha: string | null = store.tree(ref) ? ref : null
    if (!treeSha) {
      const commit = this.resolveCommit(fullName, ref)
      treeSha = commit ? store.commit(commit)!.tree : null
    }
    if (!treeSha) throw new HttpError(404, 'Not Found')
    const recursive = ctx.url.searchParams.has('recursive')
    const entries = recursive
      ? store.walk(treeSha)
      : store.tree(treeSha)!.map((e) => ({ path: e.name, mode: e.mode, type: e.type, sha: e.sha, size: e.type === 'blob' ? store.blob(e.sha)?.length : undefined }))
    let list = entries
    let truncated = false
    if (recursive && this.truncateTrees) {
      truncated = true
      list = entries.slice(0, Math.ceil(entries.length / 2))
    }
    return this.json(200, {
      sha: treeSha,
      url: this.api(`/repos/${fullName}/git/trees/${treeSha}`),
      tree: list.map((e) => ({
        path: e.path,
        mode: e.mode,
        type: e.type,
        sha: e.sha,
        ...(e.type === 'blob' ? { size: e.size ?? 0 } : {}),
        url: this.api(`/repos/${fullName}/git/${e.type === 'tree' ? 'trees' : 'blobs'}/${e.sha}`),
      })),
      truncated,
    })
  }

  private async createTree(ctx: Ctx): Promise<Response> {
    const { repo, store, fullName } = this.access(ctx, true)
    this.requireNotEmpty(repo)
    const body = (ctx.body ?? {}) as { base_tree?: unknown; tree?: unknown }
    if (!Array.isArray(body.tree)) throw new HttpError(422, 'Invalid request.\n\n"tree" wasn\'t supplied.')
    let base: string | null = null
    if (body.base_tree != null) {
      if (typeof body.base_tree !== 'string' || !store.tree(body.base_tree)) throw new HttpError(422, 'base_tree is not a valid tree oid')
      base = body.base_tree
    }
    const changes: TreeChange[] = []
    for (const raw of body.tree as Array<Record<string, unknown>>) {
      const { path, mode, type } = raw
      if (typeof path !== 'string') throw new HttpError(422, 'Invalid tree info')
      if (!['100644', '100755', '040000', '160000', '120000'].includes(String(mode))) throw new HttpError(422, `tree.mode ${String(mode)} is not valid`)
      if (!['blob', 'tree', 'commit'].includes(String(type))) throw new HttpError(422, `tree.type ${String(type)} is not valid`)
      const hasSha = 'sha' in raw
      const hasContent = 'content' in raw && raw.content !== undefined
      if (hasSha === hasContent) throw new HttpError(422, 'Must supply either tree.sha or tree.content')
      let sha: string | null
      if (hasContent) {
        if (typeof raw.content !== 'string' || type !== 'blob') throw new HttpError(422, 'Invalid tree info')
        sha = await store.writeBlob(utf8(raw.content))
      } else {
        if (raw.sha !== null && typeof raw.sha !== 'string') throw new HttpError(422, 'Invalid tree info')
        sha = raw.sha as string | null
      }
      changes.push({ path, mode: String(mode), type: type as EntryType, sha })
    }
    let sha: string
    try {
      sha = await store.applyChanges(base, changes)
    } catch (e) {
      if (e instanceof TreeError) throw new HttpError(422, e.message)
      throw e
    }
    const entries: TreeEntry[] = store.tree(sha)!
    const url = this.api(`/repos/${fullName}/git/trees/${sha}`)
    return this.json(
      201,
      {
        sha,
        url,
        tree: entries.map((e) => ({
          path: e.name,
          mode: e.mode,
          type: e.type,
          sha: e.sha,
          ...(e.type === 'blob' ? { size: store.blob(e.sha)?.length ?? 0 } : {}),
          url: this.api(`/repos/${fullName}/git/${e.type === 'tree' ? 'trees' : 'blobs'}/${e.sha}`),
        })),
        truncated: false,
      },
      { location: url },
    )
  }

  private getCommit(ctx: Ctx): Response {
    const { repo, store, fullName } = this.access(ctx)
    this.requireNotEmpty(repo)
    const sha = ctx.match[2]
    const c = store.commit(sha)
    if (!c) throw new HttpError(404, 'Not Found')
    return this.json(200, this.gitCommitJson(fullName, sha, c))
  }

  private async createCommit(ctx: Ctx): Promise<Response> {
    const { repo, store, fullName } = this.access(ctx, true)
    this.requireNotEmpty(repo)
    const body = (ctx.body ?? {}) as { message?: unknown; tree?: unknown; parents?: unknown; author?: unknown; committer?: unknown }
    if (typeof body.message !== 'string') throw new HttpError(422, 'Invalid request.\n\n"message" wasn\'t supplied.')
    if (typeof body.tree !== 'string' || !store.tree(body.tree)) throw new HttpError(422, 'Tree SHA does not exist')
    const parents = body.parents ?? []
    if (!Array.isArray(parents) || !parents.every((p) => typeof p === 'string' && store.commit(p))) {
      throw new HttpError(422, 'Parent SHA does not exist or is not a commit object')
    }
    const login = ctx.auth!.user.login
    const sig = this.signature(login)
    const pick = (v: unknown): Signature => {
      const o = (v ?? {}) as Partial<Signature>
      return { name: o.name ?? sig.name, email: o.email ?? sig.email, date: o.date ?? sig.date }
    }
    const commit: Omit<CommitObject, 'type'> = {
      tree: body.tree,
      parents: parents as string[],
      message: body.message,
      author: pick(body.author),
      committer: pick(body.committer ?? body.author),
    }
    const sha = await store.writeCommit(commit)
    this.commitAuthors.set(sha, login)
    const url = this.api(`/repos/${fullName}/git/commits/${sha}`)
    return this.json(201, this.gitCommitJson(fullName, sha, { type: 'commit', ...commit }), { location: url })
  }

  private listCommits(ctx: Ctx): Response {
    const { repo, store, fullName } = this.access(ctx)
    this.requireNotEmpty(repo)
    const ref = ctx.url.searchParams.get('sha') ?? repo.defaultBranch
    const head = this.resolveCommit(fullName, ref)
    if (!head) throw new HttpError(404, 'Not Found')
    const path = ctx.url.searchParams.get('path')
    const all: string[] = []
    let sha: string | null = head
    while (sha) {
      const c: CommitObject = store.commit(sha)!
      const parent = c.parents[0] ?? null
      if (!path) {
        all.push(sha)
      } else {
        const here = store.entryAt(c.tree, path)?.sha ?? null
        const before = parent ? (store.entryAt(store.commit(parent)!.tree, path)?.sha ?? null) : null
        if (here !== before) all.push(sha)
      }
      sha = parent
    }
    const { perPage, page } = this.paging(ctx.url)
    const lastPage = Math.max(1, Math.ceil(all.length / perPage))
    const items = all.slice((page - 1) * perPage, page * perPage).map((s) => {
      const c = store.commit(s)!
      const login = this.commitAuthors.get(s)
      const user = login ? this.users.get(login) : undefined
      return {
        sha: s,
        node_id: `C_${s.slice(0, 12)}`,
        commit: {
          author: c.author,
          committer: c.committer,
          message: c.message,
          tree: { sha: c.tree, url: this.api(`/repos/${fullName}/git/trees/${c.tree}`) },
          url: this.api(`/repos/${fullName}/git/commits/${s}`),
          comment_count: 0,
          verification: { verified: false, reason: 'unsigned', signature: null, payload: null, verified_at: null },
        },
        url: this.api(`/repos/${fullName}/commits/${s}`),
        html_url: `https://github.com/${fullName}/commit/${s}`,
        comments_url: this.api(`/repos/${fullName}/commits/${s}/comments`),
        author: user ? this.userJson(user) : null,
        committer: user ? this.userJson(user) : null,
        parents: c.parents.map((p) => ({ sha: p, url: this.api(`/repos/${fullName}/commits/${p}`), html_url: `https://github.com/${fullName}/commit/${p}` })),
      }
    })
    return this.json(200, items, this.linkHeader(ctx.url, page, lastPage))
  }

  private contentJson(fullName: string, path: string, sha: string, size: number, ref: string) {
    const url = this.api(`/repos/${fullName}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`)
    const git = this.api(`/repos/${fullName}/git/blobs/${sha}`)
    const html = `https://github.com/${fullName}/blob/${ref}/${encodePath(path)}`
    return {
      name: path.split('/').pop()!,
      path,
      sha,
      size,
      url,
      html_url: html,
      git_url: git,
      download_url: `https://raw.githubusercontent.com/${fullName}/${ref}/${encodePath(path)}`,
      type: 'file',
      _links: { self: url, git, html },
    }
  }

  private getContents(ctx: Ctx): Response {
    const { repo, store, fullName } = this.access(ctx)
    if (repo.refs.size === 0) throw new HttpError(404, 'This repository is empty.')
    const path = decodePath(ctx.match[2] ?? '').replace(/\/$/, '')
    const ref = ctx.url.searchParams.get('ref') ?? repo.defaultBranch
    const commit = this.resolveCommit(fullName, ref)
    if (!commit) throw new HttpError(404, `No commit found for the ref ${ref}`)
    const entry = store.entryAt(store.commit(commit)!.tree, path)
    if (!entry) throw new HttpError(404, 'Not Found')
    const accept = ctx.req.headers.get('accept') ?? ''
    if (entry.type === 'tree') {
      return this.json(
        200,
        store.tree(entry.sha)!.map((e) => ({
          ...this.contentJson(fullName, path ? `${path}/${e.name}` : e.name, e.sha, e.type === 'blob' ? (store.blob(e.sha)?.length ?? 0) : 0, ref),
          type: e.type === 'tree' ? 'dir' : 'file',
        })),
      )
    }
    const data = store.blob(entry.sha)!
    if (/application\/vnd\.github(\.v3)?\.raw/.test(accept)) {
      return new Response(data, { status: 200, headers: { 'content-type': 'application/vnd.github.raw; charset=utf-8' } })
    }
    const big = data.length > 1024 * 1024
    return this.json(200, {
      ...this.contentJson(fullName, path, entry.sha, data.length, ref),
      content: big ? '' : wrapBase64(bytesToBase64(data)),
      encoding: big ? 'none' : 'base64',
    })
  }

  private async putContents(ctx: Ctx): Promise<Response> {
    const { repo, store, fullName } = this.access(ctx, true)
    const path = decodePath(ctx.match[2])
    const body = (ctx.body ?? {}) as { message?: unknown; content?: unknown; sha?: unknown; branch?: unknown }
    if (typeof body.message !== 'string') throw new HttpError(422, 'Invalid request.\n\n"message" wasn\'t supplied.')
    if (typeof body.content !== 'string') throw new HttpError(422, 'Invalid request.\n\n"content" wasn\'t supplied.')
    let data: Bytes
    try {
      data = base64ToBytes(body.content)
    } catch {
      throw new HttpError(422, 'Invalid request.\n\ncontent is not valid Base64')
    }
    const branch = typeof body.branch === 'string' ? body.branch : repo.defaultBranch
    const head = repo.refs.get(branch) ?? null
    if (!head && repo.refs.size > 0) throw new HttpError(404, `Branch ${branch} not found`)
    const baseTree = head ? store.commit(head)!.tree : null
    const existing = baseTree ? store.entryAt(baseTree, path) : null
    if (existing && body.sha === undefined) throw new HttpError(422, 'Invalid request.\n\n"sha" wasn\'t supplied.')
    if (existing && body.sha !== existing.sha) throw new HttpError(409, `${path} does not match ${String(body.sha)}`)
    if (!existing && typeof body.sha === 'string') throw new HttpError(409, `${path} does not match ${body.sha}`)
    const blob = await store.writeBlob(data)
    let tree: string
    try {
      tree = await store.applyChanges(baseTree, [{ path, mode: '100644', type: 'blob', sha: blob }])
    } catch (e) {
      if (e instanceof TreeError) throw new HttpError(422, e.message)
      throw e
    }
    const login = ctx.auth!.user.login
    const sig = this.signature(login)
    const commit: Omit<CommitObject, 'type'> = { tree, parents: head ? [head] : [], message: body.message, author: sig, committer: sig }
    const sha = await store.writeCommit(commit)
    this.commitAuthors.set(sha, login)
    this.moveRef(repo, branch, sha)
    return this.json(existing ? 200 : 201, {
      content: this.contentJson(fullName, path, blob, data.length, branch),
      commit: this.gitCommitJson(fullName, sha, { type: 'commit', ...commit }),
    })
  }

  // ----- GraphQL --------------------------------------------------------------------------------

  /**
   * Supports the one query shape the client uses:
   * `repository(owner:, name:) { alias: object(oid: "…") { ... on Blob { text byteSize isBinary isTruncated oid } } }`
   * with literal or `$variable` arguments.
   */
  private graphql(ctx: Ctx): Response {
    if (!ctx.auth) throw new HttpError(401, 'This endpoint requires you to be authenticated.')
    const body = (ctx.body ?? {}) as { query?: unknown; variables?: Record<string, unknown> }
    if (typeof body.query !== 'string') {
      return this.json(200, { errors: [{ message: 'A query attribute must be specified and must be a string.' }] })
    }
    const vars = body.variables ?? {}
    const arg = (raw: string): string => {
      const v = raw.trim()
      if (v.startsWith('$')) return String(vars[v.slice(1)] ?? '')
      return v.replace(/^"|"$/g, '')
    }
    const repoMatch = /repository\s*\(\s*owner\s*:\s*("[^"]*"|\$\w+)\s*,\s*name\s*:\s*("[^"]*"|\$\w+)\s*\)/.exec(body.query)
    if (!repoMatch) {
      return this.json(200, { errors: [{ message: 'fake GitHub: unsupported GraphQL query' }] })
    }
    const fullName = `${arg(repoMatch[1])}/${arg(repoMatch[2])}`
    const repo = this.repos.get(fullName)
    if (!repo || !this.canSee(ctx.auth, repo)) {
      return this.json(200, {
        data: { repository: null },
        errors: [
          {
            type: 'NOT_FOUND',
            path: ['repository'],
            locations: [{ line: 1, column: 1 }],
            message: `Could not resolve to a Repository with the name '${fullName}'.`,
          },
        ],
      })
    }
    const store = this.store(fullName)
    const out: Record<string, unknown> = {}
    const objRe = /(\w+)\s*:\s*object\s*\(\s*oid\s*:\s*("[^"]*"|\$\w+)\s*\)\s*\{\s*\.\.\.\s*on\s+Blob\s*\{([^}]*)\}\s*\}/g
    for (const m of body.query.matchAll(objRe)) {
      const [, alias, oidRaw, fieldList] = m
      const data = store.blob(arg(oidRaw))
      if (!data) {
        out[alias] = null
        continue
      }
      const binary = isBinary(data)
      const truncated = !binary && data.length > this.graphqlTextLimit
      const all: Record<string, unknown> = {
        oid: arg(oidRaw),
        byteSize: data.length,
        isBinary: binary,
        isTruncated: truncated,
        text: binary ? null : new TextDecoder('utf-8', { ignoreBOM: true }).decode(truncated ? data.subarray(0, this.graphqlTextLimit) : data),
      }
      const fields = fieldList.split(/[\s,]+/).filter(Boolean)
      out[alias] = Object.fromEntries(fields.map((f) => [f, all[f] ?? null]))
    }
    return this.json(200, { data: { repository: out } })
  }
}
