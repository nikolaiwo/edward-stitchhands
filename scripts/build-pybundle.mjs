// Builds public/py/bundle.zip (Ink/Stitch + inkex + our glue code) and public/py/manifest.json.
// Run via `npm run build-pybundle` (hooked into predev/prebuild).
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'py');

/** Source dir (relative to repo root) -> path inside the zip. Everything unpacks under /app in the Pyodide FS. */
const SOURCES = [
  ['vendor/inkstitch/lib', 'inkstitch/lib'],
  ['vendor/inkstitch/palettes', 'inkstitch/palettes'],
  ['vendor/inkex/inkex', 'inkex'],
  ['python/edward', 'edward'],
];

const SKIP_DIR = new Set(['__pycache__', 'tests', 'test']);
const SKIP_FILE = /\.(pyc|pyo|orig|rej)$/;

/**
 * Pyodide-distribution packages (loaded with pyodide.loadPackage; versions follow the Pyodide release).
 * Includes pure-Python helpers that the PyPI packages below depend on, so those can be installed
 * with deps=false (otherwise micropip drags in matplotlib & co).
 */
const PYODIDE_PACKAGES = [
  'micropip', 'numpy', 'shapely', 'networkx', 'lxml', 'jinja2',
  'platformdirs', 'tomli', 'diskcache', 'fonttools', 'webencodings', 'cssselect', 'pyparsing', 'packaging',
];

/** Pure-Python wheels from PyPI, pinned to the versions verified to work. Installed with deps=false. */
const MICROPIP_PACKAGES = ['tinycss2==1.5.1', 'colormath2==3.0.3', 'pystitch==1.0.1', 'trimesh==5.1.1'];

async function walk(dir, base, zip, zipBase) {
  for (const entry of (await readdir(dir)).sort()) {
    const full = join(dir, entry);
    const info = await stat(full);
    if (info.isDirectory()) {
      if (!SKIP_DIR.has(entry)) await walk(full, base, zip, zipBase);
    } else if (!SKIP_FILE.test(entry)) {
      zip.file(`${zipBase}/${relative(base, full)}`, await readFile(full), { date: new Date(0) });
    }
  }
}

const zip = new JSZip();
for (const [src, dest] of SOURCES) {
  const dir = join(root, src);
  try {
    await stat(dir);
  } catch {
    throw new Error(`Missing ${src}. Did you run "git submodule update --init"?`);
  }
  await walk(dir, dir, zip, dest);
}

const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
const pyodideVersion = JSON.parse(await readFile(join(root, 'node_modules/pyodide/package.json'), 'utf8')).version;

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'bundle.zip'), buf);
await writeFile(
  join(outDir, 'manifest.json'),
  JSON.stringify({ pyodideVersion, pyodidePackages: PYODIDE_PACKAGES, micropipPackages: MICROPIP_PACKAGES, bundleBytes: buf.length }, null, 2) + '\n',
);
console.log(`py bundle: ${(buf.length / 1024).toFixed(0)} KiB -> public/py/bundle.zip`);
