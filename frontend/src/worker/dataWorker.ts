/// <reference lib="webworker" />

type Columns = {
    years: Int8Array; comp: Int32Array;
    name: string[]; title: string[]; location: string[]; skills: string[];
  }
  
  let cols: Columns
  let indices: Uint32Array
  
  self.onmessage = (e: MessageEvent<any>) => {
    const { type } = e.data
    if (type === 'init') {
      cols = e.data.columns as Columns
      indices = new Uint32Array(e.data.sab)
      for (let i = 0; i < indices.length; i++) indices[i] = i
      ;(self as any).postMessage({ type: 'ready', count: indices.length })
      return
    }
    if (type === 'query') {
      const { q, minExp, location, sort } = e.data as
        { q?: string; minExp?: number; location?: string; sort?: 'comp'|'years'|'name'|'-comp'|'-years'|'-name' }
  
      // filter into indices in-place
      let n = 0
      const qi = q?.toLowerCase()
      for (let i=0; i<cols.years.length; i++) {
        if (minExp!=null && cols.years[i] < minExp) continue
        if (location && cols.location[i] !== location) continue
        if (qi) {
          const hit =
            cols.name[i].toLowerCase().includes(qi) ||
            cols.title[i].toLowerCase().includes(qi) ||
            cols.location[i].toLowerCase().includes(qi) ||
            cols.skills[i].toLowerCase().includes(qi)
          if (!hit) continue
        }
        indices[n++] = i
      }
      // sort a view of the filtered indices
      const view = indices.subarray(0, n)
      if (sort) {
        const desc = sort.startsWith('-')
        const key = desc ? sort.slice(1) : sort
        const cmp = (a:number,b:number) => {
          switch (key) {
            case 'comp': return cols.comp[a]-cols.comp[b]
            case 'years': return cols.years[a]-cols.years[b]
            case 'name': return cols.name[a].localeCompare(cols.name[b])
            default: return 0
          }
        }
        view.sort((a,b)=> desc ? -cmp(a,b) : cmp(a,b))
      }
      ;(self as any).postMessage({ type: 'result', count: n })
    }
  }
  