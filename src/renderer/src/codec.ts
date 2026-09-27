import type { DocumentSnapshot } from '../../shared/types'
const worker = new Worker(new URL('./project.worker.ts', import.meta.url), { type: 'module' })
let id = 0
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>()
worker.onmessage = event => {
  const task = pending.get(event.data.id); if (!task) return
  pending.delete(event.data.id)
  if (event.data.error) task.reject(new Error(event.data.error)); else task.resolve(event.data.result)
}
worker.onerror = event => { for (const task of pending.values()) task.reject(new Error(event.message)); pending.clear() }
function call<T>(action: 'encode' | 'decode', payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve: resolve as (value: unknown) => void, reject }); worker.postMessage({ id: key, action, payload }) })
}
export const encode = (document: DocumentSnapshot): Promise<Uint8Array> => call('encode', document)
export const decode = (bytes: Uint8Array): Promise<DocumentSnapshot> => call('decode', bytes)
