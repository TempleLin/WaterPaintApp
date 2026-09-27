import type { BrushSample, BrushSettings, DocumentSnapshot, LayerMeta, LayerSnapshot, Rect } from '../shared/types'
import { MAX_LAYERS, MAX_SIZE } from '../shared/types'
import { pigmentKS } from './spectral'
import { computeShader, rasterShader, renderShader } from './shaders'

export const CELL_BYTES = 80
export const SIMULATION_MAX = 1024
export function simulationSize(width: number, height: number): [number, number] {
  const ratio = Math.min(1, SIMULATION_MAX / Math.max(width, height))
  return [Math.ceil(width * ratio), Math.ceil(height * ratio)]
}
function union(a: Rect | null, b: Rect): Rect {
  if (!a) return b
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}
interface PaintLayer {
  meta: LayerMeta; buffer: GPUBuffer; uniform: GPUBuffer; texture: GPUTexture;
  renderGroup: GPUBindGroup; compositeGroup: GPUBindGroup; computeGroup: GPUBindGroup;
  bounds: Rect | null; wetUntil: number; dirty: boolean; raster?: Uint8Array
}
export interface EngineStats { fps: number; frameMs: number; wetLayers: number; gpu: string; simulation: string }

export class WatercolorEngine {
  private device!: GPUDevice
  private context!: GPUCanvasContext
  private format!: GPUTextureFormat
  private scratch!: GPUBuffer
  private computeUniform!: GPUBuffer
  private computeLayout!: GPUBindGroupLayout
  private paintLayout!: GPUBindGroupLayout
  private compositeLayout!: GPUBindGroupLayout
  private paintPipeline!: GPURenderPipeline
  private paperPipeline!: GPURenderPipeline
  private compositePipeline!: GPURenderPipeline
  private compute = {} as Record<'deposit' | 'simulate' | 'commit' | 'dry', GPUComputePipeline>
  private sampler!: GPUSampler
  private layers: PaintLayer[] = []
  private frame = 0
  private previousTime = 0
  private accumulator = 0
  private needsRender = true
  private disposed = false
  private held = 0
  private statsAt = 0
  private frames = 0
  private frameCosts: number[] = []
  width = 1536; height = 1024; seed = 12763; tick = 0
  gridWidth = 768; gridHeight = 512
  paused = false
  paper = true
  gpuName = ''
  onError: (message: string) => void = () => {}
  onStats: (stats: EngineStats) => void = () => {}
  onEvolution: () => void = () => {}
  constructor(private canvas: HTMLCanvasElement) {}

  async initialize(): Promise<void> {
    if (!navigator.gpu) throw new Error('WebGPU is unavailable. WaterPaint needs a WebGPU-capable graphics card and an up-to-date graphics driver.')
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('No compatible WebGPU graphics adapter was found. Update your graphics driver, then reload WaterPaint.')
    this.gpuName = [adapter.info.vendor, adapter.info.device, adapter.info.description].filter(Boolean).join(' · ') || 'WebGPU adapter'
    this.device = await adapter.requestDevice()
    this.device.lost.then(info => { if (!this.disposed) { this.stop(); this.onError(`The graphics device was lost: ${info.message || info.reason}. Reload to restore the latest recovery snapshot.`) } })
    this.device.addEventListener('uncapturederror', (e: GPUUncapturedErrorEvent) => { this.stop(); this.onError(e.error.message) })
    this.context = this.canvas.getContext('webgpu')!
    this.format = navigator.gpu.getPreferredCanvasFormat()
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' })
    this.computeLayout = this.device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }
    ] })
    this.paintLayout = this.device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }
    ] })
    this.compositeLayout = this.device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }
    ] })
    const module = this.device.createShaderModule({ code: computeShader })
    const renderModule = this.device.createShaderModule({ code: renderShader })
    const rasterModule = this.device.createShaderModule({ code: rasterShader })
    for (const shader of [module, renderModule, rasterModule]) {
      const info = await shader.getCompilationInfo()
      const errors = info.messages.filter(m => m.type === 'error')
      if (errors.length) throw new Error(errors.map(m => `${m.lineNum}: ${m.message}`).join('\n'))
    }
    const layout = this.device.createPipelineLayout({ bindGroupLayouts: [this.computeLayout] })
    for (const entry of ['deposit', 'simulate', 'commit', 'dry'] as const) {
      this.compute[entry] = await this.device.createComputePipelineAsync({ layout, compute: { module, entryPoint: entry } })
    }
    const blend: GPUBlendState = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } }
    const paintLayout = this.device.createPipelineLayout({ bindGroupLayouts: [this.paintLayout] })
    this.paintPipeline = await this.device.createRenderPipelineAsync({ layout: paintLayout,
      vertex: { module: renderModule, entryPoint: 'vert' }, fragment: { module: renderModule, entryPoint: 'frag', targets: [{ format: 'rgba8unorm' }] } })
    this.paperPipeline = await this.device.createRenderPipelineAsync({ layout: paintLayout,
      vertex: { module: renderModule, entryPoint: 'vert' }, fragment: { module: renderModule, entryPoint: 'paper', targets: [{ format: this.format }] } })
    this.compositePipeline = await this.device.createRenderPipelineAsync({ layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.compositeLayout] }),
      vertex: { module: rasterModule, entryPoint: 'vert' }, fragment: { module: rasterModule, entryPoint: 'frag', targets: [{ format: this.format, blend }] } })
    this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    this.computeUniform = this.device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.reset(1536, 1024)
    this.loop(performance.now())
  }

  reset(width: number, height: number, seed = Math.floor(Math.random() * 100000)): void {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64 || width > MAX_SIZE || height > MAX_SIZE) throw new Error('Canvas dimensions must be 64–2048 pixels.')
    this.layers.forEach(l => this.destroyLayer(l)); this.layers = []
    this.scratch?.destroy()
    this.width = width; this.height = height; this.seed = seed; this.tick = 0
    ;[this.gridWidth, this.gridHeight] = simulationSize(width, height)
    this.canvas.width = width; this.canvas.height = height
    this.scratch = this.device.createBuffer({ size: this.byteSize, usage: GPUBufferUsage.STORAGE })
    this.accumulator = 0; this.needsRender = true
  }
  private get byteSize(): number { return this.gridWidth * this.gridHeight * CELL_BYTES }
  get metadata(): LayerMeta[] { return this.layers.map(l => ({ ...l.meta })) }
  get hasArtwork(): boolean { return this.layers.some(l => l.bounds !== null || !!l.raster) }
  get wetCount(): number { return this.layers.filter(l => l.wetUntil > this.tick).length }
  get busy(): boolean { return this.held > 0 }
  hold(): () => void { this.held++; return () => { this.held--; this.previousTime = performance.now() } }

  addLayer(meta?: Partial<LayerMeta>): LayerMeta {
    if (this.layers.length >= MAX_LAYERS) throw new Error('This canvas already has eight layers.')
    const layerMeta: LayerMeta = { id: crypto.randomUUID(), name: `Wash ${this.layers.length + 1}`, kind: 'paint', visible: true, locked: false, opacity: 1, ...meta }
    const buffer = this.device.createBuffer({ size: layerMeta.kind === 'paint' ? this.byteSize : CELL_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST })
    const uniform = this.device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    const texture = this.device.createTexture({ size: [this.width, this.height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
    const renderGroup = this.device.createBindGroup({ layout: this.paintLayout, entries: [ { binding: 0, resource: { buffer } }, { binding: 1, resource: { buffer: uniform } } ] })
    // Composite opacity occupies the first float of a dedicated buffer; the
    // remaining render parameters are at byte 16 to avoid aliasing uniforms.
    const compositeGroup = this.device.createBindGroup({ layout: this.compositeLayout, entries: [ { binding: 0, resource: texture.createView() }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: uniform, offset: 0, size: 16 } } ] })
    const computeGroup = this.device.createBindGroup({ layout: this.computeLayout, entries: [ { binding: 0, resource: { buffer } }, { binding: 1, resource: { buffer: this.scratch } }, { binding: 2, resource: { buffer: this.computeUniform } } ] })
    this.layers.push({ meta: layerMeta, buffer, uniform, texture, renderGroup, compositeGroup, computeGroup, bounds: null, wetUntil: 0, dirty: true })
    this.needsRender = true
    return { ...layerMeta }
  }
  private layer(id: string): PaintLayer {
    const layer = this.layers.find(l => l.meta.id === id)
    if (!layer) throw new Error('The selected layer no longer exists.')
    return layer
  }
  updateLayer(id: string, update: Partial<Omit<LayerMeta, 'id' | 'kind'>>): void {
    Object.assign(this.layer(id).meta, update); this.needsRender = true
  }
  reorderLayer(id: string, direction: number): void {
    const index = this.layers.findIndex(l => l.meta.id === id), target = Math.max(0, Math.min(this.layers.length - 1, index + direction))
    if (index < 0) return
    const [layer] = this.layers.splice(index, 1); this.layers.splice(target, 0, layer); this.needsRender = true
  }
  removeLayer(id: string): void {
    if (this.layers.length <= 1) throw new Error('Keep at least one layer in the document.')
    this.destroyLayer(this.layer(id)); this.layers = this.layers.filter(l => l.meta.id !== id); this.needsRender = true
  }
  private destroyLayer(l: PaintLayer): void { l.buffer.destroy(); l.uniform.destroy(); l.texture.destroy() }

  private params(bounds: Rect, mode = 0, sample?: BrushSample, settings?: BrushSettings, dt = 1 / 60): ArrayBuffer {
    const data = new ArrayBuffer(112), u = new Uint32Array(data), f = new Float32Array(data)
    u.set([this.gridWidth, this.gridHeight, bounds.x, bounds.y, bounds.width, bounds.height, mode, this.seed])
    if (sample && settings) {
      f.set([sample.x * this.gridWidth / this.width, sample.y * this.gridHeight / this.height, settings.size * .5 * this.gridWidth / this.width, sample.pressure], 8)
      f.set([settings.water, settings.pigment, settings.softness, settings.preset === 'dry' ? .88 : 0], 12)
      f.set(pigmentKS(settings.color), 16)
    }
    f.set([dt, 1, this.width, this.height], 24)
    return data
  }
  private region(x: number, y: number, radius: number): Rect {
    const left = Math.max(0, Math.floor(x - radius)), top = Math.max(0, Math.floor(y - radius))
    return { x: left, y: top, width: Math.max(0, Math.min(this.gridWidth, Math.ceil(x + radius)) - left), height: Math.max(0, Math.min(this.gridHeight, Math.ceil(y + radius)) - top) }
  }
  dab(id: string, sample: BrushSample, settings: BrushSettings): void {
    const l = this.layer(id)
    if (l.meta.kind !== 'paint' || l.meta.locked || !l.meta.visible) return
    const scale = this.gridWidth / this.width, x = sample.x * scale, y = sample.y * scale, radius = settings.size * .5 * scale + 2
    const bounds = this.region(x, y, radius)
    if (!bounds.width || !bounds.height) return
    l.bounds = union(l.bounds, this.region(x, y, radius + 36))
    const mode = settings.tool === 'water' ? 1 : settings.tool === 'lift' ? 2 : settings.tool === 'eraser' ? 3 : 0
    this.device.queue.writeBuffer(this.computeUniform, 0, this.params(bounds, mode, sample, settings))
    this.dispatch(l, bounds, ['deposit'])
    l.wetUntil = this.tick + 3600; l.dirty = true; this.needsRender = true
  }
  private dispatch(l: PaintLayer, bounds: Rect, entries: ('deposit' | 'simulate' | 'commit' | 'dry')[]): void {
    const encoder = this.device.createCommandEncoder()
    // Separate passes form the storage barrier between simulation and commit.
    for (const entry of entries) {
      const pass = encoder.beginComputePass(); pass.setPipeline(this.compute[entry]); pass.setBindGroup(0, l.computeGroup)
      pass.dispatchWorkgroups(Math.ceil(bounds.width / 8), Math.ceil(bounds.height / 8)); pass.end()
    }
    this.device.queue.submit([encoder.finish()])
  }
  dry(id: string): void {
    const l = this.layer(id)
    if (l.meta.kind !== 'paint' || !l.bounds || l.meta.locked) return
    this.device.queue.writeBuffer(this.computeUniform, 0, this.params(l.bounds))
    this.dispatch(l, l.bounds, ['dry']); l.wetUntil = 0; l.dirty = true; this.needsRender = true
  }
  step(count = 1): void {
    for (let n = 0; n < count; n++) {
      this.tick++
      for (const l of this.layers) {
        if (l.meta.kind !== 'paint' || !l.bounds || l.wetUntil < this.tick) continue
        this.device.queue.writeBuffer(this.computeUniform, 0, this.params(l.bounds))
        this.dispatch(l, l.bounds, this.tick === l.wetUntil ? ['dry'] : ['simulate', 'commit'])
        l.dirty = true; this.needsRender = true
      }
    }
  }
  private loop = (now: number): void => {
    if (this.disposed) return
    this.frame = requestAnimationFrame(this.loop)
    const elapsed = this.previousTime ? Math.min(.066, (now - this.previousTime) / 1000) : 0
    this.previousTime = now
    if (document.hidden || this.held) return
    const start = performance.now()
    if (!this.paused && this.wetCount > 0) {
      this.accumulator += elapsed
      const steps = Math.min(4, Math.floor(this.accumulator * 60))
      if (steps) { this.step(steps); this.accumulator -= steps / 60; this.onEvolution() }
    } else this.accumulator = 0
    if (this.needsRender) this.render()
    this.frameCosts.push(performance.now() - start); this.frames++
    if (now - this.statsAt > 1000) {
      this.onStats({ fps: Math.min(240, Math.round(this.frames * 1000 / Math.max(1, now - this.statsAt))), frameMs: this.frameCosts.reduce((a, b) => a + b, 0) / this.frameCosts.length, wetLayers: this.wetCount, gpu: this.gpuName, simulation: `${this.gridWidth} × ${this.gridHeight}` })
      this.statsAt = now; this.frames = 0; this.frameCosts = []
    }
  }
  render(target?: GPUTextureView, paper = this.paper): void {
    if (!this.layers.length) return
    // Rendering a paint cache and compositing it use distinct submissions:
    // queue.writeBuffer updates occur in order, never overwrite queued params.
    for (const l of this.layers) {
      if (l.dirty && l.meta.kind === 'paint') {
        this.device.queue.writeBuffer(l.uniform, 0, this.params({ x: 0, y: 0, width: this.gridWidth, height: this.gridHeight }))
        const e = this.device.createCommandEncoder(), pass = e.beginRenderPass({ colorAttachments: [{ view: l.texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] })
        pass.setPipeline(this.paintPipeline); pass.setBindGroup(0, l.renderGroup); pass.draw(3); pass.end()
        this.device.queue.submit([e.finish()]); l.dirty = false
      }
    }
    const view = target ?? this.context.getCurrentTexture().createView()
    const bottom = this.layers[0]
    this.device.queue.writeBuffer(bottom.uniform, 0, this.params({ x: 0, y: 0, width: this.gridWidth, height: this.gridHeight }))
    const encoder = this.device.createCommandEncoder(), background = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0,0,0,0] }] })
    if (paper) { background.setPipeline(this.paperPipeline); background.setBindGroup(0, bottom.renderGroup); background.draw(3) }
    background.end(); this.device.queue.submit([encoder.finish()])
    for (const l of this.layers) {
      if (!l.meta.visible) continue
      this.device.queue.writeBuffer(l.uniform, 0, new Float32Array([l.meta.opacity, l.meta.kind === 'paint' ? 1 : 0, 0, 0]))
    }
    const e = this.device.createCommandEncoder(), pass = e.beginRenderPass({ colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }] })
    pass.setPipeline(this.compositePipeline)
    for (const l of this.layers) { if (l.meta.visible) { pass.setBindGroup(0, l.compositeGroup); pass.draw(3) } }
    pass.end(); this.device.queue.submit([e.finish()]); this.needsRender = false
  }
  setPaper(value: boolean): void { this.paper = value; this.needsRender = true }

  async snapshot(title: string, activeId: string): Promise<DocumentSnapshot> {
    const release = this.hold()
    try {
      const layers: LayerSnapshot[] = []
      for (const l of this.layers) {
        let state = new Uint8Array(0)
        if (l.bounds && l.meta.kind === 'paint') {
          const b = l.bounds, rowBytes = b.width * CELL_BYTES
          const read = this.device.createBuffer({ size: rowBytes * b.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
          const encoder = this.device.createCommandEncoder()
          for (let y = 0; y < b.height; y++) encoder.copyBufferToBuffer(l.buffer, ((b.y + y) * this.gridWidth + b.x) * CELL_BYTES, read, y * rowBytes, rowBytes)
          this.device.queue.submit([encoder.finish()]); await read.mapAsync(GPUMapMode.READ)
          state = new Uint8Array(read.getMappedRange().slice(0)); read.unmap(); read.destroy()
        }
        layers.push({ meta: { ...l.meta }, bounds: l.bounds ? { ...l.bounds } : null, wetUntil: l.wetUntil, state, raster: l.raster?.slice() })
      }
      return { version: 1, width: this.width, height: this.height, seed: this.seed, tick: this.tick, title, activeId, layers }
    } finally { release() }
  }
  async restore(snapshot: DocumentSnapshot): Promise<void> {
    const release = this.hold()
    try {
      this.reset(snapshot.width, snapshot.height, snapshot.seed); this.tick = snapshot.tick
      for (const saved of snapshot.layers) {
        this.addLayer(saved.meta)
        const l = this.layer(saved.meta.id); l.bounds = saved.bounds; l.wetUntil = saved.wetUntil
        if (saved.bounds && saved.meta.kind === 'paint') {
          const b = saved.bounds, rowBytes = b.width * CELL_BYTES
          for (let y = 0; y < b.height; y++) this.device.queue.writeBuffer(l.buffer, ((b.y + y) * this.gridWidth + b.x) * CELL_BYTES, saved.state.slice(y * rowBytes, (y + 1) * rowBytes))
        }
        if (saved.raster) await this.setRaster(saved.meta.id, saved.raster)
      }
      this.needsRender = true; this.render()
    } finally { release() }
  }
  async setRaster(id: string, png: Uint8Array): Promise<void> {
    const l = this.layer(id), bitmap = await createImageBitmap(new Blob([png.slice().buffer as ArrayBuffer], { type: 'image/png' }))
    this.device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: l.texture }, [this.width, this.height])
    bitmap.close(); l.raster = png.slice(); l.dirty = false; this.needsRender = true
  }
  async duplicate(id: string): Promise<LayerMeta> {
    const l = this.layer(id), meta = this.addLayer({ ...l.meta, id: crypto.randomUUID(), name: `${l.meta.name} copy` })
    const copy = this.layer(meta.id)
    if (l.meta.kind === 'paint') {
      const e = this.device.createCommandEncoder(); e.copyBufferToBuffer(l.buffer, 0, copy.buffer, 0, this.byteSize); this.device.queue.submit([e.finish()])
    } else if (l.raster) await this.setRaster(meta.id, l.raster)
    copy.bounds = l.bounds ? { ...l.bounds } : null; copy.wetUntil = l.wetUntil; copy.dirty = l.meta.kind === 'paint'
    return meta
  }
  async pixels(paper: boolean): Promise<Uint8ClampedArray<ArrayBuffer>> {
    const release = this.hold()
    try {
      const texture = this.device.createTexture({ size: [this.width, this.height], format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
      this.render(texture.createView(), paper)
      const stride = Math.ceil(this.width * 4 / 256) * 256
      const read = this.device.createBuffer({ size: stride * this.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const encoder = this.device.createCommandEncoder()
      encoder.copyTextureToBuffer({ texture }, { buffer: read, bytesPerRow: stride }, [this.width, this.height])
      this.device.queue.submit([encoder.finish()]); await read.mapAsync(GPUMapMode.READ)
      const bytes = new Uint8Array(read.getMappedRange()), output = new Uint8ClampedArray(this.width * this.height * 4)
      const bgra = this.format.startsWith('bgra')
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          const s = y * stride + x * 4, d = (y * this.width + x) * 4, a = bytes[s + 3]
          // Render targets contain premultiplied RGB; PNG needs straight alpha.
          output[d] = a ? Math.min(255, bytes[s + (bgra ? 2 : 0)] * 255 / a) : 0
          output[d + 1] = a ? Math.min(255, bytes[s + 1] * 255 / a) : 0
          output[d + 2] = a ? Math.min(255, bytes[s + (bgra ? 0 : 2)] * 255 / a) : 0
          output[d + 3] = a
        }
      }
      read.unmap(); read.destroy(); texture.destroy(); this.needsRender = true
      return output
    } finally { release() }
  }
  async exportPNG(paper: boolean): Promise<Uint8Array> {
    const pixels = await this.pixels(paper), canvas = new OffscreenCanvas(this.width, this.height)
    canvas.getContext('2d')!.putImageData(new ImageData(pixels, this.width, this.height), 0, 0)
    return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
  }
  async sampleColor(x: number, y: number): Promise<string> {
    const pixels = await this.pixels(true), i = (Math.max(0, Math.min(this.height - 1, Math.floor(y))) * this.width + Math.max(0, Math.min(this.width - 1, Math.floor(x)))) * 4
    return '#' + Array.from(pixels.slice(i, i + 3)).map(n => n.toString(16).padStart(2, '0')).join('')
  }
  async settled(): Promise<void> { await this.device.queue.onSubmittedWorkDone() }
  stop(): void { cancelAnimationFrame(this.frame) }
  dispose(): void { this.disposed = true; this.stop(); this.layers.forEach(l => this.destroyLayer(l)); this.scratch?.destroy(); this.computeUniform?.destroy(); this.device?.destroy() }
}
