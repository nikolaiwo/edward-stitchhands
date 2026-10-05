# Edward Stitchhands ✂️🧵

Turn SVG and PDF drawings into embroidery machine files — **DST, PES, PEC, JEF, EXP, VP3, XXX, U01** — entirely in your browser. Nothing is uploaded; your files never leave your device.

**Try it:** https://nikolaiwo.github.io/edward-stitchhands/

## How it works

The real work is done by [Ink/Stitch](https://inkstitch.org), the open-source embroidery extension for Inkscape. Edward runs Ink/Stitch's unmodified Python code in the browser using [Pyodide](https://pyodide.org) (Python compiled to WebAssembly). PDFs are converted to vector SVG with [MuPDF.js](https://mupdf.com).

1. Drop in an SVG or PDF.
2. Choose the size, fill density and file formats.
3. Preview the stitches, then download.

Filled shapes become fill stitches, thin lines become running stitches, and wide lines become satin columns.

The first visit downloads the Python runtime (~30 MB). After that, your browser caches it.

## Development

```sh
git clone --recurse-submodules https://github.com/nikolaiwo/edward-stitchhands.git
cd edward-stitchhands
npm install
npm run dev
```

See [docs/PLAN.md](docs/PLAN.md) for the architecture.

## License

[AGPL-3.0-or-later](LICENSE). Edward includes Ink/Stitch (GPL-3.0-or-later), inkex (GPL-2.0-or-later) and MuPDF (AGPL-3.0). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Edward Stitchhands is not affiliated with the Ink/Stitch project. Please support them: https://inkstitch.org
