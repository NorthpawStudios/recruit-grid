import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

type Props = {
  rowCount: number
  rowHeight: number
  overscan?: number
  getRow: (index: number) => ReactNode
}

export default function VirtualGrid({ rowCount, rowHeight, getRow, overscan = 8 }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(800)

  // Coalesce scroll events to one state update per frame.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setScrollTop(el.scrollTop)
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  // Measure the scroller itself instead of assuming window.innerHeight.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(entries => setViewportHeight(entries[0].contentRect.height))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(rowCount, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan)

  // Key rows by their slot (index modulo pool size) so scrolling reuses the
  // same DOM nodes instead of unmounting/remounting them every frame.
  const poolSize = Math.ceil(viewportHeight / rowHeight) + overscan * 2 + 1
  const items: ReactNode[] = []
  for (let i = start; i < end; i++) {
    items.push(
      <div
        key={i % poolSize}
        style={{
          position: 'absolute',
          transform: `translateY(${i * rowHeight}px)`,
          height: rowHeight,
          left: 0,
          right: 0,
        }}
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
        contain: 'strict',
      }}
    >
      <div style={{ height: rowCount * rowHeight, position: 'relative', overflow: 'hidden' }}>{items}</div>
    </div>
  )
}
