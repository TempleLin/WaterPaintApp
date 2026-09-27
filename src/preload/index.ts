import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopAPI } from '../shared/types'
const api: DesktopAPI = {
  openProject: () => ipcRenderer.invoke('project:open'),
  initialProject: () => ipcRenderer.invoke('project:initial'),
  saveProject: (bytes, saveAs) => ipcRenderer.invoke('project:save', bytes, saveAs),
  adoptOpenedProject: () => ipcRenderer.invoke('project:adopt'),
  resetProjectPath: () => ipcRenderer.invoke('project:reset'),
  importImage: () => ipcRenderer.invoke('image:import'),
  exportPng: bytes => ipcRenderer.invoke('image:export', bytes),
  writeRecovery: bytes => ipcRenderer.invoke('recovery:write', bytes),
  readRecovery: () => ipcRenderer.invoke('recovery:read'),
  clearRecovery: () => ipcRenderer.invoke('recovery:clear'),
  setDirty: dirty => ipcRenderer.send('document:dirty', dirty),
  onSaveRequest: callback => { ipcRenderer.on('document:save-request', callback); return () => ipcRenderer.removeListener('document:save-request', callback) },
  onMenu: callback => { const handler = (_event: unknown, action: string): void => callback(action); ipcRenderer.on('menu:action', handler); return () => ipcRenderer.removeListener('menu:action', handler) },
  reload: () => ipcRenderer.send('app:reload')
}
contextBridge.exposeInMainWorld('desktop', api)
