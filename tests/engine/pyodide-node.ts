import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadPyodide, type PyodideInterface } from 'pyodide';

export const root = resolve(import.meta.dirname, '../..');

/** Loads Pyodide in Node and installs the built bundle exactly like the browser worker does. */
export async function loadEngineInNode(): Promise<PyodideInterface> {
  const manifest = JSON.parse(await readFile(join(root, 'public/py/manifest.json'), 'utf8'));
  const bundle = new Uint8Array(await readFile(join(root, 'public/py/bundle.zip')));
  const pyodide = await loadPyodide();
  await pyodide.loadPackage(manifest.pyodidePackages, { messageCallback: () => {} });
  const micropip = pyodide.pyimport('micropip');
  await micropip.install.callKwargs(manifest.micropipPackages, { deps: false });
  micropip.destroy();
  pyodide.unpackArchive(bundle, 'zip', { extractDir: '/app' });
  pyodide.runPython(`import sys; sys.path[:0] = ["/app", "/app/inkstitch"]`);
  return pyodide;
}
