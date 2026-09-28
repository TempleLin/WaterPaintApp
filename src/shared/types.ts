export type Tool = 'brush' | 'water' | 'lift' | 'eraser' | 'eyedropper' | 'pan' | 'image-move' | 'image-transform' | 'image-rotate'
export type Preset = 'round' | 'wash' | 'dry'
export interface BrushSettings { size: number; water: number; pigment: number; softness: number; spread: number; color: string; preset: Preset; tool: Tool }
export interface BrushSample { x: number; y: number; pressure: number }
export interface Rect { x: number; y: number; width: number; height: number }
export interface RasterTransform { x: number; y: number; width: number; height: number; rotation: number; flipX: boolean; flipY: boolean }
export interface LayerMeta { id: string; name: string; kind: 'paint' | 'raster'; visible: boolean; locked: boolean; opacity: number; transform?: RasterTransform }
export interface LayerSnapshot { meta: LayerMeta; state: Uint8Array; bounds: Rect | null; wetUntil: number; spread?: number; raster?: Uint8Array }
export interface DocumentSnapshot { version: 1; width: number; height: number; seed: number; title: string; activeId: string; tick: number; layers: LayerSnapshot[] }
export interface FileResult { canceled: boolean; path?: string; bytes?: Uint8Array }
export interface DesktopAPI {
  openProject(): Promise<FileResult>;
  initialProject(): Promise<FileResult | null>;
  saveProject(bytes: Uint8Array, saveAs: boolean): Promise<FileResult>;
  adoptOpenedProject(): Promise<void>;
  resetProjectPath(): Promise<void>;
  importImage(): Promise<FileResult>;
  exportPng(bytes: Uint8Array): Promise<FileResult>;
  writeRecovery(bytes: Uint8Array): Promise<void>;
  readRecovery(): Promise<Uint8Array | null>;
  clearRecovery(): Promise<void>;
  setDirty(dirty: boolean): void;
  onSaveRequest(callback: () => void): () => void;
  onMenu(callback: (action: string) => void): () => void;
  reload(): void;
}
declare global { interface Window { desktop: DesktopAPI; __waterpaint?: unknown } }
export const MAX_LAYERS = 8
export const MAX_SIZE = 2048
export const DEFAULT_BRUSH: BrushSettings = { size: 70, water: .68, pigment: .52, softness: .72, spread: 1, color: '#315d91', preset: 'round', tool: 'brush' }
