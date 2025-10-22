import * as arrow from 'apache-arrow'

// 👇 Base API URL – switches automatically based on environment
const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export async function fetchArrow(urlPath: string): Promise<arrow.Table> {
  // Prefix the path with API base
  const res = await fetch(`${API}${urlPath}`, { credentials: 'omit' })
  const buf = await res.arrayBuffer()
  return arrow.tableFromIPC(new Uint8Array(buf))
}

export function columns(table: arrow.Table) {
  return {
    id: table.getChild('id')!.toArray() as Int32Array,
    name: table.getChild('name')!,
    title: table.getChild('title')!,
    location: table.getChild('location')!,
    years: table.getChild('years_exp')!.toArray() as Int8Array,
    skills: table.getChild('skills')!,
    comp: table.getChild('comp')!.toArray() as Int32Array,
    last: table.getChild('last_active')!,
  }
}
