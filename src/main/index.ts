import { app, BrowserWindow, dialog, ipcMain, Menu, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, rename, mkdir, unlink, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

const MAX_BYTES = 512 * 1024 * 1024
let window: BrowserWindow | null = null
let projectPath: string | undefined
let dirty = false, closeAfterSave = false, confirmingClose = false
if (process.env.WATERPAINT_TEST) app.setPath('userData', join(process.cwd(), 'test-results', 'profile'))

function trusted(event: { senderFrame: IpcMainInvokeEvent['senderFrame'] }): void {
  if (!window || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted IPC sender.')
}
function bytes(value: unknown): Buffer {
  if (!(value instanceof Uint8Array) || value.byteLength === 0 || value.byteLength > MAX_BYTES) throw new Error('File data is empty or too large.')
  return Buffer.from(value)
}
async function atomicWrite(path: string, data: Buffer): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try { await writeFile(temporary, data, { flag: 'wx' }); await rename(temporary, path) }
  catch (error) { await unlink(temporary).catch(() => {}); throw error }
}
async function readLimited(path: string): Promise<Uint8Array> {
  if ((await stat(path)).size > MAX_BYTES) throw new Error('This file exceeds the 512 MB size limit.')
  return new Uint8Array(await readFile(path))
}
const recoveryPath = (): string => join(app.getPath('userData'), 'recovery.waterpaint')
function command(action: string): void { window?.webContents.send('menu:action', action) }

app.whenReady().then(async () => {
  await mkdir(app.getPath('userData'), { recursive: true })
  window = new BrowserWindow({
    width: 1460, height: 980, minWidth: 1024, minHeight: 720, show: false,
    title: 'WaterPaint', backgroundColor: '#efede8', autoHideMenuBar: true,
    icon: app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../resources/icon.png'),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  window.once('ready-to-show', () => { if (!process.env.WATERPAINT_TEST) window?.show() })
  window.on('close', async event => {
    if (!dirty) return
    event.preventDefault()
    if (confirmingClose) return
    confirmingClose = true
    const result = await dialog.showMessageBox(window!, { type: 'question', message: 'Save your painting before leaving?', detail: 'Your unsaved changes will be lost if you discard them.', buttons: ['Save', 'Discard', 'Cancel'], defaultId: 0, cancelId: 2 })
    confirmingClose = false
    if (result.response === 0) { closeAfterSave = true; window?.webContents.send('document:save-request') }
    if (result.response === 1) { await unlink(recoveryPath()).catch(() => {}); dirty = false; window?.close() }
  })
  const guarded = (channel: string, handler: (...args: any[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args) => { trusted(event); return handler(...args) })
  }
  let openedPath: string | undefined
  guarded('project:initial', async () => {
    const selected = process.argv.find(argument => !argument.startsWith('-') && argument.toLowerCase().endsWith('.waterpaint'))
    if (!selected) return null
    const data = await readLimited(selected); openedPath = selected
    return { canceled: false, path: selected, bytes: data }
  })
  // A renderer cannot provide filesystem paths. Remember the actual path
  // selected by the native dialog and adopt it on explicit validation success.
  guarded('project:open', async () => {
    const result = await dialog.showOpenDialog(window!, { title: 'Open painting', filters: [{ name: 'WaterPaint artwork', extensions: ['waterpaint'] }], properties: ['openFile'] })
    if (result.canceled) return { canceled: true }
    const data = await readLimited(result.filePaths[0]); openedPath = result.filePaths[0]
    return { canceled: false, path: openedPath, bytes: data }
  })
  guarded('project:adopt', () => { projectPath = openedPath; openedPath = undefined })
  guarded('project:reset', () => { projectPath = undefined; openedPath = undefined })
  guarded('project:save', async (input: unknown, saveAs: unknown) => {
    const data = bytes(input)
    let target = projectPath
    if (!target || saveAs === true) {
      const result = await dialog.showSaveDialog(window!, { title: 'Save painting', defaultPath: projectPath ?? 'Untitled.waterpaint', filters: [{ name: 'WaterPaint artwork', extensions: ['waterpaint'] }] })
      if (result.canceled || !result.filePath) { closeAfterSave = false; return { canceled: true } }
      target = result.filePath
      if (!target.toLowerCase().endsWith('.waterpaint')) target += '.waterpaint'
    }
    try { await atomicWrite(target, data); projectPath = target; return { canceled: false, path: target } }
    catch (error) { closeAfterSave = false; throw error }
  })
  guarded('image:import', async () => {
    const result = await dialog.showOpenDialog(window!, { title: 'Import image', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }], properties: ['openFile'] })
    if (result.canceled) return { canceled: true }
    return { canceled: false, path: result.filePaths[0], bytes: await readLimited(result.filePaths[0]) }
  })
  guarded('image:export', async (input: unknown) => {
    const data = bytes(input)
    const result = await dialog.showSaveDialog(window!, { title: 'Export PNG', defaultPath: 'WaterPaint.png', filters: [{ name: 'PNG image', extensions: ['png'] }] })
    if (result.canceled || !result.filePath) return { canceled: true }
    const target = result.filePath.toLowerCase().endsWith('.png') ? result.filePath : result.filePath + '.png'
    await atomicWrite(target, data); return { canceled: false, path: target }
  })
  let recoveryQueue = Promise.resolve()
  guarded('recovery:write', (input: unknown) => {
    const data = bytes(input)
    recoveryQueue = recoveryQueue.catch(() => {}).then(() => atomicWrite(recoveryPath(), data))
    return recoveryQueue
  })
  guarded('recovery:read', async () => { try { return await readLimited(recoveryPath()) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error } })
  guarded('recovery:clear', () => {
    recoveryQueue = recoveryQueue.catch(() => {}).then(() => unlink(recoveryPath()).catch(error => { if (error.code !== 'ENOENT') throw error }))
    return recoveryQueue
  })
  ipcMain.on('document:dirty', (event, value) => {
    trusted(event); dirty = value === true
    if (!dirty && closeAfterSave) { closeAfterSave = false; window?.close() }
  })
  ipcMain.on('app:reload', event => { trusted(event); window?.webContents.reload() })
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'New painting', accelerator: 'CmdOrCtrl+N', click: () => command('new') },
      { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => command('open') },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => command('save') },
      { label: 'Save as…', accelerator: 'CmdOrCtrl+Shift+S', click: () => command('saveAs') },
      { type: 'separator' }, { label: 'Import image…', accelerator: 'CmdOrCtrl+I', click: () => command('import') },
      { label: 'Export PNG…', accelerator: 'CmdOrCtrl+Shift+E', click: () => command('export') },
      { type: 'separator' }, { role: 'quit' }
    ] },
    { label: 'Edit', submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => command('undo') },
      { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => command('redo') },
      { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }
    ] },
    { label: 'View', submenu: [
      { label: 'Fit canvas', accelerator: 'CmdOrCtrl+0', click: () => command('fit') },
      { role: 'togglefullscreen' }, { role: 'toggleDevTools' }
    ] }
  ]))
  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await window.loadFile(join(__dirname, '../renderer/index.html'), { query: process.env.WATERPAINT_TEST ? { test: '1' } : {} })
})
app.on('window-all-closed', () => app.quit())
