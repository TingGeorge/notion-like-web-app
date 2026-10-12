/**
 * A real (if small) git object store for the fake GitHub (TEST-2): blobs, trees and commits are
 * stored under their real git SHA-1, computed with WebCrypto over the canonical git encoding.
 * No Node-only APIs, so the same code runs in Vitest and in the browser (Playwright `page.route`).
 */

const encoder = new TextEncoder()

export type Bytes = Uint8Array<ArrayBuffer>

export interface Signature {
  name: string
  email: string
  /** ISO 8601, UTC. */
  date: string
}

export type EntryType = 'blob' | 'tree' | 'commit'

export interface TreeEntry {
  name: string
  /** API form: `100644`, `100755`, `120000`, `160000`, `040000`. */
  mode: string
  type: EntryType
  sha: string
}

export interface CommitObject {
  type: 'commit'
  tree: string
  parents: string[]
  message: string
  author: Signature
  committer: Signature
}

export type GitObject = { type: 'blob'; data: Bytes } | { type: 'tree'; entries: TreeEntry[] } | CommitObject

export interface FlatEntry {
  path: string
  mode: string
  type: EntryType
  sha: string
  size?: number
}

/** One change for `applyChanges` (the `tree` array of `POST /git/trees`, already resolved to SHAs). */
export interface TreeChange {
  path: string
  mode: string
  type: EntryType
  /** null deletes the path. */
  sha: string | null
}

/** Thrown by `applyChanges`; the server turns it into a 422. */
export class TreeError extends Error {}

export function utf8(text: string): Bytes {
  return encoder.encode(text)
}

export function concatBytes(parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}

function hexToBytes(hex: string): Bytes {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export async function sha1Hex(bytes: Bytes): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-1', bytes))
}

/** `sha1("<type> <len>\0" + body)`, exactly as git computes object ids. */
export async function hashObject(type: EntryType, body: Bytes): Promise<string> {
  return sha1Hex(concatBytes([utf8(`${type} ${body.length}\0`), body]))
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return a.length - b.length
}

/** git sorts tree entries by name bytes, with trees compared as if their name ended in `/`. */
function sortEntries(entries: TreeEntry[]): TreeEntry[] {
  const key = (e: TreeEntry) => utf8(e.type === 'tree' ? `${e.name}/` : e.name)
  return [...entries].sort((a, b) => compareBytes(key(a), key(b)))
}

function encodeTree(entries: TreeEntry[]): Bytes {
  const parts: Uint8Array[] = []
  for (const e of sortEntries(entries)) {
    // git writes tree modes without the leading zero.
    const mode = e.mode === '040000' ? '40000' : e.mode
    parts.push(utf8(`${mode} ${e.name}\0`), hexToBytes(e.sha))
  }
  return concatBytes(parts)
}

function encodeSignature(s: Signature): string {
  const seconds = Math.floor(Date.parse(s.date) / 1000)
  return `${s.name} <${s.email}> ${seconds} +0000`
}

function encodeCommit(c: CommitObject): Bytes {
  const lines = [`tree ${c.tree}`, ...c.parents.map((p) => `parent ${p}`)]
  lines.push(`author ${encodeSignature(c.author)}`, `committer ${encodeSignature(c.committer)}`)
  return utf8(`${lines.join('\n')}\n\n${c.message}`)
}

const VALID_SEGMENT = /^(?!\.{1,2}$)[^/\0]+$/

interface MutableEntry {
  mode: string
  type: EntryType
  sha: string | null
  node?: MutableNode
}

interface MutableNode {
  entries: Map<string, MutableEntry>
  dirty: boolean
}

export class ObjectStore {
  private objects = new Map<string, GitObject>()

  has(sha: string): boolean {
    return this.objects.has(sha)
  }

  get(sha: string): GitObject | undefined {
    return this.objects.get(sha)
  }

  blob(sha: string): Bytes | null {
    const o = this.objects.get(sha)
    return o?.type === 'blob' ? o.data : null
  }

  tree(sha: string): TreeEntry[] | null {
    const o = this.objects.get(sha)
    return o?.type === 'tree' ? o.entries : null
  }

  commit(sha: string): CommitObject | null {
    const o = this.objects.get(sha)
    return o?.type === 'commit' ? o : null
  }

  async writeBlob(data: Bytes): Promise<string> {
    const sha = await hashObject('blob', data)
    if (!this.objects.has(sha)) this.objects.set(sha, { type: 'blob', data: data.slice() })
    return sha
  }

  async writeTree(entries: TreeEntry[]): Promise<string> {
    const sorted = sortEntries(entries)
    const sha = await hashObject('tree', encodeTree(sorted))
    if (!this.objects.has(sha)) this.objects.set(sha, { type: 'tree', entries: sorted })
    return sha
  }

  async writeCommit(c: Omit<CommitObject, 'type'>): Promise<string> {
    const commit: CommitObject = { type: 'commit', ...c }
    const sha = await hashObject('commit', encodeCommit(commit))
    if (!this.objects.has(sha)) this.objects.set(sha, commit)
    return sha
  }

  /** Every entry below a tree, depth first, with full paths (trees included). */
  walk(treeSha: string, prefix = ''): FlatEntry[] {
    const out: FlatEntry[] = []
    for (const e of this.tree(treeSha) ?? []) {
      const path = prefix ? `${prefix}/${e.name}` : e.name
      if (e.type === 'blob') out.push({ path, mode: e.mode, type: e.type, sha: e.sha, size: this.blob(e.sha)?.length ?? 0 })
      else out.push({ path, mode: e.mode, type: e.type, sha: e.sha })
      if (e.type === 'tree') out.push(...this.walk(e.sha, path))
    }
    return out
  }

  /** The entry at `path` inside a tree, or null. */
  entryAt(treeSha: string, path: string): TreeEntry | null {
    if (path === '') return { name: '', mode: '040000', type: 'tree', sha: treeSha }
    let entries = this.tree(treeSha)
    const parts = path.split('/')
    for (let i = 0; i < parts.length; i++) {
      const e = entries?.find((x) => x.name === parts[i])
      if (!e) return null
      if (i === parts.length - 1) return e
      if (e.type !== 'tree') return null
      entries = this.tree(e.sha)
    }
    return null
  }

  /** True when `ancestor` is `sha` or reachable from it through parents. */
  isAncestor(ancestor: string, sha: string): boolean {
    const seen = new Set<string>()
    const stack = [sha]
    while (stack.length > 0) {
      const s = stack.pop()!
      if (s === ancestor) return true
      if (seen.has(s)) continue
      seen.add(s)
      stack.push(...(this.commit(s)?.parents ?? []))
    }
    return false
  }

  private load(treeSha: string | null): MutableNode {
    const entries = new Map<string, MutableEntry>()
    for (const e of treeSha ? (this.tree(treeSha) ?? []) : []) entries.set(e.name, { mode: e.mode, type: e.type, sha: e.sha })
    return { entries, dirty: false }
  }

  /**
   * `POST /git/trees` semantics: start from `baseTree` (or nothing) and apply the changes in
   * order. Deleting a path that does not exist throws, like GitHub. Folders left empty disappear.
   */
  async applyChanges(baseTree: string | null, changes: TreeChange[]): Promise<string> {
    const root = this.load(baseTree)
    for (const change of changes) {
      const parts = change.path.split('/')
      if (change.path === '' || !parts.every((p) => VALID_SEGMENT.test(p))) {
        throw new TreeError(`tree.path contains a malformed path component`)
      }
      if (change.sha !== null) {
        const obj = this.get(change.sha)
        const okType = change.type === 'commit' || obj?.type === change.type
        if (!okType) throw new TreeError(`tree.sha ${change.sha} is not a valid ${change.type}`)
      }
      let node = root
      const trail: MutableNode[] = [root]
      for (const part of parts.slice(0, -1)) {
        let entry = node.entries.get(part)
        if (!entry || entry.type !== 'tree') {
          if (change.sha === null) throw new TreeError('GitRPC::BadObjectState')
          entry = { mode: '040000', type: 'tree', sha: null, node: { entries: new Map(), dirty: true } }
          node.entries.set(part, entry)
        }
        entry.node ??= this.load(entry.sha)
        node = entry.node
        trail.push(node)
      }
      const name = parts[parts.length - 1]
      if (change.sha === null) {
        if (!node.entries.has(name)) throw new TreeError('GitRPC::BadObjectState')
        node.entries.delete(name)
      } else {
        node.entries.set(name, { mode: change.mode, type: change.type, sha: change.sha })
      }
      for (const n of trail) n.dirty = true
    }
    const sha = await this.writeNode(root)
    return sha ?? (await this.writeTree([]))
  }

  /** Writes a modified node bottom-up; returns null for an empty folder. */
  private async writeNode(node: MutableNode): Promise<string | null> {
    const entries: TreeEntry[] = []
    for (const [name, e] of node.entries) {
      let sha = e.sha
      if (e.node && e.node.dirty) sha = await this.writeNode(e.node)
      if (sha === null) continue
      if (e.type === 'tree' && (this.tree(sha)?.length ?? 0) === 0) continue
      entries.push({ name, mode: e.mode, type: e.type, sha })
    }
    if (entries.length === 0) return null
    return this.writeTree(entries)
  }
}
