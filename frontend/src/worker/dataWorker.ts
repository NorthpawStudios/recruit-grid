/// <reference lib="webworker" />

import * as arrow from 'apache-arrow'
import { buildTextIndex, makeNeedle, matchRowsBitmap, rowMatches, type TextIndex, type Utf8Vectorish } from './textIndex'
import { numericSortKeys, radixArgsort, stringSortKeys } from './sortIndex'

export type SortKey = 'comp' | 'years' | 'name' | '-comp' | '-years' | '-name'
export type QueryMessage = {
  type: 'query'
  q?: string
  minExp?: number
  location?: string
  sort?: SortKey
}
export type InitMessage = { type: 'init'; buffer: ArrayBuffer; sab: SharedArrayBuffer }
export type WorkerMessage = InitMessage | QueryMessage

/** Worker -> main. `offset` is where in the shared buffer this result lives. */
export type ResultMessage = {
  type: 'ready' | 'result'
  count: number
  offset: number
  version: number
  ms: number
}

type Loaded = {
  rowCount: number
  years: Int8Array
  comp: Int32Array
  location: string[]
  text: TextIndex
  nameAt: (i: number) => string
}

type Narrowable = {
  q: string
  minExp: number
  location?: string
  sort?: SortKey
  rows: Uint32Array
  n: number
}

let data: Loaded | null = null
/** Double-buffered result indices: the worker fills one half while the main thread reads the other. */
let shared: Uint32Array | null = null
let half = 0
let version = 0
let previous: Narrowable | null = null

const sortOrders = new Map<'comp' | 'years' | 'name', Uint32Array>()
/** Scratch buffer for the result being built, so `previous` never aliases the shared buffer. */
let scratch: Uint32Array | null = null

function load(buffer: ArrayBuffer): Loaded {
  const table = arrow.tableFromIPC(new Uint8Array(buffer))
  const rowCount = table.numRows
  const nameVec = table.getChild('name')!

  const text = buildTextIndex(
    [nameVec, table.getChild('title')!, table.getChild('location')!, table.getChild('skills')!] as unknown as Utf8Vectorish[],
    rowCount,
  )

  // `location` is compared by equality, not substring, so keep it as strings.
  // It is a tiny dictionary, so this stays cheap even at 250k rows.
  const locationVec = table.getChild('location')!
  const location = new Array<string>(rowCount)
  for (let i = 0; i < rowCount; i++) location[i] = locationVec.get(i)?.toString() ?? ''

  return {
    rowCount,
    years: table.getChild('years_exp')!.toArray() as Int8Array,
    comp: table.getChild('comp')!.toArray() as Int32Array,
    location,
    text,
    nameAt: (i: number) => nameVec.get(i)?.toString() ?? '',
  }
}

/** Row order for a sort key, built once on first use. */
function orderFor(key: 'comp' | 'years' | 'name'): Uint32Array {
  const cached = sortOrders.get(key)
  if (cached) return cached
  const d = data!
  const keys =
    key === 'comp'
      ? numericSortKeys(d.comp, d.rowCount)
      : key === 'years'
        ? numericSortKeys(d.years, d.rowCount)
        : stringSortKeys(d.nameAt, d.rowCount)
  const order = radixArgsort(keys)
  sortOrders.set(key, order)
  return order
}

/**
 * True when every row matching the new query must already be in `prev`'s
 * result, so we can rescan that (much smaller) set instead of all rows.
 * Requires an unchanged sort, since we rely on `prev.rows` already being ordered.
 */
function canNarrow(prev: Narrowable, q: string, minExp: number, location: string | undefined, sort?: SortKey) {
  if (prev.sort !== sort) return false
  if (prev.location != null && prev.location !== location) return false
  if (minExp < prev.minExp) return false
  return q.startsWith(prev.q)
}

function runQuery(msg: QueryMessage): ResultMessage {
  const started = performance.now()
  const d = data!
  const { rowCount, years, location: locations, text } = d
  const q = msg.q ?? ''
  const minExp = msg.minExp ?? Number.NEGATIVE_INFINITY
  const location = msg.location
  const sort = msg.sort

  const needle = q ? makeNeedle(q) : null
  const out = scratch!

  const narrow = previous && canNarrow(previous, q, minExp, location, sort) ? previous : null

  let source: Uint32Array | null = null
  let sourceLength: number
  let descending = false
  if (narrow) {
    source = narrow.rows
    sourceLength = narrow.n
  } else if (sort) {
    descending = sort.charCodeAt(0) === 45 /* '-' */
    source = orderFor((descending ? sort.slice(1) : sort) as 'comp' | 'years' | 'name')
    sourceLength = rowCount
  } else {
    sourceLength = rowCount
  }

  // Full scans use one Boyer–Moore pass over the whole text blob (fast skip
  // loop, no per-row overhead); narrowed rescans test just their few rows.
  const textBitmap = needle !== null && narrow === null ? matchRowsBitmap(text, needle) : null

  let n = 0
  for (let k = 0; k < sourceLength; k++) {
    // Unsorted, unnarrowed scans walk rows directly; otherwise follow the order.
    const i = source === null ? k : source[descending ? sourceLength - 1 - k : k]
    if (years[i] < minExp) continue
    if (location !== undefined && locations[i] !== location) continue
    if (textBitmap !== null ? textBitmap[i] === 0 : needle !== null && !rowMatches(text, i, needle)) continue
    out[n++] = i
  }

  const result = out.slice(0, n)
  previous = { q, minExp, location, sort, rows: result, n }

  const offset = half * rowCount
  shared!.set(result, offset)
  half ^= 1

  return { type: 'result', count: n, offset, version: ++version, ms: performance.now() - started }
}

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data
  if (msg.type === 'init') {
    const started = performance.now()
    data = load(msg.buffer)
    shared = new Uint32Array(msg.sab)
    scratch = new Uint32Array(data.rowCount)

    const rows = new Uint32Array(data.rowCount)
    for (let i = 0; i < rows.length; i++) rows[i] = i
    shared.set(rows, 0)
    half = 1
    previous = { q: '', minExp: Number.NEGATIVE_INFINITY, location: undefined, sort: undefined, rows, n: rows.length }

    const ready: ResultMessage = {
      type: 'ready',
      count: data.rowCount,
      offset: 0,
      version: ++version,
      ms: performance.now() - started,
    }
    ;(self as DedicatedWorkerGlobalScope).postMessage(ready)
    return
  }

  if (msg.type === 'query' && data) {
    ;(self as DedicatedWorkerGlobalScope).postMessage(runQuery(msg))
  }
}
