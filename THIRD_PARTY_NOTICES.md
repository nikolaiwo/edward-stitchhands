# Third-party notices

Edward Stitchhands is licensed under the GNU Affero General Public License v3.0 or later (see `LICENSE`).
It bundles or loads the following third-party software. Each component remains under its own license.

| Component | Use | License | Source |
|---|---|---|---|
| Ink/Stitch | Stitch generation and file output (`vendor/inkstitch`, unmodified, shipped in the Python bundle) | GPL-3.0-or-later | https://github.com/inkstitch/inkstitch |
| inkex (Inkscape extensions) | SVG/geometry library used by Ink/Stitch (`vendor/inkex`, unmodified) | GPL-2.0-or-later | https://gitlab.com/inkscape/extensions |
| pystitch | Embroidery file writers used by Ink/Stitch (installed at runtime) | MIT | https://github.com/inkstitch/pystitch |
| pyembroidery | Upstream of pystitch; used in tests to validate output | MIT | https://github.com/EmbroidePy/pyembroidery |
| Pyodide | Python runtime in WebAssembly (loaded from CDN) | MPL-2.0 | https://github.com/pyodide/pyodide |
| CPython | Interpreter inside Pyodide | PSF-2.0 | https://github.com/python/cpython |
| Shapely / GEOS | Geometry | BSD-3-Clause / LGPL-2.1 | https://github.com/shapely/shapely |
| NumPy | Numerics | BSD-3-Clause | https://github.com/numpy/numpy |
| NetworkX | Graph routing for fills | BSD-3-Clause | https://github.com/networkx/networkx |
| lxml / libxml2 | XML | BSD-3-Clause / MIT | https://github.com/lxml/lxml |
| Jinja2, tinycss2, cssselect, pyparsing, packaging, platformdirs, colormath2, fontTools, trimesh, diskcache, tomli | Ink/Stitch dependencies (installed at runtime) | BSD / MIT / Apache-2.0 (see each project) | PyPI |
| MuPDF.js | PDF to SVG conversion | AGPL-3.0-or-later | https://github.com/ArtifexSoftware/mupdf.js |
| JSZip | Zip downloads | MIT (dual MIT/GPL-3.0) | https://github.com/Stuk/jszip |

Ink/Stitch and inkex are included as git submodules pinned to exact commits (see `.gitmodules` and `git submodule status`), so the corresponding source for every shipped Python file is available in this repository.

Thread palettes in `vendor/inkstitch/palettes` are distributed by Ink/Stitch under its license.
