import { WatercolorEngine, type EngineStats } from '../../engine/WatercolorEngine'
import { StrokeSampler } from '../../engine/stroke'
import { History } from '../../shared/history'
import { DEFAULT_BRUSH, type BrushSample, type BrushSettings, type LayerMeta, type Preset, type Tool } from '../../shared/types'
import { encode, decode } from './codec'

export interface StudioState {
  ready: boolean; busy: boolean; error: string | null; title: string; dirty: boolean; hasArtwork: boolean;
  layers: LayerMeta[]; activeId: string; brush: BrushSettings; paused: boolean;
  canUndo: boolean; canRedo: boolean; width: number; height: number;
  stats: EngineStats; status: string; recovery: Uint8Array | null
}
interface ActiveStroke { sampler: StrokeSampler; settings: BrushSettings; layerId: string; pending: BrushSample[]; started: boolean; ended: boolean; checkpoint?: Promise<Uint8Array> }
export class Studio {
  engine: WatercolorEngine
  history = new History()
  private listeners = new Set<() => void>()
  private stroke: ActiveStroke | null = null
  private autosave: ReturnType<typeof setInterval> | null = null
  private revision = 0
  private lastRecoveredRevision = -1
  state: StudioState = {
    ready: false, busy: false, error: null, title: 'Untitled study', dirty: false, hasArtwork: false,
    layers: [], activeId: '', brush: { ...DEFAULT_BRUSH }, paused: false,
    canUndo: false, canRedo: false, width: 1536, height: 1024,
    stats: { fps: 0, frameMs: 0, wetLayers: 0, gpu: '', simulation: '' }, status: 'Preparing your studio…', recovery: null
  }
  constructor(canvas: HTMLCanvasElement) {
    this.engine = new WatercolorEngine(canvas)
    this.engine.onError = error => this.update({ error, busy: false })
    this.engine.onStats = stats => this.update({ stats })
    this.engine.onEvolution = () => { this.revision++; if (!this.state.dirty) this.markDirty() }
  }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  getSnapshot = (): StudioState => this.state
  private update(patch: Partial<StudioState>): void { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()) }
  private sync(): void { this.update({ layers: this.engine.metadata, hasArtwork: this.engine.hasArtwork, canUndo: this.history.canUndo, canRedo: this.history.canRedo, width: this.engine.width, height: this.engine.height, paused: this.engine.paused }) }
  private markDirty(): void { this.revision++; this.update({ dirty: true }); window.desktop.setDirty(true) }
  private clean(): void { this.update({ dirty: false }); window.desktop.setDirty(false) }
  notify(status: string): void { this.update({ status }) }
  clearError(): void { this.update({ error: null }) }
  async initialize(): Promise<void> {
    try {
      await this.engine.initialize()
      const layer = this.engine.addLayer({ name: 'First wash' })
      this.update({ ready: true, activeId: layer.id, status: 'A little water. A little color. Begin anywhere.' }); this.sync()
      this.engine.render()
      const initial = await window.desktop.initialProject()
      if (initial?.bytes) await this.loadBytes(initial.bytes, false, initial.path)
      else { const recovery = await window.desktop.readRecovery(); if (recovery) this.update({ recovery }) }
      this.autosave = setInterval(() => { void this.recover() }, 20000)
    } catch (error) { this.update({ error: String(error instanceof Error ? error.message : error), status: 'Studio could not start' }) }
  }
  async bytes(): Promise<Uint8Array> { return encode(await this.engine.snapshot(this.state.title, this.state.activeId)) }
  private async recover(): Promise<void> {
    if (!this.state.ready || this.state.busy || !this.state.dirty || this.revision === this.lastRecoveredRevision) return
    const revision = this.revision
    try { const data = await this.bytes(); await window.desktop.writeRecovery(data); this.lastRecoveredRevision = revision }
    catch (error) { this.notify(`Recovery could not be saved: ${error instanceof Error ? error.message : error}`) }
  }
  async recoveryAction(restore: boolean): Promise<void> {
    const data = this.state.recovery
    if (!restore) { await window.desktop.clearRecovery(); this.update({ recovery: null }); return }
    if (data) await this.loadBytes(data, true)
    this.update({ recovery: null })
  }
  async operation(label: string, action: () => void | Promise<void>, undo = true): Promise<void> {
    if (this.state.busy || !this.state.ready) return
    this.update({ busy: true })
    const release = this.engine.hold()
    let before: Uint8Array | null = null
    try {
      before = undo ? await this.bytes() : null
      await action()
      if (before) { this.history.push({ label, bytes: before }); this.markDirty() }
      this.sync(); this.notify(label)
    } catch (error) {
      if (before && !this.state.error) {
        try {
          const original = await decode(before); await this.engine.restore(original)
          this.update({ activeId: original.activeId, title: original.title }); this.sync()
        } catch { /* A lost GPU cannot be restored in-place; recovery remains on disk. */ }
      }
      this.update({ error: error instanceof Error ? error.message : String(error) })
    }
    finally { release(); this.update({ busy: false }); this.engine.render() }
  }
  setBrush(update: Partial<BrushSettings>): void { this.update({ brush: { ...this.state.brush, ...update } }) }
  selectTool(tool: Tool): void { this.setBrush({ tool }) }
  selectPreset(preset: Preset): void {
    const properties = preset === 'wash' ? { size: 160, water: .92, pigment: .34, softness: .9 } : preset === 'dry' ? { size: 44, water: .09, pigment: .72, softness: .35 } : { size: 70, water: .68, pigment: .52, softness: .72 }
    this.setBrush({ preset, tool: 'brush', ...properties })
  }
  selectLayer(id: string): void { if (!this.state.busy) this.update({ activeId: id }) }
  async addLayer(): Promise<void> { await this.operation('New watercolor layer', () => { const meta = this.engine.addLayer(); this.update({ activeId: meta.id }) }) }
  async deleteLayer(id: string): Promise<void> { await this.operation('Layer removed', () => { this.engine.removeLayer(id); this.update({ activeId: this.engine.metadata.at(-1)!.id }) }) }
  async duplicateLayer(id: string): Promise<void> { await this.operation('Layer duplicated', async () => { const meta = await this.engine.duplicate(id); this.update({ activeId: meta.id }) }) }
  async updateLayer(id: string, change: Partial<Omit<LayerMeta, 'id' | 'kind'>>): Promise<void> { await this.operation('Layer updated', () => this.engine.updateLayer(id, change)) }
  async reorderLayer(id: string, direction: number): Promise<void> { await this.operation('Layer moved', () => this.engine.reorderLayer(id, direction)) }
  async dryLayer(): Promise<void> { await this.operation('Layer dried', () => this.engine.dry(this.state.activeId)) }
  togglePause(): void { this.engine.paused = !this.engine.paused; this.sync(); this.notify(this.engine.paused ? 'Drying paused. Take your time.' : 'Water is moving again.') }

  beginStroke(sample: BrushSample): void {
    if (this.state.busy || !this.state.ready || this.state.error) return
    const meta = this.state.layers.find(l => l.id === this.state.activeId)
    if (!meta || meta.locked || !meta.visible || meta.kind !== 'paint') { this.notify('Choose an unlocked, visible watercolor layer to paint.'); return }
    const settings = { ...this.state.brush }
    const stroke: ActiveStroke = { sampler: new StrokeSampler(Math.max(.65, settings.size * .1)), settings, layerId: meta.id, pending: [sample], started: false, ended: false }
    this.stroke = stroke; this.update({ busy: true })
    const capture = async (): Promise<void> => {
      try {
        const snapshot = await this.engine.snapshot(this.state.title, this.state.activeId)
        stroke.checkpoint = encode(snapshot)
        stroke.started = true
        // History navigation pauses time; the next mark resumes it.
        if (this.resumeOnStroke) { this.engine.paused = false; this.resumeOnStroke = false; this.sync() }
        this.consume(stroke)
        if (stroke.ended) await this.finishStroke(stroke)
      } catch (error) { this.stroke = null; this.update({ busy: false, error: String(error) }) }
    }
    void capture()
  }
  moveStroke(sample: BrushSample): void {
    const stroke = this.stroke; if (!stroke || stroke.ended) return
    stroke.pending.push(sample); if (stroke.started) this.consume(stroke)
  }
  endStroke(): void {
    const stroke = this.stroke; if (!stroke || stroke.ended) return
    stroke.ended = true; if (stroke.started) void this.finishStroke(stroke)
  }
  private consume(stroke: ActiveStroke): void {
    for (const sample of stroke.pending.splice(0)) for (const dab of stroke.sampler.push(sample)) this.engine.dab(stroke.layerId, dab, stroke.settings)
  }
  private async finishStroke(stroke: ActiveStroke): Promise<void> {
    try {
      this.consume(stroke)
      const checkpoint = await stroke.checkpoint!
      this.history.push({ label: stroke.settings.tool === 'brush' ? 'Brush stroke' : stroke.settings.tool, bytes: checkpoint })
      this.markDirty(); this.sync()
    } catch (error) { this.update({ error: String(error) }) }
    finally { this.stroke = null; this.update({ busy: false, status: 'Let the colors find each other.' }) }
  }
  private resumeOnStroke = false
  async travel(redo: boolean): Promise<void> {
    if (redo ? !this.history.canRedo : !this.history.canUndo) return
    await this.operation(redo ? 'Redo' : 'Undo', async () => {
      const current = await this.bytes(), target = redo ? this.history.redo(current) : this.history.undo(current)
      if (!target) return
      const document = await decode(target.bytes); await this.engine.restore(document)
      this.engine.paused = true; this.resumeOnStroke = true
      this.update({ title: document.title, activeId: document.activeId }); this.markDirty()
    }, false)
  }
  async newDocument(width: number, height: number): Promise<void> {
    await this.operation('A fresh sheet, just for you.', async () => {
      this.engine.reset(width, height); const meta = this.engine.addLayer({ name: 'First wash' })
      this.engine.paused = false; this.history.clear(); this.resumeOnStroke = false
      this.update({ title: 'Untitled study', activeId: meta.id }); this.clean()
      await window.desktop.resetProjectPath(); await window.desktop.clearRecovery()
    }, false)
  }
  async save(saveAs = false): Promise<boolean> {
    if (this.state.busy) return false
    let saved = false
    await this.operation('Painting saved', async () => {
      const result = await window.desktop.saveProject(await this.bytes(), saveAs)
      if (!result.canceled) {
        const title = result.path!.split(/[\\/]/).pop()!.replace(/\.waterpaint$/i, '')
        this.update({ title }); this.clean(); await window.desktop.clearRecovery(); saved = true
      } else this.notify('Save canceled')
    }, false)
    if (!saved) this.notify('Save canceled')
    return saved
  }
  async open(): Promise<void> {
    if (this.state.busy) return
    const result = await window.desktop.openProject()
    if (result.canceled || !result.bytes) return
    await this.loadBytes(result.bytes, false, result.path)
  }
  async loadBytes(bytes: Uint8Array, recovery: boolean, path?: string): Promise<void> {
    await this.operation(recovery ? 'Recovered your painting' : 'Painting opened', async () => {
      // Decode and validate fully before replacing the current document.
      const document = await decode(bytes)
      await this.engine.restore(document); this.history.clear(); this.engine.paused = true; this.resumeOnStroke = true
      this.update({ activeId: document.activeId, title: path ? path.split(/[\\/]/).pop()!.replace(/\.waterpaint$/i, '') : document.title })
      if (recovery) { await window.desktop.resetProjectPath(); this.markDirty() }
      else { await window.desktop.adoptOpenedProject(); this.clean(); await window.desktop.clearRecovery() }
    }, false)
  }
  async export(paper: boolean): Promise<void> {
    let canceled = false
    await this.operation('PNG exported', async () => { const result = await window.desktop.exportPng(await this.engine.exportPNG(paper)); canceled = result.canceled }, false)
    if (canceled) this.notify('Export canceled')
  }
  async importRaster(png: Uint8Array, name: string): Promise<void> {
    await this.operation('Image imported', async () => {
      const layer = this.engine.addLayer({ kind: 'raster', name: name.slice(0, 100) }); await this.engine.setRaster(layer.id, png)
      this.update({ activeId: layer.id })
    })
  }
  async pick(x: number, y: number): Promise<void> { this.setBrush({ color: await this.engine.sampleColor(x, y), tool: 'brush' }) }
  dispose(): void { if (this.autosave) clearInterval(this.autosave); this.engine.dispose(); this.listeners.clear() }
}
