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
npm run test:product   # Studio kit, recents, export, reference, persistence, compact UI
npm run dist:win       # Unsigned Windows x64 NSIS installer in release/
```

`npm run preview` launches the existing production build. The installer is intended for local use and is not code signed. Publishing, auto-updates, macOS, and Linux installers are outside this release.

## Painting

- **Round, wash, dry brush:** choose a preset, then adjust brush size, water, pigment, softness, and paint spread. Spread ranges from **1× (the original flow, also the minimum)** to **8×**. The next stroke applies the rate to that layer's wash. Higher rates increase water and suspended-pigment transport; water availability, paper absorption, and settling still govern the result. A mouse supplies steady pressure; supported pens vary width and paint deposition with pressure.
- **Water:** prewet paper or rewet a dried stain. Wet pigment moves down water gradients, producing soft overlap boundaries and blooms. A dry stain lifts only partly.
- **Lift:** remove more suspended paint than settled pigment. **Eraser:** remove both water and pigment.
- **Drying:** typical washes dry in approximately 30 seconds; heavily wetted areas can take longer. Pause Drying freezes simulation while allowing marks. Dry Layer settles that layer immediately. Minimized windows do not advance the simulation clock.
- **Layers:** add, duplicate, reorder, hide, lock, rename (double-click), or change opacity. Up to eight layers. Hidden and locked layers still dry; locking prevents edits. Layers composite in normal alpha order and never exchange water or pigment.
- **Color picking:** the eyedropper (I), or holding Alt, shows a small magnified pixel preview beside the cursor, with a marked sample pixel and hex color. Click to use that color.
- **Images:** File → Import Image places a PNG/JPEG on its own raster layer and opens the image tools on the left. Move (V), Transform (T), and Rotate (R) provide on-canvas bounding boxes, eight resize handles, and a rotation handle. The panel offers exact position, size, rotation, proportion locking, 90° rotation, flips, and centering. Shift toggles proportions during resizing or snaps rotation to 15°; arrow keys nudge (Shift for 10 px); Esc cancels a drag. Each finished edit is undoable. Source pixels are retained separately from placement, so repeated transforms do not accumulate blur or discard off-canvas content. Imported sources are limited to 2048 pixels on the longest side, matching the maximum canvas resolution.
- **Painting over images:** choose a brush or click Paint over image and draw. A watercolor layer is created immediately above the image when needed; an unlocked, visible watercolor layer directly above it is reused. The image and other layers stay independent. At the eight-layer limit, select an existing watercolor layer if there is no suitable layer above the image.
- **Projects:** `.waterpaint` files retain wet state, layers, simulation time, paper seed, and paper appearance. Click the title to rename a painting. File → Recent paintings reopens the ten most recently opened or saved files; clearing the list leaves the files untouched. Opening pauses drying until Resume or the next stroke. Autosave recovery runs every 20 seconds after changes and is offered on launch. A pending recovery offer is never overwritten by a new autosave.
- **History:** stroke-level and layer-operation undo/redo restores water and pigment, not just an image. History uses a 96 MB compressed-checkpoint budget. Oldest entries are discarded at that limit; history itself is not stored in project files.
- **Export:** preview the actual painting, then choose lossless PNG or JPEG with adjustable quality. Export at 25%, 50%, 100%, or 200% of document size, with the chosen paper surface or PNG transparency. The preview shows output dimensions and file size, and pauses drying while you choose. Enlargement resamples the painting without adding simulation detail. Only visible layers are exported.

### Studio kit

Open **Studio kit** in the header or inspector to find the creative extras:

- **Pigment mixing:** choose two pigments, adjust their ratio, and paint with the result. Mixing uses the same eight-band spectral model as the engine. Start a well from your current color or save a mix to your collection.
- **Color collections:** Botanical, Coast, Dusk, and Earth palettes, plus up to 24 personal swatches. Each saved swatch can be reused or removed.
- **My brushes:** name and keep up to 12 custom brushes with their size, water, pigment, softness, spread, preset, and color. Current brush settings and the library persist locally across app restarts.
- **Symmetry:** mirror left/right, top/bottom, four ways, or in six radial petals around the canvas center. All copies of one gesture share a single undo step; samples exactly on an axis are not deposited twice. Mirrored samples outside rectangular canvases are clipped by the canvas.
- **Steady hand:** a distance-based trailing brush smooths small pointer movements. Higher settings add more lag; zero preserves the original input path. Settings are captured at the start of each stroke.
- **Composition guides:** rule of thirds, an eight-part grid, and diagonals. Symmetry axes and guides are overlays and never appear in exports.
- **Paper & surface:** five tones, a custom color, and adjustable visible grain. Apply a custom tone with the explicit Apply button. Changes are undoable and stored in project files. These change appearance; water still follows the cold-press simulation.
- **Reference board:** open a PNG/JPEG from the header or File menu. Sample a pixel with its picker or use the extracted six-color palette. Drag the reference heading or use arrow keys while it is focused to move the board; minimize it to make room. The reference uses no layer and never changes exported artwork. References remain session-only; save useful pigments in My colors.
- **Focus mode:** hide the rails and inspector with the header button or Tab while the canvas has focus. Tab/Esc or Show studio restores the workspace. Normal keyboard navigation still works inside controls.
- **Clear selected wash:** clear an unlocked watercolor layer in one undoable action while keeping its name and settings.

The personal library belongs to the local app profile. Paper appearance and the painting title belong to the document. Drawing companions, guides, and references belong to the current session.

### Shortcuts

| Action | Shortcut |
| --- | --- |
| Brush / water / lift | B / W / L |
| Eraser / eyedropper / hand | E / I / H |
| Move / transform / rotate image | V / T / R |
| Temporary color picker | Hold Alt |
| Brush size | [ / ] |
| Pan | Space + drag, or middle mouse |
| Zoom | Scroll, + / − |
| Fit canvas | Ctrl + 0 |
| Undo / redo | Ctrl + Z / Ctrl + Shift + Z |
| New / open / save | Ctrl + N / O / S |
| Save as | Ctrl + Shift + S |
| Import / export | Ctrl + I / Ctrl + Shift + E |
| Help | ? |
| Focus mode / restore workspace | Tab on canvas / Esc |

## Architecture and rendering choices

The renderer UI delegates to `Studio`, which coordinates the independent `WatercolorEngine`, document codec worker, and bounded history. Only narrowly scoped preload methods can access native dialogs, chosen files, and the application recovery file. The renderer has no Node integration; sandboxing, context isolation, navigation restrictions, and a content security policy are enabled.

Each simulation cell stores eight spectral absorption/scattering coefficients for suspended pigment, eight for settled pigment, plus water, pigment masses, and paper saturation. Brush colors are converted using Spectral.js and compressed into eight integrated wavelength bands. The WGSL shader reconstructs reflectance using Kubelka–Munk. This is a reduced spectral, artistic simulation, not a calibrated model of a particular paint brand or an exact fluid dynamics solver.

Water and suspended pigment move by conservative neighbor fluxes. Stronger spread uses stable substeps within each 60 Hz tick, scales both water transport and pigment diffusion, and preserves the elapsed time used for drying. Simulation bounds reserve more paper for stronger flow and have no-flux edges to conserve mass. Each layer's spread rate persists through projects and history. Stable paper noise modulates absorption and settling. Pigment settles faster near wet/dry boundaries, and clean water lifts a small fraction back into suspension. Simulation runs only inside each layer's affected region. Dry layer images are cached. No per-frame GPU readbacks occur during painting; snapshots and export use explicit readbacks, while the eyedropper reads a small pixel region at a throttled rate.

Documents render and export at their full resolution, up to 2048 × 2048. The fluid grid is capped at **1024 pixels on its longest side**, with bilinear reconstruction at output resolution. This bounds memory and keeps wet flow responsive; at maximum canvas size the simulation detail is approximately two output pixels. One shared scratch buffer avoids a full second state buffer for every layer. Eight fully painted maximum-sized layers can still require roughly a gigabyte of GPU memory including caches and scratch storage.

Project files are ZIP archives with a versioned JSON manifest, compact bounded-region binary pigment state, and PNG raster sources with optional affine placement metadata. Earlier files without placement metadata or spread rates still open. Image transforms composite in the normal layer order and preserve visibility, opacity, locking, duplication, and history. The decoder checks dimensions, sizes, IDs, transforms, and finite pigment values before GPU uploads. File writes use a temporary sibling and rename. Recovery writes are serialized. GPU loss stops drawing and offers reload from the latest completed recovery file.

## Validation

Unit tests cover spectral mixing, symmetry deduplication, input smoothing and resampling, preference validation, exact project round trips, malformed documents, and history budgets. The Electron integration suite uses a real WebGPU adapter to check wet overlap, mass conservation, drying, rewetting, isolated layers, pen-path infrastructure, pointer drawing, save/open, PNG output, recovery, and undo/redo. The product suite checks the new controls, saved brushes and swatches, recent-project authorization, document titles, paper persistence, JPEG/PNG output dimensions and alpha, reference isolation, focus mode, and compact layout. Both write reports and screenshots to `test-results/`.

The benchmark reports actual GPU completion time for a localized wet wash on a 2048 × 2048 document. The 60 FPS target depends on adapter, brush size, wet area, and number of simultaneously wet layers; the report distinguishes measured results from targets. Physical pen-device testing must be done with an attached tablet.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for Spectral.js attribution and the watercolor research reference.
