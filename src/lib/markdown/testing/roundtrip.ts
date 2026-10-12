/**
 * DATA-16 round-trip properties on seeded random documents (see `randomDoc.ts`), shared by the
 * `roundtrip.part{1,2,3}.test.ts` files (split so that vitest runs them in parallel):
 *  1. parse(serialize(doc)) equals canonicalize(doc)
 *  2. canonicalize is idempotent (and its result is schema-valid)
 *  3. serialize(parse(md)) === md for md written by serialize
 *  4. the body format: LF only, exactly one trailing newline, '' for the empty document
 *
 * Environment: MD_FUZZ_ITERATIONS (per part), MD_FUZZ_SEED (offset) for longer local runs.
 */
import type { Node as PMNode } from 'prosemirror-model'
import { canonicalize, parseMarkdown, serializeMarkdown } from '../index'
import { firstDifference } from './diff'
import { randomDoc } from './randomDoc'

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}

export const FUZZ_ITERATIONS = Number(env.MD_FUZZ_ITERATIONS ?? 600)
export const FUZZ_SEED = Number(env.MD_FUZZ_SEED ?? 0)

function describeFailure(seed: number, back: PMNode, canon: PMNode): string {
  const where = firstDifference(canon, back) ?? ''
  // The Markdown of the first differing top-level block.
  const index = Number(/^doc\/(\d+)/.exec(where)?.[1] ?? -1)
  const blockMd = index >= 0 && index < canon.childCount ? serializeMarkdown(canon.type.create(null, canon.child(index))) : ''
  return [`seed ${seed}`, `block markdown: ${JSON.stringify(blockMd)}`, `first difference at ${where}`].join('\n')
}

/** Check all properties for one seed; throws a readable error on failure. */
export function checkRoundTrip(seed: number): void {
  const doc = randomDoc(seed, { maxBlocks: 5 })
  doc.check()
  const canon = canonicalize(doc)
  canon.check()
  if (!canonicalize(canon).eq(canon)) {
    throw new Error(`canonicalize is not idempotent\nseed ${seed}\n${firstDifference(canon, canonicalize(canon))}`)
  }
  const md = serializeMarkdown(doc)
  const back = parseMarkdown(md)
  if (!back.eq(canon)) throw new Error(describeFailure(seed, back, canon))
  // serialize is a function of the document, so (3) follows from (1); check it on a sample.
  if (seed % 4 === 0) {
    const again = serializeMarkdown(back)
    if (again !== md) throw new Error(`serialize(parse(md)) !== md\nseed ${seed}\n${JSON.stringify(md)}\n${JSON.stringify(again)}`)
  }
  if (md.includes('\r')) throw new Error(`CR in output, seed ${seed}`)
  if (md !== '' && (!md.endsWith('\n') || md.endsWith('\n\n'))) throw new Error(`bad trailing newline, seed ${seed}`)
  if (md === '' && !(canon.childCount === 1 && canon.child(0).type.name === 'paragraph' && canon.child(0).content.size === 0)) {
    throw new Error(`empty output for a non-empty document, seed ${seed}`)
  }
}
