import type { InputPage } from '../types';
import { normalizeSvg } from './svg';

export const MAX_PDF_PAGES = 20;

export interface PdfResult {
  pages: InputPage[];
  warnings: string[];
}

/** Render each PDF page to SVG (text as paths) with MuPDF, then normalise it to a millimetre-sized InputPage. */
export async function loadPdfBytes(bytes: Uint8Array): Promise<PdfResult> {
  const mupdf = await import('mupdf'); // WASM, code-split out of the main bundle
  let doc;
  try {
    doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  } catch {
    throw new Error("Couldn't read this PDF. It may be damaged or not a real PDF file.");
  }
  if (doc.needsPassword()) throw new Error('This PDF is password protected. Remove the password and try again.');

  const total = doc.countPages();
  if (total === 0) throw new Error('This PDF has no pages.');
  const count = Math.min(total, MAX_PDF_PAGES);
  const pages: InputPage[] = [];
  const warnings: string[] = [];
  if (total > count) warnings.push(`This PDF has ${total} pages — only the first ${count} are loaded`);

  for (let i = 0; i < count; i++) {
    const page = doc.loadPage(i);
    const [x0, y0, x1, y1] = page.getBounds();
    const buf = new mupdf.Buffer();
    const writer = new mupdf.DocumentWriter(buf, 'svg', 'text=path');
    const dev = writer.beginPage([x0, y0, x1, y1]);
    page.run(dev, mupdf.Matrix.identity);
    dev.close();
    writer.endPage();
    writer.close();
    // MuPDF writes the size in points as unitless numbers (= px); declare them as points so units convert correctly.
    const raw = new TextDecoder().decode(buf.asUint8Array()).replace(/<svg\b[^>]*>/, (tag) =>
      tag
        .replace(/(\swidth=)"[^"]*"/, `$1"${x1 - x0}pt"`)
        .replace(/(\sheight=)"[^"]*"/, `$1"${y1 - y0}pt"`),
    );
    const { page: p, warnings: w } = normalizeSvg(raw);
    pages.push(p);
    for (const msg of w) warnings.push(count > 1 ? `Page ${i + 1}: ${msg}` : msg);
  }
  return { pages, warnings };
}
