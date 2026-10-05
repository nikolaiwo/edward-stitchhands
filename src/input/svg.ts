import type { InputPage } from '../types';
import { fmt, lengthToMm, MM_PER_PX } from './units';

const INKSCAPE_NS = 'http://www.inkscape.org/namespaces/inkscape';
const SODIPODI_NS = 'http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd';
/** Inkscape attributes that carry meaning (layers) and are kept. */
const KEEP_INKSCAPE_ATTRS = new Set(['groupmode', 'label']);
const STITCHABLE = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const PAINT_SERVERS = new Set(['lineargradient', 'radialgradient', 'meshgradient', 'pattern']);

export interface NormalizedSvg {
  page: InputPage;
  warnings: string[];
}

function parseViewBox(value: string | null): [number, number, number, number] | null {
  if (!value) return null;
  const n = value.trim().split(/[\s,]+/).map(Number);
  if (n.length !== 4 || n.some((x) => !Number.isFinite(x)) || n[2] <= 0 || n[3] <= 0) return null;
  return [n[0], n[1], n[2], n[3]];
}

function isHidden(el: Element): boolean {
  if (el.getAttribute('display')?.trim() === 'none') return true;
  if (el.getAttribute('visibility')?.trim() === 'hidden') return true;
  const style = el.getAttribute('style');
  return !!style && /(^|;)\s*(display\s*:\s*none|visibility\s*:\s*hidden)\s*(;|$|!)/i.test(style);
}

function removeCruft(root: Element): void {
  for (const el of Array.from(root.getElementsByTagName('*'))) {
    const ns = el.namespaceURI;
    if (el.localName === 'metadata' || ns === SODIPODI_NS || (ns === INKSCAPE_NS && el.localName !== 'g')) {
      el.remove();
      continue;
    }
    if (isHidden(el) && !el.closest('defs')) {
      el.remove();
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      if (attr.namespaceURI === SODIPODI_NS) el.removeAttributeNode(attr);
      else if (attr.namespaceURI === INKSCAPE_NS && !KEEP_INKSCAPE_ATTRS.has(attr.localName)) {
        el.removeAttributeNode(attr);
      }
    }
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function collectWarnings(root: Element): string[] {
  const all = Array.from(root.getElementsByTagName('*'));
  const byId = new Map<string, Element>();
  for (const el of all) {
    const id = el.getAttribute('id');
    if (id) byId.set(id, el);
  }
  const count = (name: string) => all.filter((e) => e.localName === name).length;
  const warnings: string[] = [];

  const text = count('text');
  if (text) {
    warnings.push(
      `Text isn't stitched — convert text to paths in your editor first (${plural(text, 'text element', 'text elements')})`,
    );
  }
  const images = count('image');
  if (images) {
    warnings.push(`Embedded images aren't stitched — only vector shapes are (${plural(images, 'image', 'images')})`);
  }

  let gradientFills = 0;
  let filtered = 0;
  let clipped = 0;
  let externalUse = 0;
  for (const el of all) {
    const style = el.getAttribute('style') ?? '';
    const fillStrokeRefs = [
      ...(el.getAttribute('fill')?.matchAll(/url\(\s*['"]?#([^'")\s]+)/g) ?? []),
      ...(el.getAttribute('stroke')?.matchAll(/url\(\s*['"]?#([^'")\s]+)/g) ?? []),
      ...style.matchAll(/(?:^|;)\s*(?:fill|stroke)\s*:\s*url\(\s*['"]?#([^'")\s]+)/g),
    ];
    if (fillStrokeRefs.some((m) => PAINT_SERVERS.has(byId.get(m[1])?.localName.toLowerCase() ?? ''))) gradientFills++;
    if (el.hasAttribute('filter') || /(^|;)\s*filter\s*:\s*url/.test(style)) filtered++;
    if (el.hasAttribute('clip-path') || el.hasAttribute('mask') || /(^|;)\s*(clip-path|mask)\s*:\s*url/.test(style)) {
      clipped++;
    }
    if (el.localName === 'use') {
      const href = el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '';
      if (href && !href.startsWith('#')) externalUse++;
    }
  }
  if (gradientFills) {
    warnings.push(
      `Gradients and patterns can't be stitched — a fallback colour will be used (${plural(gradientFills, 'shape', 'shapes')})`,
    );
  }
  if (clipped || count('clippath') || count('mask')) {
    warnings.push("Clipping paths and masks are ignored — the shapes are stitched unclipped (use Path > Intersection in your editor)");
  }
  if (filtered) {
    warnings.push(`Filters (blur, shadows, …) are ignored (${plural(filtered, 'shape', 'shapes')})`);
  }
  if (externalUse) {
    warnings.push(`Linked external files can't be loaded and are skipped (${plural(externalUse, 'reference', 'references')})`);
  }

  if (!all.some((e) => STITCHABLE.has(e.localName) && !e.closest('defs'))) {
    warnings.push('Nothing to stitch — the drawing contains no paths or shapes');
  }
  return [...new Set(warnings)];
}

/** Parse an SVG string, determine its physical size and return a cleaned page plus warnings. */
export function normalizeSvg(text: string): NormalizedSvg {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) {
    const msg = (err.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    throw new Error(`This doesn't look like a valid SVG file (${msg || 'XML parse error'}).`);
  }
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg') {
    throw new Error("This file isn't an SVG drawing (no <svg> root element).");
  }

  const vb = parseViewBox(root.getAttribute('viewBox'));
  let w = lengthToMm(root.getAttribute('width'));
  let h = lengthToMm(root.getAttribute('height'));
  if (vb) {
    if (w === null && h === null) {
      w = vb[2] * MM_PER_PX;
      h = vb[3] * MM_PER_PX;
    } else if (w === null) w = (h as number) * (vb[2] / vb[3]);
    else if (h === null) h = w * (vb[3] / vb[2]);
  } else if (w === null || h === null) {
    throw new Error("Can't work out the size of this SVG: it needs a width and height, or a viewBox.");
  }
  const widthMm = w as number;
  const heightMm = h as number;

  // Keep drawing coordinates unchanged: without a viewBox, user units are px.
  const viewBox = vb ?? [0, 0, widthMm / MM_PER_PX, heightMm / MM_PER_PX];
  root.setAttribute('viewBox', viewBox.map(fmt).join(' '));
  root.setAttribute('width', `${fmt(widthMm)}mm`);
  root.setAttribute('height', `${fmt(heightMm)}mm`);

  removeCruft(root);
  const warnings = collectWarnings(root);
  const svg = new XMLSerializer().serializeToString(root);
  return { page: { svg, widthMm, heightMm }, warnings };
}

/** Scale a page to a new physical size; the drawing (viewBox) is untouched. */
export function resizePage(page: InputPage, widthMm: number, heightMm: number): InputPage {
  if (!(widthMm > 0) || !(heightMm > 0) || !Number.isFinite(widthMm) || !Number.isFinite(heightMm)) {
    throw new Error('Width and height must be positive numbers.');
  }
  const svg = page.svg.replace(/<svg\b[^>]*>/, (tag) =>
    tag
      .replace(/(\swidth\s*=\s*)(["'])[^"']*\2/, `$1"${fmt(widthMm)}mm"`)
      .replace(/(\sheight\s*=\s*)(["'])[^"']*\2/, `$1"${fmt(heightMm)}mm"`),
  );
  return { svg, widthMm, heightMm };
}
