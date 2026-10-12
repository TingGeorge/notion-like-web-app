/**
 * GitHub REST + GraphQL client (ARCH-3, SYNC-5, SYNC-8, SYNC-13, SETUP-6 to SETUP-9).
 *
 * CONTRACT — the setup screens and the sync engine use this class. All requests go to
 * `https://api.github.com` (or `baseUrl` in tests) with the token only in the Authorization
 * header (SEC-2). Errors are thrown as `GitHubError`.
 */
import type { SyncErrorKind, TreeItem } from '../types'

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

export interface GitHubClientOptions {
  token: string
  /** Injected in tests to use the fake GitHub. */
  fetch?: typeof fetch
  baseUrl?: string
}

export interface RateLimitInfo {
  remaining: number | null
  /** ms since epoch. */
  resetAt: number | null
}

const notImplemented = (name: string): never => {
  throw new Error(`github: ${name} is not implemented yet`)
}

export class GitHubClient {
  constructor(public readonly options: GitHubClientOptions) {}

  /** Last `x-ratelimit-*` values seen (SYNC-13). */
  rateLimit: RateLimitInfo = { remaining: null, resetAt: null }

  /** SETUP-6 step 1. 401 → GitHubError kind `unauthorized`. */
  getUser(): Promise<GitHubUser> {
    return notImplemented('getUser')
  }

  /** SETUP-6 step 2: `GET /user/repos?per_page=100&sort=updated`, all pages. */
  listRepos(): Promise<RepoSummary[]> {
    return notImplemented('listRepos')
  }

  getRepo(_owner: string, _repo: string): Promise<RepoSummary> {
    return notImplemented('getRepo')
  }

  /** SETUP-8: write probe with `POST /git/blobs`. 201 → ok, 409 → empty, 403/404 → no-access. */
  probeWrite(_owner: string, _repo: string): Promise<WriteProbe> {
    return notImplemented('probeWrite')
  }

  /** SETUP-9: `PUT /repos/{o}/{r}/contents/{path}` to create the first commit of an empty repo. */
  createFile(_owner: string, _repo: string, _path: string, _text: string, _message: string): Promise<void> {
    return notImplemented('createFile')
  }

  /** Number of page files (DATA-2) on a branch, for the repo list (D13). null if unknown. */
  countPages(_owner: string, _repo: string, _branch: string): Promise<number | null> {
    return notImplemented('countPages')
  }

  /** SYNC-15: commits touching a path, newest first, 30 per page (page starts at 1). */
  listCommits(_owner: string, _repo: string, _path: string, _page: number): Promise<CommitSummary[]> {
    return notImplemented('listCommits')
  }

  /** SYNC-15: a file's text at a commit (`Accept: application/vnd.github.raw`). */
  getFileAt(_owner: string, _repo: string, _path: string, _ref: string): Promise<string> {
    return notImplemented('getFileAt')
  }

  /** An attachment's bytes at the branch head (for `_assets/…`, SEC-5). */
  getFileBlob(_owner: string, _repo: string, _path: string, _ref: string): Promise<Blob> {
    return notImplemented('getFileBlob')
  }
}

export type { TreeItem }
