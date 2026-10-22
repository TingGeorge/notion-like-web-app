/**
 * Dependencies the app shell injects into the setup screens, plus the shared "activate a repo" logic
 * (SETUP-8, SETUP-9). Nothing in here touches the DOM.
 */
import type { GitHubClient, GitHubUser } from '../../lib/github/client'
import { GitHubError } from '../../lib/github/client'
import type { InitialSyncProgress } from '../../lib/sync/engine'
import type { LinkData } from '../../lib/link/crypto'
import type { Workspace } from '../../lib/types'
import { WELCOME_PAGE_PATH } from '../../lib/data/templates'
import { t } from '../../strings'

/** The parts of `src/lib/link/crypto.ts` the screens call; injectable so tests and the harness can fake them. */
export interface LinkCrypto {
  generatePairingCode(length?: number): string
  encryptLinkPayload(data: LinkData, code: string): Promise<string>
  decryptLinkPayload(payload: string, code: string): Promise<LinkData>
}

export interface SetupDeps {
  /** Builds a client for a token. The token is only ever passed here and to `onWorkspaceReady`. */
  createClient(token: string): GitHubClient
  /** Persist the workspace (STORE-1 `config.workspace`). Called once the write probe succeeded. */
  onWorkspaceReady(ws: Workspace): Promise<void>
  /** SETUP-10: first full download. Must report progress through `onProgress`; rejects on failure. */
  runInitialSync(onProgress: (p: InitialSyncProgress) => void): Promise<void>
  /** 「開始使用」: leave setup and show the main UI. */
  onFinished(): void
  /** Running on iOS (iPhone/iPad). */
  isIOS: boolean
  /** `navigator.standalone === true` or display-mode standalone. */
  isStandalone: boolean
  /** SETUP-2 「仍要在 Safari 使用」: remember the choice (`UiPrefs.safariTabModeAccepted`). */
  acceptSafariTab(): void
  /** True when the choice above was already made on an earlier visit. Default false. */
  safariTabAccepted?: boolean
  today(): Date
  /** Markdown of 歡迎使用.md written to an empty repo (SETUP-9). Defaults to a short placeholder. */
  welcomePage?: string
  /** Name for 「設定只會存在這台 …」 on the scan screen. Defaults to iPhone on iOS, 裝置 otherwise. */
  deviceName?: string
  /** Defaults to the real `src/lib/link/crypto.ts`. */
  linkCrypto?: LinkCrypto
  /** Defaults to `() => new Date()`; used for `linkedAt`. */
  now?(): Date
  /** SETUP-12 更換 repo: a token already in use; setup starts at choosing a repo. */
  resume?: { token: string; tokenExpiresOn: string | null } | null
}

/** Placeholder until `WELCOME_PAGE` from `src/lib/data/templates.ts` is available. */
export const WELCOME_PLACEHOLDER = '# 歡迎使用\n\n這是你的第一頁。開始輸入，筆記會同步到你的 GitHub。\n'

export const WELCOME_PATH = WELCOME_PAGE_PATH

export interface RepoTarget {
  owner: string
  name: string
  defaultBranch: string
  private: boolean
}

export type ActivateResult = { ok: true; workspace: Workspace } | { ok: false; reason: 'no-access' }

/**
 * SETUP-8 / SETUP-9: probe write access, initialise an empty repo, build the Workspace.
 * Network failures are thrown as GitHubError for the caller to display.
 */
export async function activateRepo(opts: {
  client: GitHubClient
  repo: RepoTarget
  token: string
  tokenExpiresOn: string | null
  user: GitHubUser
  welcomePage: string
  now: Date
}): Promise<ActivateResult> {
  const { client, repo } = opts
  const probe = await client.probeWrite(repo.owner, repo.name)
  if (probe === 'no-access') return { ok: false, reason: 'no-access' }
  if (probe === 'empty') {
    try {
      await client.createFile(repo.owner, repo.name, WELCOME_PATH, opts.welcomePage, t.commit.welcome)
    } catch (e) {
      if (e instanceof GitHubError && (e.kind === 'forbidden' || e.kind === 'not-found')) {
        return { ok: false, reason: 'no-access' }
      }
      throw e
    }
  }
  return {
    ok: true,
    workspace: {
      owner: repo.owner,
      repo: repo.name,
      branch: repo.defaultBranch,
      token: opts.token,
      tokenExpiresOn: opts.tokenExpiresOn,
      login: opts.user.login,
      name: opts.user.name,
      linkedAt: opts.now.toISOString(),
      private: repo.private,
    },
  }
}

/** A user-facing message for a failed call. Never includes the raw error text (SEC-2). */
export function errorMessage(e: unknown): string {
  if (e instanceof GitHubError) return t.sync.errors[e.kind] ?? t.sync.errors.unknown
  if (e instanceof TypeError) return t.sync.errors.network
  return t.sync.errors.unknown
}
