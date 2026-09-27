import { _electron as electron } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
const env = { ...process.env, WATERPAINT_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: path.resolve('release/win-unpacked/WaterPaint.exe'), args: [], env })
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => window.__waterpaint?.state.ready || window.__waterpaint?.state.error)
  const result = await page.evaluate(async () => {
    const s = window.__waterpaint
    if (!s.state.ready || s.state.error) return { ready: false, error: s.state.error }
    await s.newDocument(256,256); s.engine.paused = true
    s.beginStroke({ x: 50, y: 128, pressure: 1 }); s.moveStroke({ x: 200, y: 128, pressure: 1 }); s.endStroke()
    return { ready: true, gpu: s.engine.gpuName, version: '1.0.0' }
  })
  assert.equal(result.ready, true, JSON.stringify(result))
  await page.waitForFunction(() => !window.__waterpaint.state.busy && window.__waterpaint.state.canUndo)
  const bytes = await page.evaluate(async () => (await window.__waterpaint.bytes()).length)
  assert.ok(bytes > 1000)
  await page.screenshot({ path: 'test-results/packaged-app.png' })
  await writeFile('test-results/packaged-report.json', JSON.stringify({ ...result, projectBytes: bytes, passed: true }, null, 2))
  await page.evaluate(async () => { await window.desktop.clearRecovery(); window.desktop.setDirty(false) })
  console.log('PASS Packaged app starts, paints on WebGPU, and serializes a project.')
} finally { await app.evaluate(({app}) => app.exit(0)) }
