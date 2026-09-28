import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Brush, Check, ChevronDown, CircleHelp, Copy, Download, Droplets, Eraser, Expand, Eye, EyeOff, FilePlus2, Hand, ImagePlus, Layers, Leaf, LockKeyhole, Minus, Move, Pause, Pipette, Play, Plus, RotateCcw, RotateCw, Save, Scaling, Sparkles, Sun, Trash2, Undo2, Redo2, UnlockKeyhole, X } from 'lucide-react'
import { Studio, type StudioState } from './Studio'
import type { BrushSample, Tool } from '../../shared/types'
import { ColorLoupe } from './ColorLoupe'
import { ImageEditor } from './ImageEditor'

const PALETTE = [
  ['Ultramarine', '#315d91'], ['Prussian blue', '#244b5a'], ['Cerulean', '#729cae'],
  ['Sap green', '#667650'], ['Viridian', '#388173'], ['Yellow ochre', '#c79943'],
  ['Hansa yellow', '#e9c952'], ['Burnt sienna', '#ae6041'], ['Vermilion', '#c96553'],
  ['Rose madder', '#af667c'], ['Dioxazine violet', '#74627f'], ["Payne’s gray", '#444c58']
] as const
const TOOLS: { tool: Tool; name: string; key: string; icon: ReactNode }[] = [
  { tool: 'brush', name: 'Watercolor brush', key: 'B', icon: <Brush /> },
  { tool: 'water', name: 'Clean water', key: 'W', icon: <Droplets /> },
  { tool: 'lift', name: 'Lift pigment', key: 'L', icon: <Sparkles /> },
  { tool: 'eraser', name: 'Eraser', key: 'E', icon: <Eraser /> },
  { tool: 'eyedropper', name: 'Pick a color', key: 'I', icon: <Pipette /> },
  { tool: 'pan', name: 'Move canvas', key: 'H', icon: <Hand /> },
  { tool: 'image-move', name: 'Move image', key: 'V', icon: <Move /> },
  { tool: 'image-transform', name: 'Transform image', key: 'T', icon: <Scaling /> },
  { tool: 'image-rotate', name: 'Rotate image', key: 'R', icon: <RotateCw /> }
]
type Modal = 'new' | 'export' | 'help' | null
interface ImportState { bitmap: ImageBitmap; url: string; name: string; scale: number; x: number; y: number }

function IconButton({ label, children, active = false, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }): ReactNode {
  return <button {...props} type="button" className={`icon-button ${active ? 'active' : ''} ${props.className ?? ''}`} title={label} aria-label={label}>{children}</button>
}
function ModalFrame({ title, subtitle, children, onClose }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void }): ReactNode {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} className="modal" onCancel={event => { event.preventDefault(); onClose() }}>
    <div className="modal-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton label="Close dialog" onClick={onClose}><X /></IconButton></div>{children}
  </dialog>
}
function Slider({ label, value, min = 0, max = 100, suffix = '%', onChange }: { label: string; value: number; min?: number; max?: number; suffix?: string; onChange: (n: number) => void }): ReactNode {
  return <label className="slider-field"><span>{label}<span className="slider-number">{Math.round(value)}<small>{suffix}</small></span></span>
    <input aria-label={label} type="range" min={min} max={max} value={value} onChange={e => onChange(+e.target.value)} style={{ '--fill': `${(value - min) / (max - min) * 100}%` } as React.CSSProperties} /></label>
}

export default function App(): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null), stageRef = useRef<HTMLDivElement>(null), studioRef = useRef<Studio | null>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<StudioState | null>(null)
  const [zoom, setZoom] = useState(.5), [pan, setPan] = useState({ x: 0, y: 0 })
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [altPick, setAltPick] = useState(false)
  const [menu, setMenu] = useState(false), [modal, setModal] = useState<Modal>(null)
  const [dimensions, setDimensions] = useState({ width: 1536, height: 1024 })
  const [includePaper, setIncludePaper] = useState(true), [hasPainted, setHasPainted] = useState(false)
  const [unsaved, setUnsaved] = useState<{ action: () => void } | null>(null)
  const [importing, setImporting] = useState<ImportState | null>(null)
  const [opacity, setOpacity] = useState(100)
  const [renameId, setRenameId] = useState<string | null>(null)
  const gesture = useRef<{ mode: 'paint' | 'pan'; x: number; y: number; px: number; py: number } | null>(null)
  const space = useRef(false)
  const ready = !!state?.ready, brush = state?.brush, active = state?.layers.find(l => l.id === state.activeId)
  const fit = useCallback(() => {
    const stage = stageRef.current, engine = studioRef.current?.engine
    if (stage && engine) { setZoom(Math.min(1, (stage.clientWidth - 104) / engine.width, (stage.clientHeight - 104) / engine.height)); setPan({ x: 0, y: 0 }) }
  }, [])
  const guard = (action: () => void): void => {
    if (studioRef.current?.state.dirty) setUnsaved({ action }); else action()
  }
  const safe = (action: Promise<unknown>): void => { void action.catch(error => studioRef.current?.notify(String(error))) }
  const startImport = async (): Promise<void> => {
    if ((studioRef.current?.state.layers.length ?? 0) >= 8) { studioRef.current?.notify('All eight layers are in use. Remove a layer before importing another image.'); return }
    const file = await window.desktop.importImage()
    if (file.canceled || !file.bytes) return
    const blob = new Blob([file.bytes.slice().buffer as ArrayBuffer]), bitmap = await createImageBitmap(blob)
    if (bitmap.width * bitmap.height > 64000000) { bitmap.close(); throw new Error('Please use an image smaller than 64 megapixels.') }
    const engine = studioRef.current!.engine
    setImporting({ bitmap, url: URL.createObjectURL(blob), name: file.path!.split(/[\\/]/).pop()!, scale: Math.min(engine.width / bitmap.width, engine.height / bitmap.height), x: engine.width / 2, y: engine.height / 2 })
  }
  const actions = useRef<(action: string) => void>(() => {})
  actions.current = action => {
    const studio = studioRef.current
    if (!studio || !studio.state.ready || studio.state.busy) return
    setMenu(false)
    switch (action) {
      case 'new': guard(() => setModal('new')); break
      case 'open': guard(() => safe(studio.open())); break
      case 'save': safe(studio.save()); break
      case 'saveAs': safe(studio.save(true)); break
      case 'import': safe(startImport()); break
      case 'export': setModal('export'); break
      case 'undo': safe(studio.travel(false)); break
      case 'redo': safe(studio.travel(true)); break
      case 'fit': fit(); break
    }
  }
  useEffect(() => {
    const studio = new Studio(canvasRef.current!); studioRef.current = studio
    const unsubscribe = studio.subscribe(() => setState(studio.state)); setState(studio.state)
    void studio.initialize().then(fit)
    const offMenu = window.desktop.onMenu(action => actions.current(action))
    const offSave = window.desktop.onSaveRequest(() => safe(studio.save()))
    const observer = new ResizeObserver(() => { if (!gesture.current) fit() }); observer.observe(stageRef.current!)
    if (new URLSearchParams(location.search).has('test')) window.__waterpaint = studio
    return () => { unsubscribe(); offMenu(); offSave(); observer.disconnect(); studio.dispose() }
  }, [fit])
  useEffect(() => { fit() }, [state?.width, state?.height, fit])
  useEffect(() => { setOpacity(Math.round((active?.opacity ?? 1) * 100)) }, [active?.id, active?.opacity])
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.closest('dialog'))) return
      if (document.querySelector('dialog[open]')) return
      const studio = studioRef.current; if (!studio) return
      if (e.key === 'Alt') { setAltPick(true); return }
      if (e.code === 'Space') { e.preventDefault(); space.current = true; return }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const tool = TOOLS.find(t => t.key.toLowerCase() === e.key.toLowerCase())
      if (tool) { e.preventDefault(); studio.selectTool(tool.tool) }
      if (e.key === '[' || e.key === ']') studio.setBrush({ size: Math.max(2, Math.min(400, studio.state.brush.size + (e.key === ']' ? 5 : -5))) })
      if (e.key === '+' || e.key === '=') setZoom(z => Math.min(3, z * 1.15))
      if (e.key === '-') setZoom(z => Math.max(.1, z / 1.15))
      if (e.key === '?') setModal('help')
      if (e.key === 'Escape') setMenu(false)
    }
    const up = (e: KeyboardEvent): void => { if (e.code === 'Space') space.current = false; if (e.key === 'Alt') setAltPick(false) }
    const blur = (): void => { space.current = false; setAltPick(false); studioRef.current?.endStroke(); gesture.current = null }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur) }
  }, [])
  useEffect(() => {
    const stage = stageRef.current!
    const wheel = (e: WheelEvent): void => { e.preventDefault(); setZoom(z => Math.max(.1, Math.min(3, z * Math.exp(-e.deltaY * .0015)))) }
    stage.addEventListener('wheel', wheel, { passive: false }); return () => stage.removeEventListener('wheel', wheel)
  }, [])
  const point = (event: { clientX: number; clientY: number; pressure?: number; pointerType?: string }): BrushSample => {
    const rect = canvasRef.current!.getBoundingClientRect(), engine = studioRef.current!.engine
    return { x: (event.clientX - rect.left) / rect.width * engine.width, y: (event.clientY - rect.top) / rect.height * engine.height, pressure: event.pointerType === 'pen' ? Math.max(.05, event.pressure ?? .5) : 1 }
  }
  const pointerDown = (e: React.PointerEvent): void => {
    const studio = studioRef.current; if (!studio || !ready) return
    e.preventDefault(); setMenu(false)
    const isPan = space.current || brush?.tool === 'pan' || e.button === 1
    if (e.button !== 0 && !isPan) return
    const p = point(e)
    if (!isPan && (p.x < 0 || p.y < 0 || p.x >= studio.engine.width || p.y >= studio.engine.height)) return
    if ((brush?.tool === 'eyedropper' || e.altKey) && !isPan) { if (!studio.state.busy) safe(studio.pick(p.x, p.y)); return }
    if (brush?.tool.startsWith('image-') && !isPan) return
    if (studio.state.busy && !isPan) return
    e.currentTarget.setPointerCapture(e.pointerId)
    gesture.current = { mode: isPan ? 'pan' : 'paint', x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
    if (!isPan) { setHasPainted(true); studio.beginStroke(p) }
  }
  const pointerMove = (e: React.PointerEvent): void => {
    if (!ready) return
    const p = point(e); setCursor({ x: p.x, y: p.y })
    const g = gesture.current
    if (g?.mode === 'pan') setPan({ x: g.px + e.clientX - g.x, y: g.py + e.clientY - g.y })
    if (g?.mode === 'paint') {
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]
      for (const event of events.length ? events : [e.nativeEvent]) studioRef.current?.moveStroke(point(event))
    }
  }
  const pointerUp = (e: React.PointerEvent): void => {
    if (gesture.current?.mode === 'paint') studioRef.current?.endStroke()
    gesture.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }
  const closeImport = (): void => { if (importing) { URL.revokeObjectURL(importing.url); importing.bitmap.close() }; setImporting(null) }
  const commitImport = async (): Promise<void> => {
    if (!importing || !studioRef.current) return
    const { bitmap, scale, x, y, name } = importing
    const sourceScale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height))
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * sourceScale)), Math.max(1, Math.round(bitmap.height * sourceScale)))
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const png = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
    await studioRef.current.importRaster(png, name, { x, y, width: bitmap.width * scale, height: bitmap.height * scale, rotation: 0, flipX: false, flipY: false }); setHasPainted(true); closeImport()
  }
  const currentColorName = PALETTE.find(p => p[1] === brush?.color)?.[0] ?? 'Your own blend'
  const picking = brush?.tool === 'eyedropper' || altPick
  const paintingTool = brush && ['brush', 'water', 'lift', 'eraser'].includes(brush.tool) && !picking
  const editingImage = brush?.tool.startsWith('image-') && active?.kind === 'raster' && active.transform

  return <div className="app-shell">
    <header className="app-header">
      <div className="brand"><div className="brand-mark"><Droplets size={23} strokeWidth={1.6} /></div><span>waterpaint<span className="brand-dot">.</span></span><span className="brand-divider" /><span className="studio-label">YOUR WATERCOLOR STUDIO</span></div>
      <div className="header-actions"><span className="local-label"><span className="tiny-dot" />Made to slow down</span><IconButton label="Keyboard shortcuts" onClick={() => setModal('help')}><CircleHelp size={18} /></IconButton></div>
    </header>
    <div className="document-bar">
      <div className="document-controls"><div className="file-menu-wrap"><button className="text-button" onClick={() => setMenu(!menu)} disabled={!ready}>File <ChevronDown size={13} /></button>
        {menu && <><div className="menu-dismiss" onClick={() => setMenu(false)} /><div className="file-menu">
          {[['new', 'New painting', 'Ctrl N'], ['open', 'Open painting…', 'Ctrl O'], ['save', 'Save', 'Ctrl S'], ['saveAs', 'Save as…', 'Ctrl Shift S'], ['import', 'Import image…', 'Ctrl I']].map(([key, name, shortcut]) => <button key={key} onClick={() => actions.current(key)}>{name}<kbd>{shortcut}</kbd></button>)}
        </div></>}
      </div><span className="small-divider" /><IconButton label="Undo (Ctrl+Z)" disabled={!state?.canUndo || state.busy} onClick={() => actions.current('undo')}><Undo2 /></IconButton><IconButton label="Redo (Ctrl+Shift+Z)" disabled={!state?.canRedo || state.busy} onClick={() => actions.current('redo')}><Redo2 /></IconButton></div>
      <div className="document-title"><span>{state?.title ?? 'Untitled study'}</span>{state?.dirty && <span className="dirty-dot" title="Unsaved changes" />}<span className="document-size">{state?.width ?? 1536} × {state?.height ?? 1024} px</span></div>
      <div className="document-controls right"><button className="text-button" disabled={!ready || state?.busy} onClick={() => actions.current('save')}><Save size={15} />Save</button><button className="export-button" disabled={!ready || state?.busy} onClick={() => setModal('export')}><Download size={15} />Export<ChevronDown size={13} /></button></div>
    </div>
    <main className="workspace">
      <nav className="tool-rail" aria-label="Painting tools"><div className="rail-main">
        {TOOLS.map(({ tool, name, key, icon }, index) => <div key={tool} className={index === 4 || index === 6 ? 'rail-separated' : ''}><IconButton label={`${name} (${key})`} active={brush?.tool === tool} disabled={!ready || state?.busy || (tool.startsWith('image-') && !state?.layers.some(l => l.kind === 'raster'))} onClick={() => studioRef.current?.selectTool(tool)}>{icon}</IconButton></div>)}
        <span className="rail-divider" /><div className="rail-color" title={currentColorName} style={{ backgroundColor: brush?.color }} />
      </div><IconButton label="Fit canvas (Ctrl+0)" onClick={fit}><Expand /></IconButton></nav>
      {editingImage && active && studioRef.current && <ImageEditor key={active.id} studio={studioRef.current} layer={active} tool={brush!.tool} zoom={zoom} board={boardRef} canvas={canvasRef} busy={!!state?.busy} panKey={space} onCanvasDown={pointerDown} onCanvasMove={pointerMove} onCanvasUp={pointerUp} />}
      <section className="canvas-area">
        <div className="canvas-heading"><span><span className="paper-symbol" />COLD PRESS PAPER <span className="paper-weight">/ 300 GSM</span></span><span className="canvas-heading-right">{state?.paused ? <Pause size={12} /> : <Droplets size={12} />}{state?.paused ? 'Time stands still' : 'Let it flow'}</span></div>
        <div className={`canvas-stage ${paintingTool ? 'painting-cursor' : ''} ${picking ? 'picking-cursor' : ''}`} ref={stageRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onLostPointerCapture={() => { studioRef.current?.endStroke(); gesture.current = null }} onPointerLeave={() => { if (!gesture.current) setCursor(null) }} onContextMenu={e => e.preventDefault()}>
          <div className="paper-board" ref={boardRef} style={{ width: state?.width ?? 1536, height: state?.height ?? 1024, transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
            <canvas ref={canvasRef} aria-label="Watercolor painting canvas" data-testid="painting-canvas" />
            {!hasPainted && !state?.hasArtwork && ready && !state?.dirty && <div className="empty-paper"><span className="empty-flower">✳</span><p>A blank page.<br />A little possibility.</p><span>Choose a color. Make a mark.</span></div>}
            {cursor && paintingTool && ready && <div className="brush-cursor" style={{ width: brush.size, height: brush.size, left: cursor.x, top: cursor.y, borderWidth: 1 / zoom }} />}
          </div>
          {picking && cursor && ready && studioRef.current && cursor.x >= 0 && cursor.y >= 0 && cursor.x < state!.width && cursor.y < state!.height && <ColorLoupe studio={studioRef.current} point={cursor} canvas={canvasRef} stage={stageRef} />}
          {!ready && !state?.error && <div className="loading-studio"><Droplets /><span>Preparing the paper…</span></div>}
        </div>
        <footer className="canvas-footer"><div className="paper-info"><span className={`tiny-dot ${state?.paused ? 'paused' : ''}`} />{state?.paused ? 'Drying paused' : (state?.stats.wetLayers ?? 0) > 0 ? 'Paint is settling' : 'Ready for a first wash'}<span className="footer-separator">·</span><span>{state?.layers.length ?? 1} / 8 layers</span></div>
          <div className="zoom-controls"><IconButton label="Zoom out" onClick={() => setZoom(z => Math.max(.1, z / 1.2))}><Minus size={14} /></IconButton><button className="zoom-value" onClick={fit} title="Fit to window">{Math.round(zoom * 100)}%</button><IconButton label="Zoom in" onClick={() => setZoom(z => Math.min(3, z * 1.2))}><Plus size={14} /></IconButton><span className="small-divider" /><IconButton label="Fit to window" onClick={fit}><Expand size={14} /></IconButton></div>
        </footer>
      </section>
      <aside className={`inspector ${editingImage ? 'image-mode' : ''}`} aria-label="Brush and layer settings">
        <section className="inspector-section brush-section"><div className="section-heading"><h2>Your brush</h2><span className="quiet-label">{brush?.tool === 'water' ? 'WATER ONLY' : brush?.tool === 'lift' ? 'LIFTING' : brush?.tool === 'eraser' ? 'ERASING' : 'WATERCOLOR'}</span></div>
          <div className="brush-presets">{(['round', 'wash', 'dry'] as const).map((preset, i) => <button className={`preset ${brush?.preset === preset ? 'selected' : ''}`} key={preset} onClick={() => studioRef.current?.selectPreset(preset)} disabled={!ready} aria-label={`${preset} brush`} aria-pressed={brush?.preset === preset}>
            <svg viewBox="0 0 64 28" aria-hidden="true"><path d={i === 1 ? 'M8 16 Q 22 4 36 13 T 56 12' : 'M9 19 Q24 5 35 14 T56 10'} fill="none" stroke="currentColor" strokeWidth={i === 1 ? 13 : i === 2 ? 6 : 7} strokeLinecap="round" opacity={i === 1 ? '.5' : '.85'} strokeDasharray={i === 2 ? '1 2' : undefined} /></svg><span>{preset === 'dry' ? 'Dry brush' : preset === 'wash' ? 'Wash' : 'Round'}</span>
          </button>)}</div>
          <div className="brush-preview" style={{ color: brush?.color }}><svg viewBox="0 0 260 52"><defs><filter id="soften"><feGaussianBlur stdDeviation="1.2" /></filter></defs><path d="M28 35 C60 18 81 24 110 28 S155 37 179 23 S218 20 235 17" fill="none" stroke="currentColor" strokeWidth="19" strokeLinecap="round" opacity=".11" filter="url(#soften)" /><path d="M29 33 C61 18 81 24 109 27 S154 36 179 23 S216 22 233 17" fill="none" stroke="currentColor" strokeWidth="13" strokeLinecap="round" opacity=".38" /><path d="M32 30 C61 21 81 25 109 28 S154 34 179 24 S216 20 230 18" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity=".16" /></svg><span>A SOFT TOUCH GOES A LONG WAY</span></div>
          <Slider label="Brush size" value={brush?.size ?? 70} min={2} max={400} suffix="px" onChange={size => studioRef.current?.setBrush({ size })} />
          <Slider label="Water" value={(brush?.water ?? .68) * 100} onChange={water => studioRef.current?.setBrush({ water: water / 100 })} />
          <Slider label="Pigment" value={(brush?.pigment ?? .52) * 100} onChange={pigment => studioRef.current?.setBrush({ pigment: pigment / 100 })} />
          <Slider label="Softness" value={(brush?.softness ?? .72) * 100} onChange={softness => studioRef.current?.setBrush({ softness: softness / 100 })} />
          <Slider label="Paint spread" min={1} max={8} suffix="×" value={brush?.spread ?? 1} onChange={spread => studioRef.current?.setBrush({ spread })} />
          <p className="spread-note">1× original flow · 8× stronger flow<br />Applied to the wash on your next stroke.</p>
        </section>
        <section className="inspector-section palette-section"><div className="section-heading"><h2>The palette</h2><span className="quiet-label">12 PIGMENTS</span></div><div className="palette-grid">{PALETTE.map(([name, color]) => <button key={color} title={name} aria-label={name} aria-pressed={brush?.color === color} className={`pigment ${brush?.color === color ? 'chosen' : ''}`} style={{ '--pigment': color } as React.CSSProperties} onClick={() => studioRef.current?.setBrush({ color })}>{brush?.color === color && <Check size={16} />}</button>)}</div>
          <div className="current-pigment"><label className="custom-color" title="Choose a custom color"><input aria-label="Custom pigment color" type="color" value={brush?.color ?? '#315d91'} onChange={e => studioRef.current?.setBrush({ color: e.target.value })} /><span style={{ backgroundColor: brush?.color }} /></label><div><span className="quiet-label">CURRENT PIGMENT</span><strong>{currentColorName}</strong></div><span className="color-hex">{brush?.color.toUpperCase()}</span></div>
        </section>
        <section className="inspector-section layers-section"><div className="section-heading"><h2><Layers size={15} />Layers</h2><div className="compact-actions"><span className="quiet-label">{state?.layers.length ?? 1}/8</span><IconButton label="Add layer" disabled={!ready || state?.busy || (state?.layers.length ?? 0) >= 8} onClick={() => safe(studioRef.current!.addLayer())}><Plus size={16} /></IconButton></div></div>
          <div className="layer-list">{state?.layers.slice().reverse().map((layer, index) => <div key={layer.id} className={`layer-row ${state.activeId === layer.id ? 'selected' : ''}`} onClick={() => studioRef.current?.selectLayer(layer.id)}>
            <IconButton label={`${layer.visible ? 'Hide' : 'Show'} ${layer.name}`} disabled={state.busy} onClick={e => { e.stopPropagation(); safe(studioRef.current!.updateLayer(layer.id, { visible: !layer.visible })) }}>{layer.visible ? <Eye size={15} /> : <EyeOff size={15} />}</IconButton>
            <button className="layer-thumbnail" aria-label={`Select ${layer.name}`}><span>{layer.kind === 'raster' ? <ImagePlus size={16} /> : String(state.layers.length - index).padStart(2, '0')}</span></button>
            <div className="layer-name" onDoubleClick={() => setRenameId(layer.id)}>{renameId === layer.id ? <input aria-label="Layer name" autoFocus defaultValue={layer.name} maxLength={100} onBlur={e => { const name = e.target.value.trim() || layer.name; setRenameId(null); if (name !== layer.name) safe(studioRef.current!.updateLayer(layer.id, { name })) }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); e.stopPropagation() }} /> : <><span>{layer.name}</span><small>{layer.kind === 'raster' ? 'Imported image' : 'Watercolor'}</small></>}</div>
            <IconButton label={`${layer.locked ? 'Unlock' : 'Lock'} ${layer.name}`} disabled={state.busy} onClick={e => { e.stopPropagation(); safe(studioRef.current!.updateLayer(layer.id, { locked: !layer.locked })) }}>{layer.locked ? <LockKeyhole size={13} /> : <UnlockKeyhole size={13} />}</IconButton>
          </div>)}</div>
          <label className="layer-opacity"><span>Opacity</span><input aria-label="Layer opacity" type="range" min={0} max={100} value={opacity} disabled={state?.busy} onChange={e => setOpacity(+e.target.value)} onPointerUp={() => { if (active && opacity !== Math.round(active.opacity * 100)) safe(studioRef.current!.updateLayer(active.id, { opacity: opacity / 100 })) }} onKeyUp={e => { if (active && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) safe(studioRef.current!.updateLayer(active.id, { opacity: +e.currentTarget.value / 100 })) }} /><span>{opacity}%</span></label>
          <div className="layer-actions"><span>Each layer, its own wash.</span><div><IconButton label="Move layer up" disabled={!active || state?.busy || state?.layers.at(-1)?.id === active?.id} onClick={() => safe(studioRef.current!.reorderLayer(active!.id, 1))}><ArrowUp size={14} /></IconButton><IconButton label="Move layer down" disabled={!active || state?.busy || state?.layers[0]?.id === active?.id} onClick={() => safe(studioRef.current!.reorderLayer(active!.id, -1))}><ArrowDown size={14} /></IconButton><IconButton label="Duplicate layer" disabled={!active || state?.busy || (state?.layers.length ?? 0) >= 8} onClick={() => safe(studioRef.current!.duplicateLayer(active!.id))}><Copy size={14} /></IconButton><IconButton label="Delete layer" disabled={!active || state?.busy || (state?.layers.length ?? 0) <= 1} onClick={() => safe(studioRef.current!.deleteLayer(active!.id))}><Trash2 size={14} /></IconButton></div></div>
        </section>
        <div className="water-controls"><button disabled={!ready || state?.busy} onClick={() => studioRef.current?.togglePause()}>{state?.paused ? <Play size={15} /> : <Pause size={15} />}{state?.paused ? 'Resume drying' : 'Pause drying'}</button><button disabled={!ready || state?.busy || active?.kind !== 'paint' || active?.locked} onClick={() => safe(studioRef.current!.dryLayer())}><Sun size={16} />Dry layer</button></div>
        <div className="studio-note"><Leaf size={17} strokeWidth={1.4} /><p>Some things are better<br /><em>when you let them flow.</em></p></div>
      </aside>
    </main>
    <div className="status-bar"><span className="status-message" aria-live="polite">{state?.status ?? 'Opening your studio…'}</span><span title={state?.stats.gpu}><span className="tiny-dot" />{ready ? 'WebGPU' : 'Starting'}<span className="footer-separator">·</span>{state?.stats.fps ? `${state.stats.fps} fps` : 'GPU accelerated'}<span className="footer-separator">·</span>All yours. All offline.</span></div>

    {modal === 'new' && <ModalFrame title="A fresh sheet" subtitle="Every painting starts with a little possibility." onClose={() => setModal(null)}><div className="new-presets">{[[1536,1024,'Landscape'], [1024,1536,'Portrait'], [1536,1536,'Square']].map(([w,h,label]) => <button key={label} className={dimensions.width === w && dimensions.height === h ? 'selected' : ''} onClick={() => setDimensions({ width: +w, height: +h })}><span className={`paper-shape ${label}`} />{label}</button>)}</div><div className="dimension-fields"><label>Width<input aria-label="Canvas width" type="number" min={64} max={2048} value={dimensions.width} onChange={e => setDimensions({ ...dimensions, width: +e.target.value })} /><span>px</span></label><span>×</span><label>Height<input aria-label="Canvas height" type="number" min={64} max={2048} value={dimensions.height} onChange={e => setDimensions({ ...dimensions, height: +e.target.value })} /><span>px</span></label></div><p className="modal-note">Cold press paper · Up to 2048 × 2048 pixels</p><div className="modal-footer"><button className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={![dimensions.width, dimensions.height].every(n => Number.isInteger(n) && n >= 64 && n <= 2048)} onClick={() => { safe(studioRef.current!.newDocument(dimensions.width, dimensions.height)); setHasPainted(false); setModal(null) }}><FilePlus2 size={16} />Create canvas</button></div></ModalFrame>}
    {modal === 'export' && <ModalFrame title="Take your painting with you" subtitle="A full-resolution PNG, just as it looks right now." onClose={() => setModal(null)}><div className="export-options"><button className={includePaper ? 'selected' : ''} onClick={() => setIncludePaper(true)}><span className="export-preview paper-preview" /><strong>With paper</strong><small>Keep the warmth and texture</small>{includePaper && <Check size={16} />}</button><button className={!includePaper ? 'selected' : ''} onClick={() => setIncludePaper(false)}><span className="export-preview transparent-preview" /><strong>Transparent</strong><small>Just your brushwork</small>{!includePaper && <Check size={16} />}</button></div><p className="modal-note">{state?.width} × {state?.height} pixels · PNG · Visible layers</p><div className="modal-footer"><button className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" onClick={() => { safe(studioRef.current!.export(includePaper)); setModal(null) }}><Download size={16} />Export painting</button></div></ModalFrame>}
    {modal === 'help' && <ModalFrame title="Make yourself at home" subtitle="A few small shortcuts to stay in the flow." onClose={() => setModal(null)}><div className="shortcut-list">{[['B / W / L', 'Brush / water / lift pigment'], ['E / I / H', 'Eraser / eyedropper / hand'], ['[ / ]', 'Smaller / larger brush'], ['Space + drag', 'Move the canvas'], ['Scroll', 'Zoom in and out'], ['Ctrl + 0', 'Fit to window'], ['Ctrl + Z', 'Undo'], ['Ctrl + Shift + Z', 'Redo'], ['Ctrl + S', 'Save your painting']].map(([key,label]) => <div key={key}><span>{label}</span><kbd>{key}</kbd></div>)}</div><p className="help-tip"><Droplets size={18} />Paint into a damp wash for soft blends. Let it dry for sharper edges. Add clean water to wake the pigments again.</p></ModalFrame>}
    {unsaved && <ModalFrame title="Keep this painting?" subtitle="Save your changes before opening a fresh canvas." onClose={() => setUnsaved(null)}><div className="modal-footer"><button className="secondary-button" onClick={() => { const action = unsaved.action; setUnsaved(null); action() }}>Discard changes</button><button className="primary-button" onClick={() => { safe((async () => { if (await studioRef.current!.save()) { const action = unsaved.action; setUnsaved(null); action() } })()) }}>Save & continue</button></div></ModalFrame>}
    {state?.recovery && !state.error && <ModalFrame title="Your painting is still here" subtitle="A recovery snapshot was found from your last session." onClose={() => safe(studioRef.current!.recoveryAction(false))}><div className="modal-footer"><button className="secondary-button" onClick={() => safe(studioRef.current!.recoveryAction(false))}>Discard snapshot</button><button className="primary-button" onClick={() => { safe(studioRef.current!.recoveryAction(true)); setHasPainted(true) }}><RotateCcw size={16} />Restore painting</button></div></ModalFrame>}
    {state?.error && <ModalFrame title={ready ? 'The studio needs a moment' : 'A graphics check'} subtitle={state.error} onClose={() => studioRef.current?.clearError()}><p className="modal-note">WaterPaint uses WebGPU to move water and pigment. If the graphics device was interrupted, reload to restore your last recovery snapshot.</p><div className="modal-footer">{ready && <button className="secondary-button" onClick={() => studioRef.current?.clearError()}>Dismiss</button>}<button className="primary-button" onClick={() => window.desktop.reload()}>Reload studio</button></div></ModalFrame>}
    {importing && state && <ModalFrame title="Find its place" subtitle="Position your image on the canvas before importing." onClose={closeImport}><div className="import-preview" style={{ aspectRatio: `${state.width} / ${state.height}` }}><img src={importing.url} alt="Import position preview" style={{ width: `${importing.bitmap.width * importing.scale / state.width * 100}%`, height: `${importing.bitmap.height * importing.scale / state.height * 100}%`, left: `${importing.x / state.width * 100}%`, top: `${importing.y / state.height * 100}%` }} /></div><Slider label="Image scale" min={5} max={200} value={importing.scale / Math.min(state.width / importing.bitmap.width, state.height / importing.bitmap.height) * 100} onChange={v => setImporting({ ...importing, scale: v / 100 * Math.min(state.width / importing.bitmap.width, state.height / importing.bitmap.height) })} /><Slider label="Horizontal position" value={importing.x / state.width * 100} onChange={v => setImporting({ ...importing, x: v / 100 * state.width })} /><Slider label="Vertical position" value={importing.y / state.height * 100} onChange={v => setImporting({ ...importing, y: v / 100 * state.height })} /><div className="modal-footer"><button className="secondary-button" onClick={closeImport}>Cancel</button><button className="primary-button" onClick={() => safe(commitImport())}><ImagePlus size={16} />Import image</button></div></ModalFrame>}
  </div>
}
