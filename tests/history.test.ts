import { describe, expect, it } from 'vitest'
import { History } from '../src/shared/history'
const bytes = (value: number, size = 5): Uint8Array => new Uint8Array(size).fill(value)
describe('history checkpoints', () => {
  it('restores before-state on undo and the exact current wet state on redo', () => {
    const history = new History()
    history.push({ label: 'Stroke', bytes: bytes(1) })
    expect(history.undo(bytes(2))?.bytes).toEqual(bytes(1))
    expect(history.redo(bytes(3))?.bytes).toEqual(bytes(2))
    expect(history.undo(bytes(4))?.bytes).toEqual(bytes(3))
  })
  it('discards the redo branch after a new stroke', () => {
    const history = new History(); history.push({ label: 'A', bytes: bytes(1) }); history.undo(bytes(2))
    history.push({ label: 'B', bytes: bytes(3) }); expect(history.canRedo).toBe(false)
  })
  it('evicts oldest entries at the memory budget', () => {
    const history = new History(10)
    for (let i = 0; i < 3; i++) history.push({ label: String(i), bytes: bytes(i) })
    expect(history.usedBytes).toBe(10); expect(history.undo(bytes(3))?.label).toBe('2')
    expect(history.undo(bytes(4))?.label).toBe('1'); expect(history.canUndo).toBe(false)
  })
  it('never retains a checkpoint larger than the budget', () => {
    const history = new History(4); history.push({ label: 'Huge', bytes: bytes(1, 10) }); expect(history.usedBytes).toBe(0)
  })
})
