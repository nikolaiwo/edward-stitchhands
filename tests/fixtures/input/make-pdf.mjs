// Regenerates tests/fixtures/input/two-page.pdf: node tests/fixtures/input/make-pdf.mjs
import * as mupdf from 'mupdf';
import { writeFileSync } from 'node:fs';

const doc = new mupdf.PDFDocument();
const page = (w, h, content) => doc.addPage([0, 0, w, h], 0, {}, content);
// Page 1: 300x200 pt with a filled rect and a triangle.
doc.insertPage(-1, page(300, 200, '1 0 0 rg 20 20 100 80 re f\n0 0 1 rg 150 30 m 250 30 l 200 150 l h f\n'));
// Page 2: 200x300 pt with a stroked curve.
doc.insertPage(-1, page(200, 300, '0 0.6 0 RG 4 w 100 100 m 100 200 150 200 150 150 c S\n'));
writeFileSync(new URL('./two-page.pdf', import.meta.url), doc.saveToBuffer('compress').asUint8Array());
