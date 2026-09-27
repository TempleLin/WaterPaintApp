# WaterPaint

A Windows desktop watercolor studio built with Electron, React, TypeScript, and WebGPU. Paint bleeds through wet areas, settles into textured paper, and can be rewetted with clean water. Each layer is an independent wash.

## Run locally

Requires Node.js 22.12+ (Node 24 recommended), Windows 10/11 x64, and a graphics adapter/driver that supports WebGPU. The app requires GPU acceleration; there is no CPU painting fallback.

```powershell
npm install --include=dev
npm run dev
```

If your npm configuration blocks install scripts, allow the Electron and esbuild installation scripts. Electron must download its Windows runtime on first install.

```powershell
npm run check          # TypeScript + unit tests
npm run test:electron  # Real Electron/WebGPU integration tests, screenshots, benchmark
npm run dist:win       # Unsigned Windows x64 NSIS installer in release/
```

`npm run preview` launches the existing production build. The installer is intended for local use and is not code signed. Publishing, auto-updates, macOS, and Linux installers are outside this release.

## Painting

- **Round, wash, dry brush:** choose a preset, then adjust brush size, water, pigment, and softness. A mouse supplies steady pressure; supported pens vary width and paint deposition with pressure.
- **Water:** prewet paper or rewet a dried stain. Wet pigment moves down water gradients, producing soft overlap boundaries and blooms. A dry stain lifts only partly.
- **Lift:** remove more suspended paint than settled pigment. **Eraser:** remove both water and pigment.
- **Drying:** typical washes dry in approximately 30 seconds; heavily wetted areas can take longer. Pause Drying freezes simulation while allowing marks. Dry Layer settles that layer immediately. Minimized windows do not advance the simulation clock.
- **Layers:** add, duplicate, reorder, hide, lock, rename (double-click), or change opacity. Up to eight layers. Hidden and locked layers still dry; locking prevents edits. Layers composite in normal alpha order and never exchange water or pigment.
- **Images:** File → Import Image places a PNG/JPEG on its own raster layer. Adjust scale and position in the import dialog. Add a watercolor layer to paint over it.
- **Projects:** `.waterpaint` files retain wet state, layers, simulation time, and paper seed. Opening pauses drying until Resume or the next stroke. Autosave recovery runs every 20 seconds after changes and is offered on launch.
- **History:** stroke-level and layer-operation undo/redo restores water and pigment, not just an image. History uses a 96 MB compressed-checkpoint budget. Oldest entries are discarded at that limit; history itself is not stored in project files.
- **Export:** PNG at document resolution, with warm paper or transparent background. Only visible layers are exported.

### Shortcuts

| Action | Shortcut |
| --- | --- |
| Brush / water / lift | B / W / L |
| Eraser / eyedropper / hand | E / I / H |
| Brush size | [ / ] |
| Pan | Space + drag, or middle mouse |
| Zoom | Scroll, + / − |
| Fit canvas | Ctrl + 0 |
| Undo / redo | Ctrl + Z / Ctrl + Shift + Z |
| New / open / save | Ctrl + N / O / S |
| Save as | Ctrl + Shift + S |
| Import / export | Ctrl + I / Ctrl + Shift + E |
| Help | ? |

## Architecture and rendering choices

The renderer UI delegates to `Studio`, which coordinates the independent `WatercolorEngine`, document codec worker, and bounded history. Only narrowly scoped preload methods can access native dialogs, chosen files, and the application recovery file. The renderer has no Node integration; sandboxing, context isolation, navigation restrictions, and a content security policy are enabled.

Each simulation cell stores eight spectral absorption/scattering coefficients for suspended pigment, eight for settled pigment, plus water, pigment masses, and paper saturation. Brush colors are converted using Spectral.js and compressed into eight integrated wavelength bands. The WGSL shader reconstructs reflectance using Kubelka–Munk. This is a reduced spectral, artistic simulation, not a calibrated model of a particular paint brand or an exact fluid dynamics solver.

Water and suspended pigment move by conservative neighbor fluxes. Stable paper noise modulates absorption and settling. Pigment settles faster near wet/dry boundaries, and clean water lifts a small fraction back into suspension. Simulation runs at a fixed 60 Hz and only inside each layer's affected region. Dry layer images are cached. No per-frame GPU readbacks occur; snapshots, export, and eyedropper use explicit readbacks.

Documents render and export at their full resolution, up to 2048 × 2048. The fluid grid is capped at **1024 pixels on its longest side**, with bilinear reconstruction at output resolution. This bounds memory and keeps wet flow responsive; at maximum canvas size the simulation detail is approximately two output pixels. One shared scratch buffer avoids a full second state buffer for every layer. Eight fully painted maximum-sized layers can still require roughly a gigabyte of GPU memory including caches and scratch storage.

Project files are ZIP archives with a versioned JSON manifest, compact bounded-region binary pigment state, and PNG raster layers. The decoder checks dimensions, sizes, IDs, and finite pigment values before GPU uploads. File writes use a temporary sibling and rename. Recovery writes are serialized. GPU loss stops drawing and offers reload from the latest completed recovery file.

## Validation

Unit tests cover spectral mixing, input resampling, exact project round trips, malformed documents, and history budgets. The Electron integration suite uses a real WebGPU adapter to check wet overlap, mass conservation, drying, rewetting, isolated layers, pen-path infrastructure, pointer drawing, save/open, PNG output, recovery, and undo/redo. It writes screenshots and measured frame timings to `test-results/`.

The benchmark reports actual GPU completion time for a localized wet wash on a 2048 × 2048 document. The 60 FPS target depends on adapter, brush size, wet area, and number of simultaneously wet layers; the report distinguishes measured results from targets. Physical pen-device testing must be done with an attached tablet.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for Spectral.js attribution and the watercolor research reference.
