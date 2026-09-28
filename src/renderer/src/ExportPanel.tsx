import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import type { ExportOptions } from '../../shared/types'
import type { Studio } from './Studio'

export function ExportPanel({ studio, onClose }: { studio: Studio; onClose: () => void }) {
  const [options, setOptions] = useState<ExportOptions>({ format: 'png', paper: true, scale: 1, quality: .92 })
  const [preview, setPreview] = useState(''), [size, setSize] = useState(0), [loading, setLoading] = useState(true), [error, setError] = useState('')
  useEffect(() => studio.engine.hold(), [studio])
  useEffect(() => {
    let canceled = false, url = ''
    setLoading(true); setError(''); setPreview('')
    const timer = setTimeout(() => {
      void studio.engine.exportImage(options).then(bytes => {
        if (canceled) return
        url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: `image/${options.format}` }))
        setPreview(url); setSize(bytes.length); setLoading(false)
      }).catch(e => { if (!canceled) { setError(String(e)); setLoading(false) } })
    }, 120)
    return () => { canceled = true; clearTimeout(timer); if (url) URL.revokeObjectURL(url) }
  }, [studio, options])
  return <>
    <div className="real-export-preview transparent-preview">{preview && <img src={preview} alt="Preview of the exported painting" />}{loading && <span>Preparing preview…</span>}</div>
    <div className="export-fields"><label>Format<select aria-label="Export format" value={options.format} onChange={e => setOptions({ ...options, format: e.target.value as ExportOptions['format'], paper: e.target.value === 'jpeg' || options.paper })}><option value="png">PNG · lossless</option><option value="jpeg">JPEG · smaller file</option></select></label><label>Size<select aria-label="Export size" value={options.scale} onChange={e => setOptions({ ...options, scale: +e.target.value })}>{[.25, .5, 1, 2].map(scale => <option key={scale} value={scale}>{scale * 100}%{scale === 1 ? ' · original' : ''}</option>)}</select></label></div>
    <label className="export-paper"><input type="checkbox" checked={options.paper} disabled={options.format === 'jpeg'} onChange={e => setOptions({ ...options, paper: e.target.checked })} />Include paper color and texture{options.format === 'jpeg' && <small>JPEG requires a background</small>}</label>
    {options.format === 'jpeg' && <label className="kit-field">JPEG quality <span>{Math.round(options.quality * 100)}%</span><input aria-label="JPEG quality" type="range" min={10} max={100} value={options.quality * 100} onChange={e => setOptions({ ...options, quality: +e.target.value / 100 })} /></label>}
    <p className="modal-note">{Math.round(studio.state.width * options.scale)} × {Math.round(studio.state.height * options.scale)} px · {loading ? '…' : size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`} · Visible layers only{options.scale > 1 && <><br />Enlarged from the original; no extra paint detail is generated.</>}</p>
    {error && <p role="alert">{error}</p>}
    <div className="modal-footer"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={loading || !!error || studio.state.busy} onClick={() => { void studio.exportWithOptions(options); onClose() }}><Download size={16} />Export painting</button></div>
  </>
}
