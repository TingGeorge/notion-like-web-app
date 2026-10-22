/**
 * Dev-only harness for the setup and link screens: `npm run dev` → /dev/setup.html
 *
 * Query parameters:
 *   theme=dark|light      force a theme
 *   ios=1                 pretend to be iOS Safari (shows M16 first)
 *   standalone=1          with ios=1: pretend to be the home-screen app
 *   frame=phone           draw safe areas like an iPhone (status bar 54 px, home indicator 34 px)
 *   view=link             show LinkDeviceDialog instead of the flow
 *   freeze=<n>            first sync stops at n files downloaded and never finishes
 *   mock=1                mock the Safari toolbar on M16
 * Hash: `#/setup/<step>` as in the app.
 *
 * Tokens: anything containing `bad` is rejected with 401. Repos: see FakeClient.
 */
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/styles/global.css'
import { GitHubClient, GitHubError, type GitHubUser, type RepoSummary, type WriteProbe } from '../src/lib/github/client'
import type { LinkCrypto, SetupDeps } from '../src/app/setup/deps'
import { SetupFlow, type SetupStep } from '../src/app/setup/SetupFlow'
import { LinkDeviceDialog } from '../src/app/link/LinkDeviceDialog'
import { InvalidPayloadError, WrongPairingCodeError } from '../src/lib/link/crypto'
import type { Workspace } from '../src/lib/types'

const params = new URLSearchParams(location.search)
const theme = params.get('theme')
if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme
if (params.get('frame') === 'phone') {
  document.documentElement.style.setProperty('--sat', '54px')
  document.documentElement.style.setProperty('--sab', '34px')
}

const repo = (name: string, over: Partial<RepoSummary> = {}): RepoSummary => ({
  owner: 'TingGeorge',
  name,
  fullName: `TingGeorge/${name}`,
  private: true,
  defaultBranch: 'main',
  size: 10,
  pushedAt: null,
  description: null,
  ...over,
})

const REPOS = [
  repo('github-note-app-db', { size: 0 }),
  repo('my-notes'),
  repo('blog', { private: false }),
  repo('no-access'),
]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

class FakeClient extends GitHubClient {
  getUser(): Promise<GitHubUser> {
    return sleep(300).then(() => {
      if (this.options.token.includes('bad')) throw new GitHubError('unauthorized', 401, 'Bad credentials')
      return { login: 'TingGeorge', name: 'Ting', avatarUrl: null }
    })
  }
  listRepos() {
    return sleep(200).then(() => REPOS)
  }
  getRepo(_o: string, name: string) {
    return Promise.resolve(REPOS.find((r) => r.name === name) ?? REPOS[0])
  }
  probeWrite(_o: string, name: string): Promise<WriteProbe> {
    return sleep(300).then(() => (name === 'no-access' ? 'no-access' : name === 'github-note-app-db' ? 'empty' : 'ok'))
  }
  createFile(_o: string, _r: string, path: string) {
    ;(window as unknown as { __created?: string[] }).__created = [path]
    return sleep(200)
  }
  countPages(_o: string, name: string) {
    return sleep(400).then(() => (name === 'my-notes' ? 12 : name === 'blog' ? 7 : 3))
  }
}

const GOOD_CODE = 'K7QM2XPA'
const PAYLOAD = 'ghnotes:1:mockSalt.mockIv.mockCipher'
const mockCrypto: LinkCrypto = {
  generatePairingCode: (length = GOOD_CODE.length) => `${GOOD_CODE}9H`.slice(0, length),
  encryptLinkPayload: async (data, code) => `ghnotes:1:${btoa(JSON.stringify({ ...data, c: code })).replace(/=/g, '')}`,
  decryptLinkPayload: async (payload, code) => {
    await sleep(150)
    if (!payload.startsWith('ghnotes:1:')) throw new InvalidPayloadError()
    if (code !== GOOD_CODE) throw new WrongPairingCodeError()
    return { o: 'TingGeorge', r: 'github-note-app-db', b: 'main', t: 'github_pat_11ABCDEFG0harness', e: '2027-01-10' }
  },
}

const freeze = params.get('freeze')

const deps: SetupDeps = {
  createClient: (token) => new FakeClient({ token }),
  onWorkspaceReady: async (ws: Workspace) => {
    ;(window as unknown as { __workspace?: Omit<Workspace, 'token'> }).__workspace = { ...ws, token: '[hidden]' }
    await sleep(100)
  },
  runInitialSync: async (onProgress) => {
    onProgress({ phase: 'list', done: 0, total: 0 })
    await sleep(300)
    const total = 214
    if (freeze) {
      onProgress({ phase: 'download', done: Number(freeze), total })
      return new Promise<void>(() => {})
    }
    for (let i = 0; i <= total; i += 14) {
      onProgress({ phase: 'download', done: Math.min(i, total), total })
      await sleep(80)
    }
    onProgress({ phase: 'download', done: total, total })
    onProgress({ phase: 'index', done: total, total })
    await sleep(500)
  },
  onFinished: () => {
    document.title = 'finished'
  },
  isIOS: params.get('ios') === '1',
  isStandalone: params.get('standalone') === '1',
  acceptSafariTab: () => {
    document.title = 'safari-accepted'
  },
  today: () => new Date(2026, 9, 12),
  linkCrypto: mockCrypto,
  welcomePage: '# 歡迎使用\n',
}

const WORKSPACE: Workspace = {
  owner: 'TingGeorge',
  repo: 'github-note-app-db',
  branch: 'main',
  token: 'github_pat_11ABCDEFG0harness',
  tokenExpiresOn: '2027-01-10',
  login: 'TingGeorge',
  linkedAt: '2026-10-12T00:00:00.000Z',
}

function Harness() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  if (params.get('view') === 'link') {
    return <LinkDeviceDialog open onClose={() => (document.title = 'closed')} workspace={WORKSPACE} linkCrypto={mockCrypto} />
  }
  const step = /^#\/setup\/([\w-]+)/.exec(hash)?.[1] ?? null
  return (
    <SetupFlow
      step={step}
      navigate={(s: SetupStep) => {
        location.hash = `#/setup/${s}`
      }}
      deps={deps}
      mockSafariToolbar={params.get('mock') === '1'}
    />
  )
}

;(window as unknown as { __payload: string }).__payload = PAYLOAD

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
)
