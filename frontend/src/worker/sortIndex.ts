/**
 * Precomputed sort orders for the candidate grid.
 *
 * Sorting at query time costs O(n log n) comparisons *per keystroke*, and a
 * comparator that switches on a string key or calls `localeCompare` makes each
 * of those comparisons expensive. Instead we build one stable permutation per
 * sort key (lazily, once) with an O(n) radix sort, then walk that permutation
 * during filtering — so the filtered result comes out already sorted and query
 * time never pays for a sort at all.
 */

/** Stable LSD radix argsort over 32-bit keys. Returns row indices, ascending. */
export function radixArgsort(keys: Uint32Array): Uint32Array {
  const n = keys.length
  let src = new Uint32Array(n)
  for (let i = 0; i < n; i++) src[i] = i
  if (n < 2) return src

  let dst = new Uint32Array(n)
  const count = new Uint32Array(256)

  for (let shift = 0; shift < 32; shift += 8) {
    count.fill(0)
    for (let i = 0; i < n; i++) count[(keys[i] >>> shift) & 0xff]++

    // Every key shares this byte — the pass is the identity, skip the writes.
    if (count[(keys[src[0]] >>> shift) & 0xff] === n) continue

    let sum = 0
    for (let b = 0; b < 256; b++) {
      const c = count[b]
      count[b] = sum
      sum += c
    }
    for (let i = 0; i < n; i++) {
      const row = src[i]
      dst[count[(keys[row] >>> shift) & 0xff]++] = row
    }
    const swap = src
    src = dst
    dst = swap
  }
  return src
}

/** Map a signed 32-bit value onto a uint32 that sorts in the same order. */
export function signedToSortableUint32(v: number): number {
  return (v ^ 0x80000000) >>> 0
}

/** Build sortable uint32 keys from a signed integer column. */
export function numericSortKeys(values: ArrayLike<number>, rowCount: number): Uint32Array {
  const keys = new Uint32Array(rowCount)
  for (let i = 0; i < rowCount; i++) keys[i] = signedToSortableUint32(values[i])
  return keys
}

/**
 * Build sortable keys for a string column by collating only its *distinct*
 * values. Recruitment data is heavily repeated (names, titles, locations), so
 * this turns hundreds of thousands of `localeCompare` calls into a few hundred.
 */
export function stringSortKeys(get: (i: number) => string, rowCount: number): Uint32Array {
  const ids = new Uint32Array(rowCount)
  const seen = new Map<string, number>()
  const unique: string[] = []
  for (let i = 0; i < rowCount; i++) {
    const value = get(i)
    let id = seen.get(value)
    if (id === undefined) {
      id = unique.length
      seen.set(value, id)
      unique.push(value)
    }
    ids[i] = id
  }

  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
  const order = unique.map((_, i) => i).sort((a, b) => collator.compare(unique[a], unique[b]))
  const rank = new Uint32Array(unique.length)
  for (let r = 0; r < order.length; r++) rank[order[r]] = r

  const keys = new Uint32Array(rowCount)
  for (let i = 0; i < rowCount; i++) keys[i] = rank[ids[i]]
  return keys
}
