import { _electron as electron } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
const env = { ...process.env, WATERPAINT_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: ['.'], env })
try {
  const page = await app.firstWindow()
  const svg = await readFile('resources/icon.svg', 'utf8')
  const png = Buffer.from(await page.evaluate(async svg => {
    const image = new Image()
    image.src = 'data:image/svg+xml;base64,' + btoa(svg)
    await image.decode()
    const canvas = new OffscreenCanvas(256,256)
    canvas.getContext('2d').drawImage(image,0,0)
    return Array.from(new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()))
  }, svg))
  await writeFile('resources/icon.png', png)
  const ico = Buffer.alloc(22)
  ico.writeUInt16LE(1,2); ico.writeUInt16LE(1,4)
  ico.writeUInt16LE(1,10); ico.writeUInt16LE(32,12)
  ico.writeUInt32LE(png.length,14); ico.writeUInt32LE(22,18)
  await writeFile('resources/icon.ico', Buffer.concat([ico,png]))
  console.log('Generated app icons from resources/icon.svg')
} finally { await app.evaluate(({app}) => app.exit(0)) }
