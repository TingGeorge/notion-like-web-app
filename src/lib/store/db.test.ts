import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { NotesDB, withBytes } from './db'

let n = 0
let open: Dexie[] = []
afterEach(async () => {
  for (const d of open) d.close()
  open = []
})

function fresh() {
  const name = `db-test-${n++}`
  const db = new NotesDB(name)
  const raw = new Dexie(name)
  raw.version(1).stores({ uploads: 'path', assets: 'path, lastUsed' })
  open.push(db, raw)
  return { db, raw }
}

const bytes = (b: Blob) => b.arrayBuffer().then((a) => [...new Uint8Array(a)])

describe('attachment rows (WebKit private windows cannot store Blobs)', () => {
  it('are stored as bytes and read back as Blobs with their type', async () => {
    const { db, raw } = fresh()
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    await db.uploads.put(await withBytes({ path: '_assets/a.png', blob, sha256: 'x', createdAt: 1 }))
    await db.assets.put(await withBytes({ path: '_assets/a.png', blob, size: 3, lastUsed: 1 }))

    const stored = (await raw.table('uploads').get('_assets/a.png')) as { blob: unknown; type: string }
    expect(stored.blob).toBeInstanceOf(ArrayBuffer)
    expect(stored.type).toBe('image/png')

    const upload = (await db.uploads.get('_assets/a.png'))!
    expect(upload.blob).toBeInstanceOf(Blob)
    expect(upload.blob.type).toBe('image/png')
    expect(await bytes(upload.blob)).toEqual([1, 2, 3])
    expect('type' in upload).toBe(false)
    expect((await db.uploads.toArray())[0].blob).toBeInstanceOf(Blob)
    expect((await db.assets.orderBy('lastUsed').toArray())[0].blob).toBeInstanceOf(Blob)
  })

  it('keep their bytes through update()', async () => {
    const { db, raw } = fresh()
    await db.assets.put(await withBytes({ path: 'p', blob: new Blob([new Uint8Array([9])]), size: 1, lastUsed: 1 }))
    await db.assets.update('p', { lastUsed: 2 })
    expect(((await raw.table('assets').get('p')) as { blob: unknown }).blob).toBeInstanceOf(ArrayBuffer)
    expect(await bytes((await db.assets.get('p'))!.blob)).toEqual([9])
  })

  it('written as Blobs by earlier versions still read', async () => {
    const { db } = fresh()
    await db.uploads.put({ path: 'old', blob: new Blob([new Uint8Array([7])]), sha256: 'y', createdAt: 1 })
    expect(await bytes((await db.uploads.get('old'))!.blob)).toEqual([7])
  })
})
