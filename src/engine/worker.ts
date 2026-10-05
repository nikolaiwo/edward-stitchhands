/// <reference lib="webworker" />
// Module worker: loads Pyodide from the jsDelivr CDN, installs Ink/Stitch's runtime and runs conversions.
import type { PyodideInterface } from 'pyodide';
import type { EngineProgress, Format } from '../types.ts';
import type { WireResult, WorkerRequest, WorkerResponse } from './protocol.ts';

interface Manifest {
  /** Equals the installed npm `pyodide` version; written by scripts/build-pybundle.mjs. */
  pyodideVersion: string;
  pyodidePackages: string[];
  micropipPackages: string[];
  bundleBytes: number;
}

const base = import.meta.env.BASE_URL;
let pyodidePromise: Promise<PyodideInterface> | undefined;

function post(message: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(message, transfer);
}

async function fetchBundle(url: string, total: number, onFraction: (f: number) => void): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Could not download ${url} (${response.status})`);
  const size = Number(response.headers.get('content-length')) || total;
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (size) onFraction(Math.min(1, received / size));
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function loadEngine(report: (p: EngineProgress) => void): Promise<PyodideInterface> {
  report({ stage: 'download', message: 'Downloading embroidery engine…', fraction: 0 });
  const manifest: Manifest = await (await fetch(`${base}py/manifest.json`)).json();

  const { loadPyodide } = (await import(
    /* @vite-ignore */ `https://cdn.jsdelivr.net/pyodide/v${manifest.pyodideVersion}/full/pyodide.mjs`
  )) as typeof import('pyodide');
  const pyodideLoading = loadPyodide();
  const bundlePromise = fetchBundle(`${base}py/bundle.zip`, manifest.bundleBytes, (f) =>
    report({ stage: 'download', message: 'Downloading embroidery engine…', fraction: f * 0.5 }),
  );
  const [pyodide, bundle] = await Promise.all([pyodideLoading, bundlePromise]);

  report({ stage: 'install', message: 'Installing Python packages…', fraction: 0.5 });
  await pyodide.loadPackage(manifest.pyodidePackages, {
    messageCallback: () => {},
    errorCallback: console.error,
  });
  report({ stage: 'install', message: 'Installing stitching libraries…', fraction: 0.8 });
  const micropip = pyodide.pyimport('micropip');
  // Pinned pure-Python wheels; deps are covered by pyodidePackages (avoids pulling in matplotlib & co).
  await micropip.install.callKwargs(manifest.micropipPackages, { deps: false });
  micropip.destroy();

  report({ stage: 'install', message: 'Unpacking Ink/Stitch…', fraction: 0.95 });
  pyodide.unpackArchive(bundle, 'zip', { extractDir: '/app' });
  pyodide.runPython('import sys; sys.path[:0] = ["/app", "/app/inkstitch"]');
  // Import once so the first conversion does not pay for it.
  await pyodide.runPythonAsync('import edward.convert');

  report({ stage: 'ready', message: 'Engine ready', fraction: 1 });
  return pyodide;
}

function init(report: (p: EngineProgress) => void): Promise<PyodideInterface> {
  pyodidePromise ??= loadEngine(report).catch((e) => {
    pyodidePromise = undefined; // allow a retry
    throw e;
  });
  return pyodidePromise;
}

async function convert(
  pyodide: PyodideInterface,
  req: Extract<WorkerRequest, { type: 'convert' }>,
): Promise<{ result: WireResult; transfer: Transferable[] }> {
  const { page, options, baseName } = req;
  const formats = options.formats;
  pyodide.globals.set('_edward_svg', page.svg);
  pyodide.globals.set('_edward_options', JSON.stringify(options));
  pyodide.globals.set('_edward_formats', pyodide.toPy(formats));
  pyodide.globals.set('_edward_name', baseName);
  let proxy;
  try {
    proxy = await pyodide.runPythonAsync(
      'from edward.convert import convert\n' +
        'convert(_edward_svg, _edward_options, list(_edward_formats), _edward_name)',
    );
    const data = proxy.toJs({ dict_converter: Object.fromEntries });
    const transfer: Transferable[] = [];
    const files = formats.map((format: Format) => {
      const bytes = data.files[format] as Uint8Array;
      transfer.push(bytes.buffer);
      return { format, filename: `${baseName}.${format}`, bytes };
    });
    const blocks = (data.plan.blocks as Record<string, any>[]).map((b) => {
      // numpy bytes -> typed arrays that own their (transferable) buffers
      const coords = new Float32Array((b.coords as Uint8Array).slice().buffer);
      const flags = (b.flags as Uint8Array).slice();
      transfer.push(coords.buffer, flags.buffer);
      return { color: b.color as string, threadName: (b.threadName ?? undefined) as string | undefined, coords, flags };
    });
    const { blocks: _unused, ...rest } = data.plan;
    const plan = { ...rest, colorBlocks: blocks };
    return { result: { plan, files, warnings: data.warnings as string[] }, transfer };
  } finally {
    proxy?.destroy();
    for (const name of ['_edward_svg', '_edward_options', '_edward_formats', '_edward_name']) pyodide.globals.delete(name);
  }
}

/** The Python exception's last line is the human-readable part. */
function friendlyError(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  const lines = text.trim().split('\n');
  const last = lines[lines.length - 1];
  return last.replace(/^(\w+\.)*\w*(Error|Exception): /, '') || text;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  const report = (progress: EngineProgress) => post({ id: req.id, type: 'progress', progress });
  try {
    const pyodide = await init(report);
    if (req.type === 'init') {
      post({ id: req.id, type: 'done' });
    } else {
      report({ stage: 'convert', message: 'Converting to stitches…' });
      const { result, transfer } = await convert(pyodide, req);
      post({ id: req.id, type: 'done', result }, transfer);
    }
  } catch (e) {
    post({ id: req.id, type: 'error', message: friendlyError(e) });
  }
};
