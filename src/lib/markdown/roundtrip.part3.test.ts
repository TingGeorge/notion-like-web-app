/** DATA-16 round trip on random documents, part 3 of 3 (see `testing/roundtrip.ts`). */
import { describe, it } from 'vitest'
import { checkRoundTrip, FUZZ_ITERATIONS, FUZZ_SEED } from './testing/roundtrip'

describe('DATA-16 round trip (random documents)', () => {
  it(`holds for ${FUZZ_ITERATIONS} seeded documents (part 3)`, () => {
    const first = FUZZ_SEED + (3 - 1) * FUZZ_ITERATIONS + 1
    for (let seed = first; seed < first + FUZZ_ITERATIONS; seed++) checkRoundTrip(seed)
  }, 600_000)
})
