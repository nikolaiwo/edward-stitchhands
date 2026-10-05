# Edward Stitchhands — implementation plan

Turn an SVG or PDF drawing into machine embroidery files, 100% client-side, hosted as a static site on GitHub Pages.

## Architecture

```
 File (SVG/PDF) ──► src/input ──► InputPage (mm-sized SVG) ──► src/engine (Web Worker + Pyodide)
                                                                   │  python/edward/convert.py
                                                                   │    → Ink/Stitch (vendor/inkstitch, unmodified)
                                                                   │    → pystitch writers
                                                                   ▼
 src/ui  ◄──────────────── ConvertResult { plan (for preview), files (DST/PES/…), warnings }
```

Contracts live in `src/types.ts` (`InputDocument`, `InputPage`, `ConvertOptions`, `ConvertResult`, `StitchPlan`, `Engine`). Modules talk only through these.

## Proven by spike (docs/spike-reference.mjs)

Pyodide 314.0.7 in Node ran Ink/Stitch's `Output` extension unmodified and wrote valid DST/PES/JEF/EXP/VP3/XXX (validated with pyembroidery: identical stitch counts, 3 colors, correct extents). Requirements:

- Pyodide packages: `micropip numpy shapely networkx lxml jinja2`
- micropip (pure wheels from PyPI): `tinycss2 cssselect pyparsing packaging pystitch platformdirs colormath2 fonttools trimesh diskcache tomli`
- `inkex` is NOT installable from PyPI in Pyodide → load `vendor/inkex/inkex` source onto `sys.path`.
- GUI-only modules (`wx`, `flask`, `flask_cors`, `werkzeug`, `webbrowser`) are stubbed with an import hook: `python/edward/gui_stubs.py`. Must be activated before importing `lib`.
- Ink/Stitch resolves resources relative to `lib/../` (`palettes/` etc.), so ship `vendor/inkstitch/{lib,palettes}` (+ anything else proven needed) under one root, e.g. `/inkstitch` in the Pyodide FS.
- Env `INKSTITCH_OFFLINE_SCRIPT=1`.
- A conversion of a small drawing took ~6 s cold in Node (incl. package load ~3 s).

## Workstreams (parallel, each in its own git worktree/branch)

### A. Engine — `python/`, `src/engine/`, `scripts/build-pybundle.mjs`, `tests/engine/`
1. `scripts/build-pybundle.mjs`: zip `vendor/inkstitch/lib`, `vendor/inkstitch/palettes` (and any other needed runtime dirs), `vendor/inkex/inkex`, `python/edward` into `public/py/bundle.zip` (+ a manifest with the pinned micropip packages). Strip tests, `.pyc`, gui-only data where safe. Hook into `npm run build` / `npm run dev` via `prebuild`/`predev`.
2. `python/edward/convert.py`: `convert(svg: str, options_json: str, formats: list[str]) -> dict` that
   - applies `ConvertOptions` by setting `inkstitch:*` attributes on elements (row_spacing_mm, angle, max_stitch_length_mm, fill_underlay, running_stitch_length_mm, bean_stitch_repeats, satin conversion for wide strokes, ties, etc. — look up exact param names in `vendor/inkstitch/lib/elements/*.py`),
   - builds the stitch plan once, writes every requested format via Ink/Stitch's `write_embroidery_file` (or pystitch directly) into memory/tmp,
   - returns the stitch plan as plain data (per color block: color, thread name, coords in mm with origin top-left, flags for jump/trim) plus warnings (Ink/Stitch validation warnings, e.g. invalid shapes).
   - Must NOT go through `sys.argv`/stdout hacks if avoidable — drive the extension classes / element APIs directly.
3. `src/engine/worker.ts` (module Web Worker): loads Pyodide from the jsDelivr CDN (version pinned to the npm package), installs packages, unzips the bundle into the FS, exposes `init`/`convert` via postMessage, transfers ArrayBuffers.
4. `src/engine/client.ts`: `createEngine(): Engine` implementing the interface in `src/types.ts`, with progress events. Singleton worker, queued requests.
5. Tests: Node script/vitest that runs the same Python bundle in Pyodide-on-Node against `tests/fixtures/*.svg` and validates outputs (stitch count > 0, color count, extents ≈ input size). Keep a fixture set: filled shapes, thin strokes, wide strokes, compound path with hole, transforms/groups, CSS `style=` attributes, a text element (should warn).

### B. Input — `src/input/`, `tests/input/`
1. `loadFile(file: File): Promise<InputDocument>` dispatching on type.
2. SVG: parse, determine physical size (handle `width/height` in mm/cm/in/pt/px (96 dpi)/unitless, missing → from viewBox at 96 dpi), ensure a viewBox, output root with `width="Xmm" height="Ymm"`. Warn on `<text>`, `<image>`, gradients, clip paths/masks, filters (Ink/Stitch ignores or mishandles them). Remove hidden/`display:none` elements and `<metadata>`, editor cruft. Keep CSS/`style` — inkex handles it.
3. `resizePage(page: InputPage, widthMm: number, heightMm: number): InputPage` — scale while preserving the viewBox (just change width/height; keep aspect unless asked).
4. PDF: use the `mupdf` npm package (WASM, AGPL) lazily imported (dynamic `import()` so the main bundle stays small) to render each page to SVG with text converted to paths. Page size in mm from PDF points (1pt = 25.4/72 mm). Return one `InputPage` per page.
5. Vitest unit tests with fixtures, including a generated multi-page PDF.

### C. UI — `index.html`, `src/main.ts`, `src/ui/`, `src/style.css`
Vanilla TypeScript, no framework. Depends only on `src/types.ts`; develop against a fake `Engine` (`src/ui/fakeEngine.ts`) so it doesn't block on A.
1. Layout: header (name + one-line tagline), drop zone / file picker (SVG, PDF), page picker for multi-page PDFs, original preview, settings panel, stitch preview, downloads, footer (AGPL source link, Ink/Stitch credit, "everything runs in your browser — your files never leave your device").
2. Settings: target size (W/H mm, locked aspect, hoop presets 100×100, 130×180, 160×260, 200×200, 200×300, 360×200), fill density/angle/underlay, running stitch length, bean repeats, satin threshold, formats (checkboxes with `FORMAT_LABELS`, persisted in localStorage), Convert button. Advanced section collapsed.
3. Stitch preview: canvas renders `StitchPlan` with thread colors, jumps hidden or dotted, toggles; zoom/pan; playback slider + play button that simulates sewing; stats (stitches, colors, trims, size, est. time at 600 spm).
4. Engine loading UX: start `engine.init()` on first file drop, progress bar with stage text (first load downloads ~30 MB, cached afterwards).
5. Downloads: one button per format + "Download all (.zip)" using `jszip`.
6. Responsive (works at phone width), light/dark via `prefers-color-scheme`, accessible (labels, focus states, keyboard).

### D. Integration & release (lead)
Merge branches, swap the fake engine for the real one, end-to-end browser test with Playwright against `vite preview`, deploy via GitHub Actions to Pages.

## Licensing
Project license: **AGPL-3.0-or-later** (`LICENSE`). Ink/Stitch is GPL-3.0-or-later, inkex GPL-2.0-or-later, MuPDF AGPL-3.0; GPLv3 §13 permits combining GPLv3 and AGPLv3 code. Third-party notices: `THIRD_PARTY_NOTICES.md`. The site must link to its source.

## Later (not MVP)
Satin from arbitrary filled shapes (Ink/Stitch `fill_to_satin`), auto-trace raster images, thread palette matching UI, per-object parameter editing, PWA/offline caching of Pyodide.
