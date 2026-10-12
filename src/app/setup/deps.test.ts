import { describe, expect, it, vi } from 'vitest'
import { GitHubClient, GitHubError, type WriteProbe } from '../../lib/github/client'
import { activateRepo, errorMessage, WELCOME_PATH } from './deps'
import { parseExpiryText } from './token'

class Fake extends GitHubClient {
  created: unknown[][] = []
  constructor(
    private probe: WriteProbe,
    private createError?: Error,
  ) {
    super({ token: 'github_pat_secret' })
  }
  probeWrite = vi.fn(async () => this.probe)
  createFile = vi.fn(async (...args: unknown[]) => {
    this.created.push(args)
    if (this.createError) throw this.createError
  })
}

const base = {
  repo: { owner: 'o', name: 'r', defaultBranch: 'trunk', private: true },
  token: 'github_pat_secret',
  tokenExpiresOn: '2027-01-10',
  user: { login: 'ting', name: 'Ting', avatarUrl: null },
  welcomePage: '# hi',
  now: new Date('2026-10-12T00:00:00Z'),
}

describe('activateRepo (SETUP-8, SETUP-9)', () => {
  it('builds the workspace for a repo that passes the probe', async () => {
    const client = new Fake('ok')
    const res = await activateRepo({ ...base, client })
    expect(res).toEqual({
      ok: true,
      workspace: {
        owner: 'o',
        repo: 'r',
        branch: 'trunk',
        token: 'github_pat_secret',
        tokenExpiresOn: '2027-01-10',
        login: 'ting',
        name: 'Ting',
        linkedAt: '2026-10-12T00:00:00.000Z',
        private: true,
      },
    })
    expect(client.createFile).not.toHaveBeenCalled()
  })

  it('reports no-access', async () => {
    expect(await activateRepo({ ...base, client: new Fake('no-access') })).toEqual({ ok: false, reason: 'no-access' })
  })

  it('initialises an empty repo with the welcome page', async () => {
    const client = new Fake('empty')
    const res = await activateRepo({ ...base, client })
    expect(res.ok).toBe(true)
    expect(client.created[0].slice(0, 4)).toEqual(['o', 'r', WELCOME_PATH, '# hi'])
  })

  it('treats a forbidden first write as no-access', async () => {
    const client = new Fake('empty', new GitHubError('forbidden', 403, 'x'))
    expect(await activateRepo({ ...base, client })).toEqual({ ok: false, reason: 'no-access' })
  })
})

describe('errorMessage', () => {
  it('never contains the raw error text (SEC-2)', () => {
    expect(errorMessage(new GitHubError('network', 0, 'token github_pat_secret leaked'))).toBe('沒有網路連線')
    expect(errorMessage(new Error('github_pat_secret'))).not.toContain('github_pat_secret')
  })
})

describe('parseExpiryText', () => {
  it('accepts YYYY/MM/DD and friends', () => {
    expect(parseExpiryText('2027/01/10')).toBe('2027-01-10')
    expect(parseExpiryText(' 2027-1-5 ')).toBe('2027-01-05')
  })
  it('rejects nonsense', () => {
    expect(parseExpiryText('2027/13/10')).toBeNull()
    expect(parseExpiryText('soon')).toBeNull()
  })
})
