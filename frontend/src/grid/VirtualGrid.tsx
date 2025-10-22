import { useEffect, useRef, useState, type ReactNode } from 'react'

type Props = {
  rowCount: number
  rowHeight: number
  overscan?: number
  getRow: (index: number) => ReactNode
}

export default function VirtualGrid({ rowCount, rowHeight, getRow, overscan = 8 }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = () => setScrollTop(el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(rowCount, Math.ceil((scrollTop + vh) / rowHeight) + overscan)

  const items: ReactNode[] = []
  for (let i = start; i < end; i++) {
    items.push(
      <div
        key={i}
        style={{ position: 'absolute', top: i * rowHeight, height: rowHeight, left: 0, right: 0 }}
      >
        {getRow(i)}
      </div>
    )
  }

  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        height: '100vh',
        overflow: 'auto',
        contain: 'strict' as any, // quiet overly strict TS CSS typings
      }}
    >
      <div style={{ height: rowCount * rowHeight, position: 'relative' }}>{items}</div>
    </div>
  )
}
