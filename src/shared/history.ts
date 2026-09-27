export interface HistoryEntry { label: string; bytes: Uint8Array }
/** Compressed checkpoints keep undo exact without retaining GPU resources. */
export class History {
  private past: HistoryEntry[] = []
  private future: HistoryEntry[] = []
  constructor(readonly budget = 96 * 1024 * 1024) {}
  get canUndo(): boolean { return this.past.length > 0 }
  get canRedo(): boolean { return this.future.length > 0 }
  get usedBytes(): number { return [...this.past, ...this.future].reduce((sum, e) => sum + e.bytes.byteLength, 0) }
  push(entry: HistoryEntry): void { this.future = []; this.past.push(entry); this.trim() }
  undo(current: Uint8Array): HistoryEntry | undefined {
    const entry = this.past.pop()
    if (entry) this.future.push({ label: entry.label, bytes: current })
    this.trim(); return entry
  }
  redo(current: Uint8Array): HistoryEntry | undefined {
    const entry = this.future.pop()
    if (entry) this.past.push({ label: entry.label, bytes: current })
    this.trim(); return entry
  }
  clear(): void { this.past = []; this.future = [] }
  private trim(): void {
    while (this.usedBytes > this.budget) {
      if (this.past.length > 0) this.past.shift()
      else if (this.future.length > 0) this.future.shift()
      else break
    }
  }
}
