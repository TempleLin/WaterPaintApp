import { encodeProject, decodeProject } from '../../shared/project'
import type { DocumentSnapshot } from '../../shared/types'
self.onmessage = (event: MessageEvent<{ id: number; action: 'encode' | 'decode'; payload: DocumentSnapshot | Uint8Array }>) => {
  const { id, action, payload } = event.data
  try {
    const result = action === 'encode' ? encodeProject(payload as DocumentSnapshot) : decodeProject(payload as Uint8Array)
    self.postMessage({ id, result })
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }) }
}
