// Stand-in for src/input/index.ts (same signatures). Swap via src/ui/deps.ts.
import type { InputDocument, InputPage } from '../types';
import { SAMPLE_SVG } from './sample';

const UNITS_TO_MM: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 25.4 / 96 };

function parseLen(v: string | null): number | null {
  if (!v) return null;
  const m = /^\s*([0-9.+-eE]+)\s*([a-z%]*)\s*$/.exec(v);
  if (!m || m[2] === '%') return null;
  const n = parseFloat(m[1]);
  const f = UNITS_TO_MM[m[2]];
  return Number.isFinite(n) && f !== undefined ? n * f : null;
}

function svgToPage(text: string): InputPage {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || doc.querySelector('parsererror')) throw new Error('This does not look like a valid SVG file.');
  const vb = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const hasVb = vb.length === 4 && vb.every(Number.isFinite);
  let w = parseLen(root.getAttribute('width'));
  let h = parseLen(root.getAttribute('height'));
  if ((w === null || h === null) && hasVb) {
    w ??= vb[2] * UNITS_TO_MM.px;
    h ??= vb[3] * UNITS_TO_MM.px;
  }
  if (w === null || h === null || w <= 0 || h <= 0) throw new Error('Could not determine the size of the SVG (add width/height or a viewBox).');
  if (!hasVb) root.setAttribute('viewBox', `0 0 ${w / UNITS_TO_MM.px} ${h / UNITS_TO_MM.px}`);
  root.setAttribute('width', `${w}mm`);
  root.setAttribute('height', `${h}mm`);
  return { svg: new XMLSerializer().serializeToString(root), widthMm: w, heightMm: h };
}

export async function loadFile(file: File): Promise<InputDocument> {
  const name = file.name;
  const isPdf = /\.pdf$/i.test(name) || file.type === 'application/pdf';
  if (isPdf) {
    const base = svgToPage(SAMPLE_SVG);
    const page2 = svgToPage(
      SAMPLE_SVG.replace('width="80mm" height="100mm"', 'width="100mm" height="80mm"').replace('viewBox="0 0 80 100"', 'viewBox="-10 10 100 80"'),
    );
    return { name, kind: 'pdf', pages: [base, page2], warnings: ['Fake input module: PDF contents are replaced by a placeholder drawing.'] };
  }
  const text = await file.text();
  return { name, kind: 'svg', pages: [svgToPage(text)], warnings: /<(text|image|linearGradient|filter)\b/.test(text) ? ['Text, images, gradients and filters are not stitched.'] : [] };
}

export function resizePage(page: InputPage, widthMm: number, heightMm: number): InputPage {
  const doc = new DOMParser().parseFromString(page.svg, 'image/svg+xml');
  const root = doc.documentElement;
  root.setAttribute('width', `${widthMm}mm`);
  root.setAttribute('height', `${heightMm}mm`);
  root.setAttribute('preserveAspectRatio', 'none');
  return { svg: new XMLSerializer().serializeToString(root), widthMm, heightMm };
}
