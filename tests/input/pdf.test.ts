// Node environment (default): MuPDF's WASM runs here; jsdom only supplies DOMParser/XMLSerializer.
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadFile } from '../../src/input';
import { loadPdfBytes } from '../../src/input/pdf';

const fixture = new URL('../fixtures/input/two-page.pdf', import.meta.url);

beforeAll(() => {
  const { window } = new JSDOM('');
  Object.assign(globalThis, { DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer });
});

describe('pdf input', () => {
  it('turns each page into a mm-sized svg page with path content', async () => {
    const { pages, warnings } = await loadPdfBytes(new Uint8Array(readFileSync(fixture)));
    expect(pages).toHaveLength(2);
    expect(pages[0].widthMm).toBeCloseTo((300 * 25.4) / 72, 3);
    expect(pages[0].heightMm).toBeCloseTo((200 * 25.4) / 72, 3);
    expect(pages[1].widthMm).toBeCloseTo((200 * 25.4) / 72, 3);
    expect(pages[1].heightMm).toBeCloseTo((300 * 25.4) / 72, 3);
    expect(pages[0].svg).toMatch(/width="105\.8333mm"/);
    expect(pages[0].svg).toContain('viewBox="0 0 300 200"');
    expect(pages[0].svg.match(/<path\b/g)).toHaveLength(2);
    expect(pages[1].svg.match(/<path\b/g)).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it('loadFile dispatches PDFs', async () => {
    const file = new File([readFileSync(fixture)], 'two-page.pdf', { type: 'application/pdf' });
    const doc = await loadFile(file);
    expect(doc.kind).toBe('pdf');
    expect(doc.name).toBe('two-page');
    expect(doc.pages).toHaveLength(2);
  });

  it('rejects garbage with a friendly message', async () => {
    await expect(loadPdfBytes(new TextEncoder().encode('not a pdf'))).rejects.toThrow(/PDF/);
  });
});
