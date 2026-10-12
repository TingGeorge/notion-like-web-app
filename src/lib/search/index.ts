/**
 * Full-text search (UI-9, NFR-1): MiniSearch with Chinese word segmentation.
 *
 * CONTRACT — implemented in this folder.
 */

export interface SearchDoc {
  key: string
  title: string
  path: string
  headings: string[]
  body: string
  /** ms since epoch. */
  updatedAt: number
}

export interface SearchOptions {
  titleOnly?: boolean
  sort?: 'relevance' | 'recent'
  /** Only pages edited after this time (ms since epoch). */
  since?: number | null
  limit?: number
}

export interface SearchResult {
  key: string
  title: string
  path: string
  updatedAt: number
  /** Where the best match is: title first, then headings, then body (UI-9 ranking). */
  matchedIn: 'title' | 'heading' | 'body'
  /** Short text around the match, with the match ranges to show in medium weight. */
  snippet: { text: string; highlights: [number, number][] }
  /** Ranges in the title to highlight. */
  titleHighlights: [number, number][]
  score: number
}

const notImplemented = (name: string): never => {
  throw new Error(`search: ${name} is not implemented yet`)
}

export class SearchIndex {
  /** Create an empty index, or load one serialised with `toJSON`. */
  static create(_json?: string | null): SearchIndex {
    return notImplemented('SearchIndex.create')
  }

  /** Add or replace a page. */
  upsert(_doc: SearchDoc): void {
    notImplemented('upsert')
  }

  remove(_key: string): void {
    notImplemented('remove')
  }

  has(_key: string): boolean {
    return notImplemented('has')
  }

  get size(): number {
    return notImplemented('size')
  }

  search(_query: string, _options?: SearchOptions): SearchResult[] {
    return notImplemented('search')
  }

  toJSON(): string {
    return notImplemented('toJSON')
  }
}
