import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Studio } from './Studio'

export function ColorLoupe({ studio, point, canvas, stage }: { studio: Studio; point: { x: number; y: number }; canvas: RefObject<HTMLCanvasElement | null>; stage: RefObject<HTMLDivElement | null> }) {
  const preview = useRef<HTMLCanvasElement>(null), latest = useRef(point)
  latest.current = point
  const [color, setColor] = useState('…')
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout>
    const refresh = async (): Promise<void> => {
      try {
        const e = studio.engine, p = latest.current, x = Math.floor(p.x), y = Math.floor(p.y)
        if (x >= 0 && x < e.width && y >= 0 && y < e.height && !studio.state.busy && !studio.state.error) {
          const left = Math.max(0, x - 7), top = Math.max(0, y - 7)
          const width = Math.min(e.width, x + 8) - left, height = Math.min(e.height, y + 8) - top
          const pixels = await e.pixels(true, { x: left, y: top, width, height })
          if (stopped) return
          const context = preview.current?.getContext('2d')
          if (context) {
            const patch = new OffscreenCanvas(width, height)
            patch.getContext('2d')!.putImageData(new ImageData(pixels, width, height), 0, 0)
            context.clearRect(0, 0, 105, 105); context.imageSmoothingEnabled = false
            context.drawImage(patch, (left - x + 7) * 7, (top - y + 7) * 7, width * 7, height * 7)
            context.strokeStyle = 'rgba(0,0,0,.8)'; context.lineWidth = 1; context.strokeRect(48.5, 48.5, 8, 8)
            context.strokeStyle = 'white'; context.strokeRect(49.5, 49.5, 6, 6)
          }
          const i = ((y - top) * width + x - left) * 4
          setColor('#' + Array.from(pixels.slice(i, i + 3)).map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase())
        }
      } catch { /* Device loss is reported by Studio. */ }
      if (!stopped) timer = setTimeout(() => void refresh(), 65)
    }
    void refresh()
    return () => { stopped = true; clearTimeout(timer) }
  }, [studio])
  const bounds = canvas.current?.getBoundingClientRect(), area = stage.current?.getBoundingClientRect()
  if (!bounds || !area) return null
  const x = bounds.left - area.left + point.x / studio.engine.width * bounds.width
  const y = bounds.top - area.top + point.y / studio.engine.height * bounds.height
  const left = Math.max(4, x + 140 > area.width ? x - 134 : x + 22), top = Math.max(4, y + 164 > area.height ? y - 154 : y + 22)
  return <div className="color-loupe" style={{ left, top }} aria-label={`Magnified color ${color}`} data-testid="color-loupe">
    <canvas ref={preview} width={105} height={105} /><span><i style={{ background: color === '…' ? 'transparent' : color }} />{color}</span>
  </div>
}
