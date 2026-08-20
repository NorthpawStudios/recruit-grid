/**
 * Byte-level text index for the candidate grid.
 *
 * The naive approach (`row.name.toLowerCase().includes(q) || ...`) allocates a
 * fresh lowercase JS string for every field of every row on *every keystroke* —
 * ~1M allocations per query at 250k rows. Instead we pay once, up front:
 *
 *   - concatenate the searchable fields of each row into one contiguous
 *     `Uint8Array` (separated by NUL so matches can't span two fields),
 *   - lowercase it in place,
 *   - keep an `Int32Array` of row start offsets.
 *
 * Querying is then a NUL-free needle scan over bytes: no allocation, no
 * decoding, and one pass per row instead of four.
 */

/** A row-partitioned, lowercased UTF-8 blob. `offsets` has `rowCount + 1` entries. */
export type TextIndex = {
  bytes: Uint8Array
  offsets: Int32Array
  rowCount: number
}

/** Field separator. Never appears in a needle, so matches cannot span fields. */
const SEP = 0x00

/** Minimal structural view of an Arrow Utf8 `Data` chunk. */
type Utf8Chunk = { values: Uint8Array; valueOffsets: Int32Array; length: number }

/** Minimal structural view of an Arrow Utf8 `Vector`. */
export type Utf8Vectorish = { data: readonly Utf8Chunk[] }

/** A single column's bytes flattened across Arrow chunks, with global offsets. */
type FlatColumn = { bytes: Uint8Array; offsets: Int32Array }

/**
 * Copy an Arrow Utf8 vector's chunked value buffers into one contiguous blob.
 * This reads the Arrow buffers directly rather than calling `vector.get(i)`,
 * so no strings are decoded.
 */
function flattenUtf8(vec: Utf8Vectorish, rowCount: number): FlatColumn {
  let total = 0
  for (const c of vec.data) {
    if (c.length > 0) total += c.valueOffsets[c.length] - c.valueOffsets[0]
  }

  const bytes = new Uint8Array(total)
  const offsets = new Int32Array(rowCount + 1)
  let row = 0
  let write = 0
  for (const c of vec.data) {
    const { values, valueOffsets, length } = c
    for (let j = 0; j < length; j++) {
      offsets[row++] = write
      // manual copy: strings are short, so this beats subarray()+set() churn
      for (let p = valueOffsets[j], end = valueOffsets[j + 1]; p < end; p++) bytes[write++] = values[p]
    }
  }
  // Rows past the chunk data (shouldn't happen, but keeps offsets monotonic).
  while (row <= rowCount) offsets[row++] = write
  return { bytes, offsets }
}

/** True when every byte is ASCII, i.e. byte-wise lowercasing is correct. */
function isAscii(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) if (bytes[i] >= 0x80) return false
  return true
}

/** Lowercase ASCII letters in place. */
function lowercaseAsciiInPlace(bytes: Uint8Array): void {
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    if (b >= 0x41 && b <= 0x5a) bytes[i] = b + 0x20
  }
}

/**
 * Build a searchable index over the given Utf8 columns.
 *
 * Pure-ASCII data (the common case) takes a fast path that never decodes a
 * string. Otherwise we fall back to decode → `toLowerCase()` → re-encode so
 * that locale-aware case folding stays correct; the query path is identical
 * either way.
 */
export function buildTextIndex(vectors: readonly Utf8Vectorish[], rowCount: number): TextIndex {
  const flat = vectors.map(v => flattenUtf8(v, rowCount))

  let total = 0
  for (const f of flat) total += f.bytes.length
  total += rowCount * Math.max(0, flat.length - 1) // separators

  const bytes = new Uint8Array(total)
  const offsets = new Int32Array(rowCount + 1)
  let write = 0
  for (let i = 0; i < rowCount; i++) {
    offsets[i] = write
    for (let c = 0; c < flat.length; c++) {
      if (c > 0) bytes[write++] = SEP
      const { bytes: src, offsets: off } = flat[c]
      for (let p = off[i], end = off[i + 1]; p < end; p++) bytes[write++] = src[p]
    }
  }
  offsets[rowCount] = write

  if (isAscii(bytes)) {
    lowercaseAsciiInPlace(bytes)
    return { bytes, offsets, rowCount }
  }
  return rebuildLowercased(bytes, offsets, rowCount)
}

/** Slow path for non-ASCII data: proper Unicode lowercasing, done once. */
function rebuildLowercased(bytes: Uint8Array, offsets: Int32Array, rowCount: number): TextIndex {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const rows: Uint8Array[] = new Array(rowCount)
  let total = 0
  for (let i = 0; i < rowCount; i++) {
    const lower = decoder.decode(bytes.subarray(offsets[i], offsets[i + 1])).toLowerCase()
    const encoded = encoder.encode(lower)
    rows[i] = encoded
    total += encoded.length
  }
  const out = new Uint8Array(total)
  const outOffsets = new Int32Array(rowCount + 1)
  let write = 0
  for (let i = 0; i < rowCount; i++) {
    outOffsets[i] = write
    out.set(rows[i], write)
    write += rows[i].length
  }
  outOffsets[rowCount] = write
  return { bytes: out, offsets: outOffsets, rowCount }
}

/** Lowercase and encode a user query into a needle for {@link rowMatches}. */
export function makeNeedle(query: string): Uint8Array {
  return new TextEncoder().encode(query.toLowerCase())
}

/** True if `needle` occurs anywhere in row `row` of `index`. */
export function rowMatches(index: TextIndex, row: number, needle: Uint8Array): boolean {
  const m = needle.length
  if (m === 0) return true
  const { bytes, offsets } = index
  const last = offsets[row + 1] - m
  const first = needle[0]
  outer: for (let i = offsets[row]; i <= last; i++) {
    if (bytes[i] !== first) continue
    for (let k = 1; k < m; k++) {
      if (bytes[i + k] !== needle[k]) continue outer
    }
    return true
  }
  return false
}

/**
 * Find every row containing `needle`, as a 0/1 bitmap indexed by row.
 *
 * Runs Boyer–Moore–Horspool over the *whole* blob in one pass rather than
 * per row: mismatches skip up to `needle.length` bytes at a time, and there is
 * no per-row loop overhead. The NUL field/row separators can't appear in a
 * needle, so a raw match can only ever span fields of a single row; we map the
 * hit position to its row by advancing a cursor (hits arrive in ascending
 * position order), then jump the scan to that row's end.
 */
export function matchRowsBitmap(index: TextIndex, needle: Uint8Array): Uint8Array {
  const { bytes, offsets, rowCount } = index
  const bitmap = new Uint8Array(rowCount)
  const m = needle.length
  if (m === 0) {
    bitmap.fill(1)
    return bitmap
  }

  if (m === 1) {
    // Single byte: BMH can't skip, so use a tight scan that jumps to the
    // next row boundary on a hit.
    const c = needle[0]
    const n = bytes.length
    let row = 0
    let i = 0
    while (i < n) {
      if (bytes[i] === c) {
        while (offsets[row + 1] <= i) row++
        bitmap[row] = 1
        i = offsets[++row]
      } else {
        i++
      }
    }
    return bitmap
  }

  // Bad-character skip table: distance from the last occurrence of each byte
  // in the needle to the needle's end.
  const skip = new Uint32Array(256).fill(m)
  for (let k = 0; k < m - 1; k++) skip[needle[k]] = m - 1 - k

  const last = needle[m - 1]
  const n = bytes.length
  let row = 0
  let i = m - 1
  while (i < n) {
    const b = bytes[i]
    if (b === last) {
      let k = m - 2
      let j = i - 1
      while (k >= 0 && bytes[j] === needle[k]) { k--; j-- }
      if (k < 0) {
        // hit at [j+1, i]; find its row and skip the rest of that row
        while (offsets[row + 1] <= j + 1) row++
        bitmap[row] = 1
        i = offsets[row + 1] + m - 1
        continue
      }
    }
    i += skip[b]
  }
  return bitmap
}
