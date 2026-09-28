import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw } from 'lucide-react'
import { angle, HANDLES, handleAxes, resizeTransform, validTransform, type Handle } from '../../shared/transform'
import type { LayerMeta, RasterTransform, Tool } from '../../shared/types'
import type { Studio } from './Studio'

type Drag = { mode: Handle | 'move' | 'rotate'; start: { x: number; y: number }; original: RasterTransform }
export function ImageEditor({ studio, layer, tool, zoom, board, canvas, busy, panKey, onCanvasDown, onCanvasMove, onCanvasUp }: {
  studio: Studio; layer: LayerMeta; tool: Tool; zoom: number; board: RefObject<HTMLDivElement | null>; canvas: RefObject<HTMLCanvasElement | null>; busy: boolean; panKey: RefObject<boolean>;
  onCanvasDown: (e: PointerEvent) => void; onCanvasMove: (e: PointerEvent) => void; onCanvasUp: (e: PointerEvent) => void
}) {
  const [draft, setDraft] = useState(layer.transform!), [proportional, setProportional] = useState(true)
  const value = useRef(draft), drag = useRef<Drag | null>(null)
  const disabled = busy || layer.locked || !layer.visible
  const saved = JSON.stringify(layer.transform)
  useEffect(() => { value.current = layer.transform!; setDraft(layer.transform!) }, [saved])
  useEffect(() => () => { studio.engine.previewRaster(layer.id) }, [studio, layer.id])
  const preview = (next: RasterTransform): void => {
    value.current = next; setDraft(next)
    if (validTransform(next)) studio.engine.previewRaster(layer.id, next)
  }
  const cancel = (): void => { drag.current = null; preview(layer.transform!); studio.engine.previewRaster(layer.id) }
  const commit = (): void => {
    if (disabled || !validTransform(value.current)) { cancel(); return }
    void studio.transformRaster(layer.id, value.current)
  }
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLElement && (e.target.closest('input,dialog') || e.ctrlKey || e.metaKey || e.altKey)) return
      if (e.key === 'Escape') { e.preventDefault(); cancel() }
      if (disabled || drag.current) return
      const delta = e.shiftKey ? 10 : 1, offsets: Record<string, [number, number]> = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] }
      if (offsets[e.key]) { e.preventDefault(); const [x, y] = offsets[e.key]; preview({ ...value.current, x: value.current.x + x, y: value.current.y + y }); commit() }
    }
    const blur = (): void => { if (drag.current) cancel() }
    window.addEventListener('keydown', key); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('blur', blur) }
  })
  const point = (e: PointerEvent): { x: number; y: number } => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) * studio.engine.width / r.width, y: (e.clientY - r.top) * studio.engine.height / r.height }
  }
  const start = (e: PointerEvent, mode: Drag['mode']): void => {
    if (e.button === 1 || panKey.current || e.altKey) { e.stopPropagation(); onCanvasDown(e); return }
    e.stopPropagation()
    if (disabled || e.button !== 0) return
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { mode, start: point(e), original: { ...value.current } }
  }
  const move = (e: PointerEvent): void => {
    e.stopPropagation()
    const g = drag.current; if (!g) { onCanvasMove(e); return }
    const p = point(e), t = g.original, dx = p.x - g.start.x, dy = p.y - g.start.y
    if (g.mode === 'move') preview({ ...t, x: t.x + dx, y: t.y + dy })
    else if (g.mode === 'rotate') {
      const radians = Math.atan2(p.y - t.y, p.x - t.x) - Math.atan2(g.start.y - t.y, g.start.x - t.x)
      const rotation = angle(t.rotation + radians * 180 / Math.PI)
      preview({ ...t, rotation: e.shiftKey ? Math.round(rotation / 15) * 15 : rotation })
    } else preview(resizeTransform(t, g.mode, dx, dy, e.shiftKey ? !proportional : proportional))
  }
  const end = (e: PointerEvent, canceled = false): void => {
    e.stopPropagation()
    if (!drag.current) { onCanvasUp(e); return }
    drag.current = null
    if (canceled) cancel(); else commit()
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }
  const change = (patch: Partial<RasterTransform>): void => { if (!disabled) { preview({ ...value.current, ...patch }); commit() } }
  const field = (key: 'x' | 'y' | 'width' | 'height' | 'rotation', label: string) => <label>{label}<input aria-label={`Image ${label.toLowerCase()}`} type="number" step={1}
    min={key === 'width' || key === 'height' ? 1 : key === 'rotation' ? -180 : -32768} max={key === 'rotation' ? 180 : 32768}
    value={Math.round(draft[key] * 10) / 10} disabled={disabled}
    onChange={e => {
      const n = e.currentTarget.valueAsNumber; if (!Number.isFinite(n)) return
      const patch: Partial<RasterTransform> = { [key]: n }
      if (proportional && key === 'width') patch.height = value.current.height * n / value.current.width
      if (proportional && key === 'height') patch.width = value.current.width * n / value.current.height
      preview({ ...value.current, ...patch })
    }} onBlur={commit} onKeyDown={e => {
      if (e.key === 'Enter') e.currentTarget.blur()
      if (e.key === 'Escape') { cancel(); e.currentTarget.blur() }
      e.stopPropagation()
    }} /></label>
  return <>
    <aside className="image-inspector" aria-label="Image editing tools">
      <div className="section-heading"><h2>Edit image</h2><span className="quiet-label">{tool === 'image-move' ? 'MOVE' : tool === 'image-rotate' ? 'ROTATE' : 'TRANSFORM'}</span></div>
      <p className="image-layer-title" title={layer.name}>{layer.name}</p>
      <div className="image-fields">{field('x', 'X')}{field('y', 'Y')}{field('width', 'Width')}{field('height', 'Height')}{field('rotation', 'Rotation')}</div>
      <label className="aspect-lock"><input type="checkbox" checked={proportional} disabled={disabled} onChange={e => setProportional(e.target.checked)} />Keep proportions</label>
      <div className="image-buttons">
        <button title="Rotate image left 90°" aria-label="Rotate image left 90°" disabled={disabled} onClick={() => change({ rotation: angle(draft.rotation - 90) })}><RotateCcw size={17} /></button>
        <button title="Rotate image right 90°" aria-label="Rotate image right 90°" disabled={disabled} onClick={() => change({ rotation: angle(draft.rotation + 90) })}><RotateCw size={17} /></button>
        <button title="Flip image horizontally" aria-label="Flip image horizontally" disabled={disabled} onClick={() => change({ flipX: !draft.flipX })}><FlipHorizontal2 size={17} /></button>
        <button title="Flip image vertically" aria-label="Flip image vertically" disabled={disabled} onClick={() => change({ flipY: !draft.flipY })}><FlipVertical2 size={17} /></button>
      </div>
      <button className="secondary-button image-wide" disabled={disabled} onClick={() => change({ x: studio.engine.width / 2, y: studio.engine.height / 2 })}>Center on canvas</button>
      <p className="image-tip">{layer.locked ? 'Unlock this layer to edit the image.' : !layer.visible ? 'Show this layer to edit the image.' : 'Drag the image to move it. Use the handles to resize and the round handle to rotate.'}</p>
      <p className="image-tip">Shift toggles proportions while resizing and snaps rotation to 15°. Arrow keys nudge; Shift nudges 10 px. Esc cancels a drag.</p>
      <button className="primary-button image-wide" disabled={busy} onClick={() => studio.selectTool('brush')}>Paint over image</button>
      <p className="image-tip">Brushwork goes on a watercolor layer above this image.</p>
    </aside>
    {board.current && layer.visible && createPortal(<div className={`image-box ${disabled ? 'image-box-disabled' : ''}`} data-testid="image-transform-box"
      style={{ left: draft.x, top: draft.y, width: draft.width, height: draft.height, transform: `translate(-50%, -50%) rotate(${draft.rotation}deg)`, borderWidth: 1 / zoom, '--handle-scale': 1 / zoom } as React.CSSProperties}
      onPointerDown={e => start(e, tool === 'image-rotate' ? 'rotate' : 'move')} onPointerMove={move} onPointerUp={e => end(e)} onPointerCancel={e => end(e, true)} onLostPointerCapture={e => { e.stopPropagation(); if (drag.current) cancel() }}>
      <span className="image-size-label" style={{ transform: `scale(${1 / zoom})` }}>{Math.round(draft.width)} × {Math.round(draft.height)} · {Math.round(draft.rotation)}°</span>
      {!disabled && tool !== 'image-move' && <>
        <span className="rotation-stem" style={{ height: 28 / zoom, top: -28 / zoom, width: 1 / zoom }} />
        <button className="transform-handle rotate-handle" aria-label="Rotate image handle" style={{ left: '50%', top: -28 / zoom }} onPointerDown={e => start(e, 'rotate')} />
        {tool === 'image-transform' && HANDLES.map(handle => { const [x, y] = handleAxes(handle); return <button key={handle} className={`transform-handle handle-${handle}`} aria-label={`Resize image ${handle}`} style={{ left: `${(x + 1) * 50}%`, top: `${(y + 1) * 50}%` }} onPointerDown={e => start(e, handle)} /> })}
      </>}
    </div>, board.current)}
  </>
}
