// @vitest-environment happy-dom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeGitHub } from '../../../test/fake-github'
import { GitHubClient } from '../../lib/github/client'
import { publishLinkGist } from '../../lib/link/gist'
import { NotesDB, setDb } from '../../lib/store/db'
import type { Workspace } from '../../lib/types'
import { CodeLinkScreen } from './CodeLinkScreen'
import { LinkDeviceDialog } from './LinkDeviceDialog'

const TOKEN = 'github_pat_11SOURCE_token_value_0123456789'
const workspace: Workspace = {
  owner: 'me',
  repo: 'notes',
  branch: 'main',
  token: TOKEN,
  tokenExpiresOn: null,
  login: 'me',
  linkedAt: '2026-10-22T00:00:00Z',
}

let gh: FakeGitHub
const createClient = (token: string) => new GitHubClient({ token, fetch: gh.fetch })
let n = 0

beforeEach(() => {
  setDb(new NotesDB(`code-link-test-${n++}`))
  gh = new FakeGitHub()
  gh.addToken(TOKEN, { login: 'me', gists: true })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('linking by typing a code (LINK-5)', () => {
  it('the new device links under StrictMode (mounted twice)', async () => {
    await publishLinkGist(createClient(TOKEN), { o: 'me', r: 'notes', b: 'main', t: TOKEN, e: null }, 'K7QM2XPA9H')
    const onLinked = vi.fn()
    render(
      <StrictMode>
        <CodeLinkScreen createClient={createClient} onCancel={() => undefined} onLinked={onLinked} retryDelaysMs={[]} />
      </StrictMode>,
    )
    fireEvent.change(screen.getByLabelText('GitHub 帳號'), { target: { value: 'me' } })
    fireEvent.change(screen.getByLabelText('配對碼第 1 碼'), { target: { value: 'k7qm2xpa9h' } })
    await waitFor(() => expect(onLinked).toHaveBeenCalledTimes(1), { timeout: 15_000 })
    expect(onLinked.mock.calls[0][0]).toMatchObject({ o: 'me', r: 'notes', t: TOKEN, e: null })
    // The new device took the gist away.
    await waitFor(() => expect(gh.gistsOf('me')).toHaveLength(0))
  }, 30_000)

  it('an expired code offers a new one; the source shows the login GitHub filed the gist under', async () => {
    render(<LinkDeviceDialog open onClose={() => undefined} workspace={{ ...workspace, login: 'old-name' }} createClient={createClient} />)
    fireEvent.click(screen.getByRole('button', { name: '新裝置沒有相機？改用配對碼' }))
    await waitFor(() => expect(document.querySelector('.code-account')?.textContent).toBe('me'), { timeout: 15_000 })
    expect(gh.gistsOf('me')).toHaveLength(1)
    // Five minutes later the code is gone, and so is the gist.
    const later = Date.now() + 301_000
    vi.spyOn(Date, 'now').mockReturnValue(later)
    await waitFor(() => expect(screen.getByText('配對碼已失效。')).toBeTruthy())
    await waitFor(() => expect(gh.gistsOf('me')).toHaveLength(0))
    vi.restoreAllMocks()
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '重新產生' })[0])
    })
    await waitFor(() => expect(document.querySelector('.code-account')?.textContent).toBe('me'), { timeout: 15_000 })
    expect(gh.gistsOf('me')).toHaveLength(1)
  }, 30_000)
})
