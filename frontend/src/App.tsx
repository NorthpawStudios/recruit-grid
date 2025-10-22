import { useEffect, useRef, useState } from 'react'
import { fetchArrow, columns } from './arrow'
import VirtualGrid from './grid/VirtualGrid'
import workerUrl from './worker/dataWorker?worker&url'

type SortKey = 'comp' | 'years' | 'name' | '-comp' | '-years' | '-name'
type Query = { q?: string; minExp?: number; location?: string; sort?: SortKey }

export default function App() {
  const [ready, setReady] = useState(false)
  const [count, setCount] = useState(0)
  const [query, setQuery] = useState<Query>({})

  const colsRef = useRef<Record<string, unknown> | null>(null)
  const indicesRef = useRef<Uint32Array | null>(null)
  const workerRef = useRef<Worker | null>(null)


  // initial load: fetch Arrow -> prep columns -> init worker
  useEffect(() => {
    (async () => {
      const table = await fetchArrow('http://localhost:8000/candidates.arrow')
      const cols = columns(table)
      colsRef.current = {
        years: cols.years,
        comp: cols.comp,
        name: Array.from({ length: table.numRows }, (_, i) => cols.name.get(i)?.toString() ?? ''),
        title: Array.from({ length: table.numRows }, (_, i) => cols.title.get(i)?.toString() ?? ''),
        location: Array.from({ length: table.numRows }, (_, i) => cols.location.get(i)?.toString() ?? ''),
        skills: Array.from({ length: table.numRows }, (_, i) => cols.skills.get(i)?.toString() ?? ''),
      }
      const sab = new SharedArrayBuffer(Uint32Array.BYTES_PER_ELEMENT * table.numRows)
      indicesRef.current = new Uint32Array(sab)

      const worker = new Worker(workerUrl, { type: 'module' })
      workerRef.current = worker
      worker.onmessage = (e: MessageEvent<any>) => {
        if (e.data.type === 'ready') { setReady(true); setCount(e.data.count) }
        if (e.data.type === 'result') { setCount(e.data.count) }
      }
      worker.postMessage({ type: 'init', columns: colsRef.current, sab })
    })()
  }, [])

  // send queries to worker (debounced slightly)
  useEffect(() => {
    const w = workerRef.current
    if (!w) return
    const id = setTimeout(() => w.postMessage({ type: 'query', ...query }), 60)
    return () => clearTimeout(id)
  }, [query])
  

  const getRow = (visibleIndex: number) => {
    if (!indicesRef.current || !colsRef.current) return null
    const rowId = indicesRef.current[visibleIndex]
    const c = colsRef.current as any
    return (
      <div className="grid-row">
        <div><strong>{c.name[rowId]}</strong></div>
        <div>{c.title[rowId]}</div>
        <div>{c.location[rowId]}</div>
        <div>{c.years[rowId]} yrs</div>
        <div>£{c.comp[rowId].toLocaleString()}</div>
        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.skills[rowId]}</div>
      </div>
    )
    
  }
  

  return (
    <div style={{ fontFamily: 'ui-sans-serif, system-ui' }}>
      <header style={{ padding: 12, display: 'flex', gap: 8, borderBottom: '1px solid #eee' }}>
        <input
          placeholder="Search name/title/location/skills…"
          style={{ flex: 1 }}
          onChange={e => setQuery(q => ({ ...q, q: e.target.value }))}
        />
        <select onChange={e => setQuery(q => ({ ...q, location: e.target.value || undefined }))}>
          <option value="">Any location</option>
          {['Remote', 'London', 'San Francisco', 'New York', 'Berlin', 'Bangalore', 'Toronto', 'Sydney', 'Dublin']
            .map(x => <option key={x}>{x}</option>)}
        </select>
        <select onChange={e => setQuery(q => ({ ...q, sort: e.target.value as SortKey }))}>
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
        <span style={{ alignSelf: 'center', opacity: 0.7 }}>{count.toLocaleString()} matches</span>
      </header>

      {ready && <VirtualGrid rowCount={count} rowHeight={44} getRow={getRow} />}
    </div>
  )
}
