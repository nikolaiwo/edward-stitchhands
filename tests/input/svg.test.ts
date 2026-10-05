// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { loadFile, loadSvgText, resizePage } from '../../src/input';

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const svg = (attrs: string, body = '<path d="M0 0L10 10"/>') => `<svg ${NS} ${attrs}>${body}</svg>`;
const load = (attrs: string, body?: string) => loadSvgText(svg(attrs, body), 'x');

describe('size detection', () => {
  it.each([
    ['100mm', '50mm', 100, 50],
    ['10cm', '5cm', 100, 50],
    ['2in', '1in', 50.8, 25.4],
    ['72pt', '36pt', 25.4, 12.7],
    ['6pc', '3pc', 25.4, 12.7],
    ['96px', '48px', 25.4, 12.7],
    ['96', '96', 25.4, 25.4],
  ])('width=%s height=%s', (w, h, mmW, mmH) => {
    const page = load(`width="${w}" height="${h}"`).pages[0];
    expect(page.widthMm).toBeCloseTo(mmW, 3);
    expect(page.heightMm).toBeCloseTo(mmH, 3);
    expect(page.svg).toMatch(/width="[\d.]+mm"/);
    expect(page.svg).toMatch(/height="[\d.]+mm"/);
  });

  it('uses the viewBox at 96 dpi for percentages and missing sizes', () => {
    for (const attrs of ['width="100%" height="100%" viewBox="0 0 192 96"', 'viewBox="0 0 192 96"']) {
      const p = load(attrs).pages[0];
      expect(p.widthMm).toBeCloseTo(50.8, 3);
      expect(p.heightMm).toBeCloseTo(25.4, 3);
      expect(p.svg).toContain('viewBox="0 0 192 96"');
    }
  });

  it('keeps an existing viewBox untouched when width/height are given', () => {
    const p = load('width="50mm" height="25mm" viewBox="10 20 200 100"').pages[0];
    expect(p.svg).toContain('viewBox="10 20 200 100"');
  });

  it('derives a missing dimension from the viewBox aspect ratio', () => {
    const p = load('width="100mm" viewBox="0 0 200 100"').pages[0];
    expect(p.heightMm).toBeCloseTo(50, 3);
  });

  it('synthesises a viewBox in user units (px) from width/height', () => {
    const p = load('width="25.4mm" height="50.8mm"').pages[0];
    expect(p.svg).toContain('viewBox="0 0 96 192"');
  });

  it('rejects svgs with no determinable size', () => {
    expect(() => load('')).toThrow(/size/);
  });

  it('reports parse errors and non-svg roots clearly', () => {
    expect(() => loadSvgText('<svg><path></svg>', 'x')).toThrow(/valid SVG/);
    expect(() => loadSvgText('<html xmlns="http://www.w3.org/1999/xhtml"/>', 'x')).toThrow(/isn't an SVG/);
  });
});

describe('cleanup', () => {
  it('removes hidden elements, metadata and editor cruft but keeps layers, styles and inkstitch attrs', () => {
    const doc = loadSvgText(
      `<svg ${NS} xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
        xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
        xmlns:inkstitch="http://inkstitch.org/namespace" width="50mm" height="50mm" viewBox="0 0 50 50">
        <metadata>meta</metadata>
        <sodipodi:namedview id="nv" inkscape:zoom="2"/>
        <style>.a{fill:red}</style>
        <g inkscape:groupmode="layer" inkscape:label="L1" inkscape:current-layer="x" sodipodi:insensitive="true">
          <path id="keep" class="a" style="fill:#f00" inkstitch:fill_underlay="False" d="M0 0L5 5"/>
          <path id="h1" style="display:none" d="M0 0L5 5"/>
          <path id="h2" style="fill:red; visibility: hidden" d="M0 0L5 5"/>
          <path id="h3" display="none" d="M0 0L5 5"/>
        </g>
      </svg>`,
      'x',
    );
    const s = doc.pages[0].svg;
    expect(s).not.toMatch(/metadata|namedview|id="h\d"|sodipodi:insensitive|current-layer/);
    expect(s).toContain('inkscape:groupmode="layer"');
    expect(s).toContain('inkscape:label="L1"');
    expect(s).toContain('inkstitch:fill_underlay="False"');
    expect(s).toContain('style="fill:#f00"');
    expect(s).toContain('<style>.a{fill:red}</style>');
    expect(doc.warnings).toEqual([]);
  });
});

describe('warnings', () => {
  it('warns about text with a count', () => {
    const w = load('width="50mm" height="50mm"', '<path d="M0 0L1 1"/><text>a</text><text>b</text>').warnings;
    expect(w).toContain("Text isn't stitched — convert text to paths in your editor first (2 text elements)");
  });

  it('warns about images, gradients, clip paths, filters and external use', () => {
    const w = load(
      'width="50mm" height="50mm" xmlns:xlink="http://www.w3.org/1999/xlink"',
      `<defs><linearGradient id="g"/><clipPath id="c"><rect width="1" height="1"/></clipPath><filter id="f"/></defs>
       <image href="a.png" width="1" height="1"/>
       <rect width="5" height="5" fill="url(#g)"/>
       <rect width="5" height="5" style="stroke:url(#g)"/>
       <rect width="5" height="5" clip-path="url(#c)" filter="url(#f)"/>
       <use xlink:href="other.svg#a"/>
       <use href="#g"/>`,
    ).warnings;
    const joined = w.join('\n');
    expect(joined).toMatch(/Embedded images/);
    expect(joined).toMatch(/Gradients and patterns.*2 shapes/);
    expect(joined).toMatch(/Clipping paths and masks/);
    expect(joined).toMatch(/Filters/);
    expect(joined).toMatch(/external files.*1 reference\b/);
    expect(new Set(w).size).toBe(w.length);
  });

  it('does not warn for solid fills', () => {
    expect(load('width="50mm" height="50mm"', '<rect width="5" height="5" fill="#f00"/>').warnings).toEqual([]);
  });

  it('warns when nothing is stitchable', () => {
    expect(load('width="50mm" height="50mm"', '<g/>').warnings.join()).toMatch(/Nothing to stitch/);
  });

  it('warns for oversize and tiny designs', () => {
    expect(load('width="500mm" height="100mm"').warnings.join()).toMatch(/larger than 400/);
    expect(load('width="2mm" height="2mm"').warnings.join()).toMatch(/very small/);
    expect(load('width="400mm" height="400mm"').warnings).toEqual([]);
  });
});

describe('resizePage', () => {
  it('changes width/height only and keeps the viewBox', () => {
    const page = load('width="100mm" height="50mm" viewBox="0 0 200 100"').pages[0];
    const r = resizePage(page, 60, 30);
    expect(r.widthMm).toBe(60);
    expect(r.heightMm).toBe(30);
    expect(r.svg).toContain('width="60mm"');
    expect(r.svg).toContain('height="30mm"');
    expect(r.svg).toContain('viewBox="0 0 200 100"');
    expect(r.svg).toContain('<path d="M0 0L10 10"/>');
    expect(page.widthMm).toBe(100);
  });

  it('does not touch stroke-width on the root and rejects bad sizes', () => {
    const page = load('width="10mm" height="10mm" stroke-width="3"').pages[0];
    expect(resizePage(page, 20, 20).svg).toContain('stroke-width="3"');
    expect(() => resizePage(page, 0, 5)).toThrow();
  });
});

describe('loadFile', () => {
  it('loads an svg file and strips the extension from the name', async () => {
    const file = new File([svg('width="10mm" height="10mm"')], 'my drawing.svg', { type: 'image/svg+xml' });
    const doc = await loadFile(file);
    expect(doc.kind).toBe('svg');
    expect(doc.name).toBe('my drawing');
    expect(doc.pages).toHaveLength(1);
  });

  it('rejects unsupported types with a friendly message', async () => {
    await expect(loadFile(new File(['x'], 'photo.png', { type: 'image/png' }))).rejects.toThrow(/SVG or PDF/);
  });
});
