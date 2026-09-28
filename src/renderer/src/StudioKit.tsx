import { useEffect, useState } from 'react'
import { Check, Plus, Trash2 } from 'lucide-react'
import type { PaperSettings, Guide, Symmetry } from '../../shared/types'
import { GUIDES, SYMMETRIES } from '../../shared/creative'
import { mixPigments } from '../../engine/spectral'
import { loadLibrary, writePreference, type Library } from './preferences'
import type { Studio, StudioState } from './Studio'

const PALETTES = {
  Botanical: ['#355e42', '#768b55', '#b4bb84', '#d7bc64', '#b57078', '#704c69'],
  Coast: ['#25495d', '#568899', '#91b7b2', '#d8c8a1', '#b78870', '#e0ded1'],
  Dusk: ['#47445f', '#797092', '#bd8c9c', '#e1ac92', '#c78755', '#6a7380'],
  Earth: ['#70452e', '#a86b42', '#cf9b5b', '#8c8753', '#505d4d', '#ddd0ae']
}
const PAPER_TONES = [['Warm cotton', '#fbf9f4'], ['Bright white', '#ffffff'], ['Rose', '#f5e7e3'], ['Mist', '#e6eded'], ['Sand', '#eee2c8']]

export function StudioKit({ studio, state, onReference }: { studio: Studio; state: StudioState; onReference: () => void }) {
  const [library, setLibrary] = useState(loadLibrary)
  const [theme, setTheme] = useState<keyof typeof PALETTES>('Botanical')
  const [a, setA] = useState('#e9c952'), [b, setB] = useState('#315d91'), [ratio, setRatio] = useState(50)
  const [name, setName] = useState(''), [paper, setPaper] = useState<PaperSettings>(state.paper)
  useEffect(() => setPaper(state.paper), [state.paper.color, state.paper.grain])
  const blend = mixPigments(a, b, ratio / 100)
  const saveLibrary = (next: Library) => {
    if (!writePreference('library', next)) { studio.notify('Your studio library could not be stored. Free some disk space and try again.'); return }
    setLibrary(next)
  }
  const saveColor = (color: string) => {
    if (library.swatches.includes(color)) { studio.notify('That color is already in your collection.'); return }
    if (library.swatches.length >= 24) { studio.notify('Your collection holds 24 colors. Remove one to make room.'); return }
    saveLibrary({ ...library, swatches: [...library.swatches, color] })
  }
  const commitPaper = (next: PaperSettings) => { setPaper(next); void studio.setPaper(next) }
  return <div className="studio-kit">
    <div className="kit-intro"><span className="quiet-label">A FEW MORE POSSIBILITIES</span><h2>Your studio kit</h2><p>Mix a color, save a favorite, find a new rhythm.</p></div>
    <details open><summary>Pigment mixing <span>01</span></summary><div className="kit-content">
      <div className="mix-wells">{[[a, setA, 'First'], [b, setB, 'Second']].map(([color, setColor, label]) => <div key={String(label)}><label><input aria-label={`${label} mixing color`} type="color" value={color as string} onChange={e => (setColor as (c: string) => void)(e.target.value)} /><span>{String(label)} pigment</span></label><button className="subtle-button" onClick={() => (setColor as (c: string) => void)(state.brush.color)}>Use current</button></div>)}</div>
      <label className="kit-field">Mix ratio <span>{100 - ratio} : {ratio}</span><input aria-label="Mix ratio" type="range" min={0} max={100} value={ratio} onChange={e => setRatio(+e.target.value)} /></label>
      <div className="mix-result" style={{ background: blend }}><span>{blend.toUpperCase()}</span></div>
      <div className="kit-actions"><button className="primary-button" onClick={() => studio.setBrush({ color: blend, tool: 'brush' })}>Paint with mix</button><button className="secondary-button" aria-label="Save mixed color" onClick={() => saveColor(blend)}><Plus size={14} />Save</button></div>
      <p className="kit-note">A pigment-based blend, using the same spectral model as your paint.</p>
    </div></details>
    <details><summary>Color collections <span>02</span></summary><div className="kit-content">
      <label className="kit-field">Inspired palettes<select aria-label="Palette collection" value={theme} onChange={e => setTheme(e.target.value as keyof typeof PALETTES)}>{Object.keys(PALETTES).map(p => <option key={p}>{p}</option>)}</select></label>
      <div className="kit-swatches">{PALETTES[theme].map(color => <button key={color} style={{ background: color }} title={color} aria-label={`Use ${color}`} onClick={() => studio.setBrush({ color })}>{state.brush.color === color && <Check size={14} />}</button>)}</div>
      <div className="kit-subheading"><strong>My colors · {library.swatches.length}/24</strong><button aria-label="Save current color" title="Save current color" onClick={() => saveColor(state.brush.color)}><Plus size={16} /></button></div>
      {library.swatches.length ? <div className="saved-swatches">{library.swatches.map(color => <div key={color}><button style={{ background: color }} aria-label={`Use saved ${color}`} title={color} onClick={() => studio.setBrush({ color })} /><button aria-label={`Remove saved ${color}`} onClick={() => saveLibrary({ ...library, swatches: library.swatches.filter(c => c !== color) })}>×</button></div>)}</div> : <p className="kit-note">Save the current pigment or a mix to build a personal collection.</p>}
    </div></details>
    <details><summary>My brushes <span>03</span></summary><div className="kit-content">
      <p className="kit-note">Keep your size, water, pigment, softness, spread, and color together. Available next time you open the app.</p>
      <form className="save-brush" onSubmit={e => { e.preventDefault(); if (!name.trim() || library.brushes.length >= 12) return; saveLibrary({ ...library, brushes: [...library.brushes, { id: crypto.randomUUID(), name: name.trim(), settings: { ...state.brush, tool: 'brush' } }] }); setName('') }}>
        <input aria-label="Brush preset name" placeholder="e.g. Fine botanical ink" value={name} maxLength={40} onChange={e => setName(e.target.value)} /><button title="Save current brush" aria-label="Save current brush" disabled={!name.trim() || library.brushes.length >= 12}><Plus size={17} /></button>
      </form>
      {library.brushes.map(item => <div className="saved-brush" key={item.id}><button onClick={() => { studio.setBrush(item.settings); studio.notify(`Loaded ${item.name}`) }}><i style={{ background: item.settings.color }} /><span>{item.name}<small>{item.settings.size}px · {Math.round(item.settings.water * 100)}% water</small></span></button><button title={`Delete ${item.name}`} aria-label={`Delete brush ${item.name}`} onClick={() => saveLibrary({ ...library, brushes: library.brushes.filter(p => p.id !== item.id) })}><Trash2 size={14} /></button></div>)}
      <p className="kit-note">{library.brushes.length}/12 saved brushes</p>
    </div></details>
    <details><summary>Drawing companions <span>04</span></summary><div className="kit-content">
      <label className="kit-field">Symmetry<select aria-label="Stroke symmetry" value={state.symmetry} onChange={e => studio.setCreative({ symmetry: e.target.value as Symmetry })}>{SYMMETRIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
      <label className="kit-field">Steady hand <span>{state.smoothing}%</span><input aria-label="Stroke smoothing" type="range" min={0} max={100} value={state.smoothing} onChange={e => studio.setCreative({ smoothing: +e.target.value })} /></label>
      <p className="kit-note">A trailing brush calms a shaky hand. Higher values add more distance behind the pointer.</p>
      <label className="kit-field">Composition guide<select aria-label="Composition guide" value={state.guide} onChange={e => studio.setCreative({ guide: e.target.value as Guide })}>{GUIDES.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}</select></label>
      <p className="kit-note">Guides stay out of your exported painting. Press Tab for a quiet, full-canvas workspace.</p>
      <button className="secondary-button kit-wide" onClick={onReference}>Open reference image…</button>
    </div></details>
    <details><summary>Paper & surface <span>05</span></summary><div className="kit-content">
      <div className="kit-swatches">{PAPER_TONES.map(([label, color]) => <button key={color} style={{ background: color, color: '#53624e' }} disabled={state.busy} title={label} aria-label={`${label} paper`} onClick={() => commitPaper({ ...paper, color })}>{paper.color === color && <Check size={14} />}</button>)}</div>
      <label className="kit-color">Custom paper tone<input aria-label="Paper color" type="color" value={paper.color} disabled={state.busy} onChange={e => setPaper({ ...paper, color: e.target.value })} /></label>
      {paper.color !== state.paper.color && <button className="secondary-button kit-wide" disabled={state.busy} onClick={() => commitPaper(paper)}>Apply custom tone</button>}
      <label className="kit-field">Visible grain <span>{Math.round(paper.grain * 100)}%</span><input aria-label="Paper grain" type="range" min={0} max={200} disabled={state.busy} value={paper.grain * 100} onChange={e => setPaper({ ...paper, grain: +e.target.value / 100 })} onPointerUp={() => { if (paper.grain !== state.paper.grain) commitPaper(paper) }} onKeyUp={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) commitPaper({ ...paper, grain: +e.currentTarget.value / 100 }) }} /></label>
      <p className="kit-note">Paper appearance is saved with the painting and can be undone. The underlying cold-press water behavior stays the same.</p>
    </div></details>
  </div>
}
