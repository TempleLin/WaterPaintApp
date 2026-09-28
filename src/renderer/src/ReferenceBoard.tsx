import { useEffect, useRef, useState } from 'react'
import { Minus, Pipette, Plus, X } from 'lucide-react'

export interface ReferenceImage { url: string; name: string }
export function ReferenceBoard({ reference, onClose, onColor }: { reference: ReferenceImage; onClose: () => void; onColor: (color: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const board = useRef<HTMLElement>(null), drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null), [collapsed, setCollapsed] = useState(false)
  const [colors, setColors] = useState<string[]>([]), [picking, setPicking] = useState(false)
  const [error, setError] = useState('')
  const place = (x: number, y: number) => {
    const el = board.current!, parent = el.parentElement!
    setPosition({ x: Math.max(8, Math.min(parent.clientWidth - el.offsetWidth - 8, x)), y: Math.max(8, Math.min(parent.clientHeight - el.offsetHeight - 55, y)) })
  }
  useEffect(() => {
    const el = board.current!, observer = new ResizeObserver(() => {
      setPosition(p => p ? { x: Math.max(8, Math.min(el.parentElement!.clientWidth - el.offsetWidth - 8, p.x)), y: Math.max(8, Math.min(el.parentElement!.clientHeight - el.offsetHeight - 55, p.y)) } : p)
    })
    observer.observe(el.parentElement!); observer.observe(el)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let canceled = false
    const image = new Image()
    image.onload = () => {
      if (canceled || !canvas.current) return
      const target = canvas.current, scale = Math.min(1, 640 / Math.max(image.width, image.height))
      target.width = Math.max(1, Math.round(image.width * scale)); target.height = Math.max(1, Math.round(image.height * scale))
      const ctx = target.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(image, 0, 0, target.width, target.height)
      const data = ctx.getImageData(0, 0, target.width, target.height).data, buckets = new Map<string, { count: number; rgb: number[] }>()
      for (let i = 0; i < data.length; i += 16) {
        if (data[i + 3] < 128) continue
        const rgb = Array.from(data.slice(i, i + 3)), key = rgb.map(v => Math.floor(v / 32)).join(',')
        const bucket = buckets.get(key) ?? { count: 0, rgb: [0, 0, 0] }; bucket.count++; rgb.forEach((v, c) => bucket.rgb[c] += v); buckets.set(key, bucket)
      }
      const selected: number[][] = []
      for (const bucket of [...buckets.values()].sort((a, b) => b.count - a.count)) {
        const rgb = bucket.rgb.map(v => Math.round(v / bucket.count))
        if (selected.every(c => Math.hypot(...c.map((v, i) => v - rgb[i])) > 55)) selected.push(rgb)
        if (selected.length === 6) break
      }
      setColors(selected.map(rgb => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('')))
    }
    image.onerror = () => { if (!canceled) setError('This reference image could not be read.') }
    image.src = reference.url
    return () => { canceled = true }
  }, [reference.url])
  return <aside ref={board} className="reference-board" style={position ? { left: position.x, top: position.y, right: 'auto' } : undefined} aria-label="Reference board" onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
    <div className="reference-heading"><button className="reference-drag" aria-label="Move reference board" title="Drag to move; arrow keys when focused" onPointerDown={e => {
      if (e.button !== 0) return
      const r = board.current!.getBoundingClientRect(), p = board.current!.parentElement!.getBoundingClientRect()
      drag.current = { x: e.clientX, y: e.clientY, left: r.left - p.left, top: r.top - p.top }; e.currentTarget.setPointerCapture(e.pointerId)
    }} onPointerMove={e => { if (drag.current) place(drag.current.left + e.clientX - drag.current.x, drag.current.top + e.clientY - drag.current.y) }} onPointerUp={e => { drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId) }} onPointerCancel={() => drag.current = null} onLostPointerCapture={() => drag.current = null} onKeyDown={e => {
      const offsets: Record<string, number[]> = { ArrowLeft: [-10,0], ArrowRight: [10,0], ArrowUp: [0,-10], ArrowDown: [0,10] }
      if (!offsets[e.key]) return
      e.preventDefault(); e.stopPropagation(); const r = board.current!.getBoundingClientRect(), p = board.current!.parentElement!.getBoundingClientRect()
      place(r.left - p.left + offsets[e.key][0], r.top - p.top + offsets[e.key][1])
    }}>REFERENCE</button><div><button aria-label="Pick color from reference" aria-pressed={picking} className={picking ? 'active' : ''} onClick={() => { setPicking(!picking); setCollapsed(false) }}><Pipette size={15} /></button><button aria-label={collapsed ? 'Expand reference' : 'Minimize reference'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <Plus size={15} /> : <Minus size={15} />}</button><button aria-label="Close reference" onClick={onClose}><X size={15} /></button></div></div>
    <div hidden={collapsed}><canvas ref={canvas} aria-label="Reference image; enable color picker then click to sample" style={{ cursor: picking ? 'crosshair' : 'default' }} onClick={e => {
      if (!picking) return
      const c = canvas.current!, rect = c.getBoundingClientRect()
      const x = Math.min(c.width - 1, Math.max(0, Math.floor((e.clientX - rect.left) / rect.width * c.width))), y = Math.min(c.height - 1, Math.max(0, Math.floor((e.clientY - rect.top) / rect.height * c.height)))
      const pixel = c.getContext('2d')!.getImageData(x, y, 1, 1).data
      if (pixel[3]) onColor('#' + Array.from(pixel.slice(0, 3)).map(v => v.toString(16).padStart(2, '0')).join(''))
    }} />
    {error && <p role="alert">{error}</p>}<p title={reference.name}>{picking ? 'Click the reference to pick a pigment.' : reference.name}</p>
    <div className="reference-colors">{colors.map(color => <button key={color} aria-label={`Reference pigment ${color}`} title={`Use ${color}`} style={{ background: color }} onClick={() => onColor(color)} />)}</div>
    <small>For inspiration · never included in exports</small></div>
  </aside>
}
