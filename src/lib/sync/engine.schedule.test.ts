/**
 * Scheduling and status: SYNC-4 (pull triggers), SYNC-7 (push timer and spacing), SYNC-11 (status),
 * SYNC-12 (back-off), SYNC-13 (rate limits), STORE-6 / SYNC-3 (lock + flush).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { GitHubClient } from '../github/client'
import type { FakeGitHub } from '../../../test/fake-github'
import { t } from '../../strings/zh-TW'
import { SyncEngine } from './engine'
import { Device, FULL, ManualClock, TOKEN, makeGitHub, type DeviceOptions } from './testHarness'

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.close()
})

async function setup(opts: DeviceOptions = {}, files?: Record<string, string>) {
  const clock = new ManualClock()
  const gh = await makeGitHub(files ?? { 'a.md': 'a\n', 'b.md': 'b\n' }, { now: clock.now })
  const d = new Device(gh, 'A', { clock, ...opts })
  devices.push(d)
  await d.engine.pull()
  return { clock, gh, d, e: d.engine }
}

const pushes = (gh: FakeGitHub) => gh.count('PATCH', /\/git\/refs\//)
const pulls = (gh: FakeGitHub) => gh.count('GET', /\/git\/ref\/heads\//)

describe('SYNC-7 push timer', () => {
  it('pushes 5 s after the last edit', async () => {
    const { clock, gh, d, e } = await setup()
    await d.edit('a.md', 'a1\n')
    e.notifyLocalChange()
    await clock.advance(3000, e)
    await d.edit('a.md', 'a2\n')
    e.notifyLocalChange()
    await clock.advance(4900, e)
    expect(pushes(gh)).toBe(0)
    await clock.advance(100, e)
    expect(pushes(gh)).toBe(1)
    expect(await gh.readFile(FULL, 'a.md')).toBe('a2\n')
  })

  it('pushes at most once every 30 s', async () => {
    const { clock, gh, d, e } = await setup()
    await d.edit('a.md', 'a1\n')
    e.notifyLocalChange()
    await clock.advance(5000, e)
    expect(pushes(gh)).toBe(1)
    await d.edit('a.md', 'a2\n')
    e.notifyLocalChange()
    // The first push started at t=5 s, so the next one waits until t=35 s, not t=10 s.
    await clock.advance(29_000, e)
    expect(pushes(gh)).toBe(1)
    await clock.advance(1000, e)
    expect(pushes(gh)).toBe(2)
  })

  it('ignores the spacing in Safari tab mode (SETUP-13)', async () => {
    const { clock, gh, d, e } = await setup({ safariTabMode: true })
    await d.edit('a.md', 'a1\n')
    e.notifyLocalChange()
    await clock.advance(5000, e)
    await d.edit('a.md', 'a2\n')
    e.notifyLocalChange()
    await clock.advance(5000, e)
    expect(pushes(gh)).toBe(2)
  })

  it('pushes right away when leaving a page or hiding the app, ignoring the spacing', async () => {
    const { clock, gh, d, e } = await setup()
    await d.edit('a.md', 'a1\n')
    e.notifyLocalChange()
    await clock.advance(5000, e)
    await d.edit('a.md', 'a2\n')
    e.notifyLocalChange()
    e.pushSoon()
    await e.idle()
    expect(pushes(gh)).toBe(2)
    // Nothing dirty: no request at all.
    const before = gh.requests.length
    e.pushSoon()
    await e.idle()
    expect(gh.requests.length).toBe(before)
    // The cancelled timer does not push again.
    await clock.advance(60_000, e)
    expect(pushes(gh)).toBe(2)
  })

  it('makes no automatic pushes with 「自動同步」 off; pulls continue; 「立即同步」 pushes', async () => {
    const { clock, gh, d, e } = await setup()
    await d.db.config.put({ key: 'ui', value: { theme: 'system', sidebarWidth: 240, sidebarCollapsed: false, expanded: [], recent: [], lastColor: null, autoSync: false } })
    e.start()
    await e.idle()
    await d.edit('a.md', 'local\n')
    e.notifyLocalChange()
    e.pushSoon()
    await gh.commit(FULL, { files: { 'b.md': 'b remote\n' } })
    await clock.advance(61_000, e)
    expect(pushes(gh)).toBe(0)
    expect(await d.text('b.md')).toBe('b remote\n')
    expect(await e.getStatus()).toEqual({ state: 'pending', pending: 1 })
    await e.syncNow()
    expect(pushes(gh)).toBe(1)
    expect(await gh.readFile(FULL, 'a.md')).toBe('local\n')
  })
})

describe('SYNC-4 pull triggers', () => {
  it('pulls at start, every 60 s while visible, and when the window becomes visible', async () => {
    let visible = true
    const { clock, gh, e } = await setup({ isVisible: () => visible })
    const base = pulls(gh)
    e.start()
    await e.idle()
    expect(pulls(gh)).toBe(base + 1)
    await clock.advance(60_000, e)
    expect(pulls(gh)).toBe(base + 2)
    visible = false
    e.handleVisibilityChange(false)
    await clock.advance(180_000, e)
    expect(pulls(gh)).toBe(base + 2)
    visible = true
    e.handleVisibilityChange(true)
    await e.idle()
    expect(pulls(gh)).toBe(base + 3)
    await clock.advance(60_000, e)
    expect(pulls(gh)).toBe(base + 4)
    e.stop()
    await clock.advance(600_000, e)
    expect(pulls(gh)).toBe(base + 4)
  })

  it('pushes edits left from an earlier session at start', async () => {
    const { gh, d, e } = await setup()
    await d.edit('a.md', 'from yesterday\n')
    e.start()
    await e.idle()
    expect(await gh.readFile(FULL, 'a.md')).toBe('from yesterday\n')
  })

  it('flushes the editors while holding the sync lock (SYNC-3, STORE-6)', async () => {
    const events: string[] = []
    let held = false
    const locks = {
      request: (async (name: string, cb: () => Promise<unknown>) => {
        events.push(`lock:${name}`)
        held = true
        try {
          return await cb()
        } finally {
          held = false
        }
      }) as unknown as LockManager['request'],
    }
    const { d, e } = await setup({
      locks,
      flushEditors: async () => {
        events.push(held ? 'flush:locked' : 'flush:unlocked')
      },
    })
    events.length = 0
    await d.edit('a.md', 'x\n')
    await e.push()
    expect(events).toEqual(['lock:sync', 'flush:locked'])
  })
})

describe('SYNC-12 / SYNC-13 retries', () => {
  it('backs off on network errors (5 s → 5 min) and retries at once when online', async () => {
    const { clock, gh, d, e } = await setup()
    await d.edit('a.md', 'a1\n')
    gh.offline = true
    e.notifyLocalChange()
    await clock.advance(5000, e)
    expect(clock.pending()).toContain(5000)
    expect(await e.getStatus()).toMatchObject({ state: 'error', error: { kind: 'network', message: t.sync.errors.network } })
    expect((await d.db.sync.get('state'))!.lastError!.retryAt).toBe(clock.time + 5000)
    await clock.advance(5000, e)
    expect(clock.pending()).toContain(10_000)
    await clock.advance(10_000, e)
    expect(clock.pending()).toContain(20_000)
    for (let i = 0; i < 10; i++) await clock.advance(Math.max(...clock.pending().filter((x) => x <= 300_000)), e)
    expect(clock.pending()).toContain(300_000)
    gh.offline = false
    e.handleOnline()
    await e.idle()
    expect(await gh.readFile(FULL, 'a.md')).toBe('a1\n')
    expect(await e.getStatus()).toEqual({ state: 'synced' })
  })

  it('waits for retry-after on a secondary rate limit', async () => {
    const { clock, gh, d, e } = await setup()
    await d.edit('a.md', 'a1\n')
    gh.failNext({ kind: 'secondary', retryAfter: 42 })
    e.notifyLocalChange()
    await clock.advance(5000, e)
    expect(await e.getStatus()).toMatchObject({ state: 'error', error: { kind: 'rate-limited' } })
    await clock.advance(41_000, e)
    expect(pushes(gh)).toBe(0)
    await clock.advance(1000, e)
    expect(pushes(gh)).toBe(1)
  })

  it('waits 60 s, then backs off exponentially, without retry-after', async () => {
    const { clock, gh, d, e } = await setup()
    await d.edit('a.md', 'a1\n')
    gh.failNext({ kind: 'secondary', status: 429 }, { times: 2 })
    e.notifyLocalChange()
    await clock.advance(5000, e)
    expect(clock.pending()).toContain(60_000)
    await clock.advance(60_000, e)
    expect(clock.pending()).toContain(120_000)
    await clock.advance(120_000, e)
    expect(pushes(gh)).toBe(1)
  })

  it('stops polling below 200 remaining requests until the reset', async () => {
    const { clock, gh, e } = await setup()
    gh.setRateLimit(TOKEN, { remaining: 150, resetAt: clock.time + 10 * 60_000 })
    e.start()
    await e.idle()
    const base = pulls(gh)
    await clock.advance(5 * 60_000, e)
    expect(pulls(gh)).toBe(base)
    await clock.advance(6 * 60_000, e)
    expect(pulls(gh)).toBeGreaterThan(base)
  })

  it('401 stops automatic syncing until 「立即同步」 (SETUP-13)', async () => {
    const { clock, gh, d, e } = await setup()
    e.start()
    await e.idle()
    gh.revokeToken(TOKEN)
    await d.edit('a.md', 'kept\n')
    e.notifyLocalChange()
    await clock.advance(5000, e)
    const count = gh.requests.length
    await clock.advance(10 * 60_000, e)
    expect(gh.requests.length).toBe(count)
    expect(await e.getStatus()).toMatchObject({ state: 'error', error: { kind: 'unauthorized', message: t.sync.errors.unauthorized } })
    expect(await d.text('a.md')).toBe('kept\n')
  })
})

describe('SYNC-11 status', () => {
  it('synced / pending / syncing / offline / error', async () => {
    let online = true
    const { gh, d, e } = await setup({ isOnline: () => online })
    expect(await e.getStatus()).toEqual({ state: 'synced' })
    await d.edit('a.md', 'a1\n')
    await d.move('b.md', 'c.md')
    expect(await e.getStatus()).toEqual({ state: 'pending', pending: 2 })
    let during: unknown = null
    const off = gh.onRequest(async (r) => {
      if (r.method === 'PATCH') {
        during = await e.getStatus()
        // Another tab on the same database sees it too.
        const other = new SyncEngine({ ...e.options, client: new GitHubClient({ token: TOKEN, fetch: gh.fetch }) })
        expect(await other.getStatus()).toEqual({ state: 'syncing' })
      }
    })
    await e.push()
    off()
    expect(during).toEqual({ state: 'syncing' })
    expect(await e.getStatus()).toEqual({ state: 'synced' })
    online = false
    await d.edit('a.md', 'a2\n')
    expect(await e.getStatus()).toEqual({ state: 'offline', pending: 1 })
    online = true
    gh.failNext({ kind: 'server', status: 503 })
    await e.syncNow()
    expect(await e.getStatus()).toMatchObject({ state: 'error', error: { kind: 'server', message: t.sync.errors.server } })
    await e.syncNow()
    expect(await e.getStatus()).toEqual({ state: 'synced' })
  })
})

describe('SYNC-14 limits', () => {
  it('warns for a page over 1 MB', async () => {
    const big = 'x'.repeat(1024 * 1024 + 10)
    const { gh, d } = await setup()
    await gh.commit(FULL, { files: { 'big.md': big } })
    await d.engine.pull()
    expect(d.notices).toEqual([t.sync.pageTooLarge])
  })
})
