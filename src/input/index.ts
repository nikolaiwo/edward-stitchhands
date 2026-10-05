import type { InputDocument } from '../types';
import { normalizeSvg } from './svg';

export { resizePage } from './svg';

const UNSUPPORTED =
  "Sorry, that file type isn't supported. Please choose an SVG or PDF drawing (PNG/JPG photos can't be stitched directly).";

/** Parse SVG markup into a single-page document. Throws a friendly Error on invalid input. */
export function loadSvgText(text: string, name: string): InputDocument {
  const { page, warnings } = normalizeSvg(text);
  return { name, kind: 'svg', pages: [page], warnings };
}

function baseName(filename: string): string {
  return filename.replace(/\.[^./\\]+$/, '') || filename;
}

export async function loadFile(file: File): Promise<InputDocument> {
  const name = baseName(file.name);
  const ext = /\.([^.]+)$/.exec(file.name)?.[1].toLowerCase() ?? '';
  const mime = file.type.toLowerCase();
  if (mime === 'image/svg+xml' || ext === 'svg') return loadSvgText(await file.text(), name);
  if (mime === 'application/pdf' || ext === 'pdf') {
    const { loadPdfBytes } = await import('./pdf');
    const { pages, warnings } = await loadPdfBytes(new Uint8Array(await file.arrayBuffer()));
    return { name, kind: 'pdf', pages, warnings };
  }
  throw new Error(UNSUPPORTED);
}
