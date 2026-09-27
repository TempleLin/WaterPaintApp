// Optional recovery for slow/interrupted GitHub release downloads. Only downloads
// the exact Electron version in node_modules, verifies its published checksum,
// and extracts it into that package's normal runtime directory.
import https from 'node:https'
import { createWriteStream, createReadStream } from 'node:fs'
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
const require = createRequire(import.meta.url)
const { version } = require('electron/package.json')
const filename = `electron-v${version}-win32-x64.zip`
const source = `https://github.com/electron/electron/releases/download/v${version}/${filename}`
const directory = path.resolve('.cache', `electron-${version}`)
await mkdir(directory, { recursive: true })

function request(url, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers: { 'User-Agent': 'WaterPaint-build', ...headers }, timeout: 180000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); resolve(request(new URL(res.headers.location, url), method, headers))
      } else resolve(res)
    })
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('Download timed out'))); req.end()
  })
}
const head = await request(source, 'HEAD')
if (head.statusCode !== 200) throw new Error(`GitHub release returned HTTP ${head.statusCode}`)
const length = Number(head.headers['content-length']); head.resume()
if (!length) throw new Error('Missing release content length')
const size = 4 * 1024 * 1024, count = Math.ceil(length / size)
console.log(`Downloading verified Electron ${version}: ${Math.round(length / 1024 / 1024)} MB in ${count} resumable parts.`)
let next = 0
async function worker() {
  for (;;) {
    const i = next++; if (i >= count) return
    const start = i * size, end = Math.min(length - 1, start + size - 1)
    const target = path.join(directory, `${i}.part`)
    try { if ((await stat(target)).size === end - start + 1) continue } catch {}
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await request(source, 'GET', { Range: `bytes=${start}-${end}` })
        if (response.statusCode !== 206) { response.resume(); throw new Error(`Expected HTTP 206, received ${response.statusCode}`) }
        await pipeline(response, createWriteStream(target))
        if ((await stat(target)).size !== end - start + 1) throw new Error('Incomplete part')
        console.log(`Part ${i + 1}/${count} complete`); break
      } catch (error) { if (attempt >= 3) throw error }
    }
  }
}
await Promise.all(Array.from({ length: 12 }, worker))
const output = path.join(directory, filename), stream = createWriteStream(output), hash = createHash('sha256')
for (let i = 0; i < count; i++) {
  const part = await readFile(path.join(directory, `${i}.part`)); hash.update(part)
  if (!stream.write(part)) await new Promise(resolve => stream.once('drain', resolve))
}
await new Promise((resolve, reject) => { stream.on('error', reject); stream.end(resolve) })
const expected = require('electron/checksums.json')[filename]
if (hash.digest('hex') !== expected) throw new Error('Electron SHA-256 checksum mismatch; runtime not installed')
const { extract } = require('@electron-internal/extract-zip')
const destination = path.resolve('node_modules/electron/dist')
await mkdir(destination, { recursive: true }); await extract(output, { dir: destination })
await writeFile('node_modules/electron/path.txt', 'electron.exe')
console.log('Electron runtime verified and installed.')
