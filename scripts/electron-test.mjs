import { _electron as electron } from '@playwright/test'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'

await mkdir('test-results', { recursive: true })
const report = { date: new Date().toISOString(), checks: [], metrics: {} }
const check = (name, condition, details) => { assert.ok(condition, `${name}: ${JSON.stringify(details)}`); report.checks.push({ name, passed: true, details }); console.log(`PASS ${name}`) }
let app
try {
  const launchEnv = { ...process.env, WATERPAINT_TEST: '1' }
  delete launchEnv.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ args: ['.'], env: launchEnv, timeout: 90000 })
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') console.log('Renderer:', message.text()) })
  await page.waitForFunction(() => window.__waterpaint?.state.ready || window.__waterpaint?.state.error, { timeout: 90000 })
  const initial = await page.evaluate(() => ({ ready: window.__waterpaint.state.ready, error: window.__waterpaint.state.error, gpu: window.__waterpaint.engine.gpuName }))
  check('WebGPU initialized with valid shaders', initial.ready && !initial.error, initial)
  report.metrics.gpu = initial.gpu
  report.metrics.hardware = await app.evaluate(async ({ app }) => {
    const gpu = await app.getGPUInfo('complete')
    return { gpuDevice: gpu.gpuDevice, renderer: gpu.auxAttributes?.glRenderer }
  })
  await page.screenshot({ path: 'test-results/studio-blank.png' })
  await page.evaluate(async () => {
    const s = window.__waterpaint; s.engine.paused = true
    await s.newDocument(512, 384); s.engine.paused = true
  })
  const engineResult = await page.evaluate(async () => {
    const s = window.__waterpaint, e = s.engine, id = s.state.activeId
    const brush = { ...s.state.brush, size: 95, water: .85, pigment: .7, softness: .72, color: '#f5d62a', tool: 'brush' }
    for (let x = 70; x <= 350; x += 8) e.dab(id, { x, y: 165, pressure: 1 }, brush)
    brush.color = '#2461b0'
    for (let y = 60; y <= 285; y += 8) e.dab(id, { x: 225, y, pressure: 1 }, brush)
    const before = await e.snapshot('Fixture', id)
    e.step(240); e.render(); await e.settled()
    const after = await e.snapshot('Fixture', id)
    const pixels = await e.pixels(true)
    const pixel = (x, y) => Array.from(pixels.slice((y * 512 + x) * 4, (y * 512 + x) * 4 + 4))
    const values = new Float32Array(after.layers[0].state.buffer)
    let mobile = 0, dry = 0, water = 0
    for (let i = 0; i < values.length; i += 20) { water += values[i + 16]; mobile += values[i + 17]; dry += values[i + 18] }
    const old = new Float32Array(before.layers[0].state.buffer)
    let oldMass = 0; for (let i = 0; i < old.length; i += 20) oldMass += old[i + 17] + old[i + 18]
    window.__testWet = after
    return { center: pixel(225, 165), yellow: pixel(110,165), blue: pixel(225,85), finite: values.every(Number.isFinite), massError: Math.abs(mobile + dry - oldMass) / oldMass, water, mobile, dry }
  })
  check('Wet yellow and blue produce a green overlap', engineResult.center[1] > engineResult.center[0] && engineResult.center[1] > engineResult.center[2], engineResult)
  check('Conservative pigment transport stays finite', engineResult.finite && engineResult.massError < .005, engineResult)
  await page.evaluate(async () => { const s = window.__waterpaint; await s.updateLayer(s.state.activeId, { name: 'Wet overlap study' }) })
  await page.screenshot({ path: 'test-results/wet-overlap.png' })
  const dryResult = await page.evaluate(async () => {
    const s = window.__waterpaint, e = s.engine, id = s.state.activeId
    e.dry(id)
    const dry = await e.snapshot('Dry', id); e.step(120)
    const stable = await e.snapshot('Dry', id)
    const a = dry.layers[0].state, b = stable.layers[0].state
    const values = new Float32Array(a.buffer)
    let water = 0, mobile = 0
    for (let i = 0; i < values.length; i += 20) { water += values[i + 16]; mobile += values[i + 17] }
    const brush = { ...s.state.brush, tool: 'water', water: 1, size: 90 }
    for (let i = 0; i < 5; i++) e.dab(id, { x: 225, y: 165, pressure: 1 }, brush)
    e.step(180)
    const rewetted = await e.snapshot('Rewet', id), wetValues = new Float32Array(rewetted.layers[0].state.buffer)
    let suspended = 0; for (let i = 17; i < wetValues.length; i += 20) suspended += wetValues[i]
    return { stable: a.length === b.length && a.every((n, i) => n === b[i]), water, mobile, suspended }
  })
  check('Dry layer stops water and pigment movement', dryResult.stable && dryResult.water === 0 && dryResult.mobile === 0, dryResult)
  check('Clean water reactivates part of a dry stain', dryResult.suspended > 0, dryResult)
  const persistence = await page.evaluate(async () => {
    const s = window.__waterpaint, e = s.engine
    e.paused = true; e.render()
    const original = await e.pixels(false), project = await s.bytes()
    window.__testProject = project
    await s.newDocument(64,64); await s.loadBytes(project, true)
    const restored = await e.pixels(false)
    return { byteLength: project.length, same: original.length === restored.length && original.every((v,i) => v === restored[i]), size: [e.width,e.height] }
  })
  check('Saved wet project restores an identical image', persistence.same && persistence.size[0] === 512, persistence)
  const layerResult = await page.evaluate(async () => {
    const s = window.__waterpaint, e = s.engine, base = s.state.activeId
    const before = await e.snapshot('Layers', base)
    await s.addLayer(); const top = s.state.activeId
    e.dab(top, { x: 225, y: 165, pressure: 1 }, { ...s.state.brush, color: '#c96553', size: 150 })
    const after = await e.snapshot('Layers', top)
    const unchanged = before.layers[0].state.every((v,i) => v === after.layers[0].state[i])
    await s.updateLayer(top, { locked: true })
    const a = await e.snapshot('Lock', top)
    e.dab(top, { x: 110, y: 50, pressure: 1 }, s.state.brush)
    const b = await e.snapshot('Lock', top)
    await s.travel(false); const unlocked = !s.state.layers.find(l => l.id === top).locked
    await s.travel(true); const relocked = s.state.layers.find(l => l.id === top).locked
    return { unchanged, lockedUnchanged: a.layers[1].state.every((v,i) => v === b.layers[1].state[i]), unlocked, relocked, paused: e.paused }
  })
  check('Paint remains isolated between layers', layerResult.unchanged, layerResult)
  check('Locked layers reject painting; undo/redo restore layer state', layerResult.lockedUnchanged && layerResult.unlocked && layerResult.relocked && layerResult.paused, layerResult)

  // Use the actual pointer path and toolbar for the interaction check.
  await page.evaluate(async () => { const s = window.__waterpaint; await s.newDocument(512,384); s.engine.paused = true })
  const canvas = page.getByTestId('painting-canvas'), rect = await canvas.boundingBox()
  await page.mouse.move(rect.x + rect.width * .2, rect.y + rect.height * .45)
  await page.mouse.down()
  await page.mouse.move(rect.x + rect.width * .8, rect.y + rect.height * .5, { steps: 16 })
  await page.mouse.up()
  await page.waitForFunction(() => !window.__waterpaint.state.busy && window.__waterpaint.state.canUndo)
  const pointerResult = await page.evaluate(async () => {
    const s = window.__waterpaint, before = await s.engine.snapshot('Before undo', s.state.activeId)
    await s.travel(false)
    const undone = await s.engine.snapshot('Undo', s.state.activeId)
    await s.travel(true)
    const redone = await s.engine.snapshot('Redo', s.state.activeId)
    return { painted: before.layers[0].state.length > 0, blank: undone.layers[0].state.length === 0, exact: before.layers[0].state.every((v,i) => v === redone.layers[0].state[i]) }
  })
  check('Real pointer painting and exact wet-state undo/redo', pointerResult.painted && pointerResult.blank && pointerResult.exact, pointerResult)

  // Native dialogs are stubbed only in this automated test process.
  const projectPath = path.resolve('test-results/native-save.waterpaint'), pngPath = path.resolve('test-results/export.png')
  await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }) }, projectPath)
  await page.evaluate(async () => { await window.__waterpaint.save(true) })
  check('Native project save writes a ZIP document', (await readFile(projectPath))[0] === 80)
  await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }) }, pngPath)
  await page.evaluate(async () => { await window.__waterpaint.export(false) })
  const png = await readFile(pngPath)
  check('Transparent PNG export writes a PNG', png[0] === 137 && png[1] === 80)
  const alphaResult = await page.evaluate(async () => {
    const e = window.__waterpaint.engine, id = window.__waterpaint.state.activeId
    const full = await e.pixels(false)
    e.updateLayer(id, { opacity: .5 })
    const half = await e.pixels(false)
    e.updateLayer(id, { opacity: 1 })
    const paper = await e.pixels(true)
    let maxFull = 0, maxHalf = 0
    for (let i = 3; i < full.length; i += 4) { maxFull = Math.max(maxFull, full[i]); maxHalf = Math.max(maxHalf, half[i]) }
    return { corner: full[3], paperCorner: paper[3], maxFull, maxHalf }
  })
  check('Export preserves transparency and layer opacity', alphaResult.corner === 0 && alphaResult.paperCorner === 255 && Math.abs(alphaResult.maxFull / 2 - alphaResult.maxHalf) <= 1, alphaResult)
  await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }) }, pngPath)
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: /Import image/ }).click()
  await page.getByRole('dialog').waitFor()
  await page.getByRole('slider', { name: 'Image scale' }).fill('75')
  await page.getByRole('button', { name: 'Import image', exact: true }).click()
  await page.waitForFunction(() => !window.__waterpaint.state.busy && window.__waterpaint.state.layers.length === 2)
  check('Native image import and placement create a raster layer', await page.evaluate(() => window.__waterpaint.state.layers.at(-1).kind === 'raster'))
  const rasterRoundTrip = await page.evaluate(async () => {
    const s = window.__waterpaint, before = await s.engine.pixels(false), data = await s.bytes()
    await s.loadBytes(data, true)
    const after = await s.engine.pixels(false)
    return before.every((v,i) => v === after[i])
  })
  check('Raster and watercolor layers survive project round trip', rasterRoundTrip)
  await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }) }, projectPath)
  await page.evaluate(async () => { await window.__waterpaint.newDocument(64,64); await window.__waterpaint.open() })
  check('Native open restores dimensions and paint', await page.evaluate(() => window.__waterpaint.engine.width === 512 && window.__waterpaint.state.layers.length === 1))
  await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }) })
  check('Canceled save is handled', await page.evaluate(async () => !(await window.__waterpaint.save(true))))
  const malformed = await page.evaluate(async () => {
    const s = window.__waterpaint, width = s.engine.width, id = s.state.activeId
    await s.loadBytes(new Uint8Array([1,2,3]), false)
    const retained = s.engine.width === width && s.state.activeId === id && !!s.state.error
    s.clearError(); return retained
  })
  check('Malformed project leaves the current painting intact', malformed)
  const recovery = await page.evaluate(async () => { const data = await window.__waterpaint.bytes(); await window.desktop.writeRecovery(data); const saved = await window.desktop.readRecovery(); return data.length === saved.length && data.every((v,i) => v === saved[i]) })
  check('Recovery preserves the complete document', recovery)

  // Maximum document size benchmark, with one localized wet wash.
  const performanceResult = await page.evaluate(async () => {
    const s = window.__waterpaint, e = s.engine
    await s.newDocument(2048,2048); e.paused = true
    const id = s.state.activeId, brush = { ...s.state.brush, size: 150, water: .8 }
    for (let x = 400; x < 1400; x += 20) e.dab(id, { x, y: 950 + Math.sin(x / 160) * 100, pressure: .7 }, brush)
    await e.settled()
    const times = []
    for (let frame = 0; frame < 40; frame++) {
      const started = performance.now(); e.step(); e.render(); await e.settled(); times.push(performance.now() - started)
    }
    times.sort((a,b) => a-b)
    return { medianMs: times[Math.floor(times.length / 2)], p95Ms: times[Math.floor(times.length * .95)], grid: `${e.gridWidth}x${e.gridHeight}`, gpu: e.gpuName }
  })
  report.metrics.maximumCanvas = performanceResult
  console.log('PERFORMANCE', JSON.stringify(performanceResult))
  await page.screenshot({ path: 'test-results/studio-painted.png' })
  const finalError = await page.evaluate(() => window.__waterpaint.state.error)
  check('No renderer or WebGPU validation errors', errors.length === 0 && !finalError, { errors, finalError })
  await page.evaluate(async () => {
    const s = window.__waterpaint, data = await s.bytes()
    await window.desktop.writeRecovery(data)
    s.engine.device.destroy()
  })
  await page.waitForFunction(() => window.__waterpaint.state.error?.includes('graphics device was lost'))
  check('GPU loss stops the engine and offers reload', await page.getByRole('button', { name: 'Reload studio', exact: true }).isVisible())
  await page.getByRole('button', { name: 'Reload studio', exact: true }).click()
  await page.getByRole('button', { name: 'Restore painting', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Restore painting', exact: true }).click()
  await page.waitForFunction(() => window.__waterpaint.state.ready && !window.__waterpaint.state.busy && window.__waterpaint.engine.width === 2048)
  check('Reload recovers artwork after device loss', await page.evaluate(() => window.__waterpaint.state.hasArtwork && !window.__waterpaint.state.error))
  await page.evaluate(async () => { await window.desktop.clearRecovery(); window.desktop.setDirty(false) })
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined }))
  await page.reload()
  await page.waitForFunction(() => window.__waterpaint?.state.error)
  check('Unsupported GPU is explained before painting is enabled', await page.evaluate(() => !window.__waterpaint.state.ready && window.__waterpaint.state.error.includes('WebGPU')))
} catch (error) {
  report.error = error.stack || String(error)
  console.error(error)
  if (app) { try { await (await app.firstWindow()).screenshot({ path: 'test-results/failure.png' }) } catch {} }
  process.exitCode = 1
} finally {
  await writeFile('test-results/electron-report.json', JSON.stringify(report, null, 2))
  if (app) { try { await app.evaluate(({ app }) => app.exit(0)) } catch {} }
}
