import type { Guide, Symmetry } from '../../shared/types'

export function CanvasGuides({ width, height, guide, symmetry }: { width: number; height: number; guide: Guide; symmetry: Symmetry }) {
  const lines: number[][] = []
  if (guide === 'thirds' || guide === 'grid') {
    const count = guide === 'thirds' ? 3 : 8
    for (let i = 1; i < count; i++) lines.push([width * i / count, 0, width * i / count, height], [0, height * i / count, width, height * i / count])
  }
  if (guide === 'diagonal') lines.push([0, 0, width, height], [width, 0, 0, height])
  const axes: number[][] = []
  if (symmetry === 'vertical' || symmetry === 'quad') axes.push([width / 2, 0, width / 2, height])
  if (symmetry === 'horizontal' || symmetry === 'quad') axes.push([0, height / 2, width, height / 2])
  if (symmetry === 'radial') for (let i = 0; i < 3; i++) {
    const a = i * Math.PI / 3, r = Math.hypot(width, height)
    axes.push([width / 2 - Math.cos(a) * r, height / 2 - Math.sin(a) * r, width / 2 + Math.cos(a) * r, height / 2 + Math.sin(a) * r])
  }
  return <svg className="canvas-guides" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">{[lines, axes].map((group, j) => group.map(([x1, y1, x2, y2], i) => <line key={`${j}-${i}`} x1={x1} y1={y1} x2={x2} y2={y2} className={j ? 'symmetry-axis' : ''} vectorEffect="non-scaling-stroke" />))}</svg>
}
