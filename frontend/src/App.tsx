import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchArrowBuffer } from './arrow'
import VirtualGrid from './grid/VirtualGrid'
import DataWorker from './worker/dataWorker?worker'
import type { ResultMessage, SortKey } from './worker/dataWorker'
import * as arrow from 'apache-arrow'

type Query = { q?: string; minExp?: number; location?: string; sort?: SortKey }

/** Display columns, decoded lazily per visible row straight from Arrow buffers. */
type DisplayCols = {
  name: arrow.Vector
  title: arrow.Vector
  location: arrow.Vector
  skills: arrow.Vector
  years: Int8Array
  comp: Int32Array
}

export default function App() {
  const [ready, setReady] = useState(false)
  const [count, setCount] = useState(0)
  const [queryMs, setQueryMs] = useState<number | null>(null)
  const [query, setQuery] = useState<Query>({})

  const colsRef = useRef<DisplayCols | null>(null)
  const indicesRef = useRef<Uint32Array | null>(null)
  const offsetRef = useRef(0)
  const workerRef = useRef<Worker | null>(null)
  const latestVersion = useRef(0)

  // initial load: fetch Arrow once, parse on the main thread for display,
  // and hand the same bytes to the worker (transferred, not copied).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const buffer = await fetchArrowBuffer('/candidates.arrow')
      if (cancelled) return

      // Parse for display. Arrow vectors decode strings on demand, so this is
      // cheap: no upfront materialization of 1.5M strings.
      const table = arrow.tableFromIPC(new Uint8Array(buffer.slice(0)))
      colsRef.current = {
        name: table.getChild('name')!,
        title: table.getChild('title')!,
        location: table.getChild('location')!,
        skills: table.getChild('skills')!,
        years: table.getChild('years_exp')!.toArray() as Int8Array,
        comp: table.getChild('comp')!.toArray() as Int32Array,
      }

      // Double-buffered: worker writes one half while we read the other.
      const sab = new SharedArrayBuffer(Uint32Array.BYTES_PER_ELEMENT * table.numRows * 2)
      indicesRef.current = new Uint32Array(sab)

      const worker = new DataWorker()
      workerRef.current = worker
      worker.onmessage = (e: MessageEvent<ResultMessage>) => {
        const msg = e.data
        if (msg.version < latestVersion.current) return // stale result
        latestVersion.current = msg.version
        offsetRef.current = msg.offset
        setCount(msg.count)
        setQueryMs(msg.type === 'result' ? msg.ms : null)
        if (msg.type === 'ready') setReady(true)
      }
      worker.postMessage({ type: 'init', buffer, sab }, [buffer])
    })()
    return () => {
      cancelled = true
      workerRef.current?.terminate()
    }
  }, [])

  // send queries to worker (debounced slightly)
  useEffect(() => {
    const w = workerRef.current
    if (!w) return
    const id = setTimeout(() => w.postMessage({ type: 'query', ...query }), 60)
    return () => clearTimeout(id)
  }, [query])

  const getRow = useCallback((visibleIndex: number) => {
    const indices = indicesRef.current
    const c = colsRef.current
    if (!indices || !c) return null
    const rowId = indices[offsetRef.current + visibleIndex]
    return (
      <div className="grid-row">
        <div><strong>{c.name.get(rowId)}</strong></div>
        <div>{c.title.get(rowId)}</div>
        <div>{c.location.get(rowId)}</div>
        <div>{c.years[rowId]} yrs</div>
        <div>£{c.comp[rowId].toLocaleString()}</div>
        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.skills.get(rowId)}</div>
      </div>
    )
  }, [])

  return (
    <div style={{ fontFamily: 'ui-sans-serif, system-ui' }}>
      <header style={{ padding: 12, display: 'flex', gap: 8, borderBottom: '1px solid #eee' }}>
        <input
          placeholder="Search name/title/location/skills…"
          style={{ flex: 1 }}
          onChange={e => setQuery(q => ({ ...q, q: e.target.value || undefined }))}
        />
        <select onChange={e => setQuery(q => ({ ...q, location: e.target.value || undefined }))}>
          <option value="">Any location</option>
          {['Remote', 'London', 'San Francisco', 'New York', 'Berlin', 'Bangalore', 'Toronto', 'Sydney', 'Dublin']
            .map(x => <option key={x}>{x}</option>)}
        </select>
        <select onChange={e => setQuery(q => ({ ...q, sort: (e.target.value || undefined) as SortKey | undefined }))}>
          <option value="">Sort</option>
          <option value="-comp">Comp (desc)</option>
          <option value="comp">Comp (asc)</option>
          <option value="-years">Years (desc)</option>
          <option value="years">Years (asc)</option>
          <option value="name">Name (A→Z)</option>
          <option value="-name">Name (Z→A)</option>
        </select>
        <input
          type="number"
          placeholder="Min years"
          onChange={e => setQuery(q => ({ ...q, minExp: e.target.value ? Number(e.target.value) : undefined }))}
          style={{ width: 120 }}
        />
        <span style={{ alignSelf: 'center', opacity: 0.7 }}>
          {count.toLocaleString()} matches{queryMs != null ? ` · ${queryMs < 1 ? '<1' : Math.round(queryMs)} ms` : ''}
        </span>
      </header>

      {ready && <VirtualGrid rowCount={count} rowHeight={44} getRow={getRow} />}
    </div>
  )
}
