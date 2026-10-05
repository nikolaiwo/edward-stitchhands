/** Built-in example drawing: a little flower (filled shapes + a stroked stem), 80 x 100 mm. */
export const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="100mm" viewBox="0 0 80 100">
  <path d="M40 98 C 40 80, 36 70, 40 52" fill="none" stroke="#2f8f4e" stroke-width="2.4" stroke-linecap="round"/>
  <ellipse cx="29" cy="78" rx="11" ry="5" transform="rotate(-30 29 78)" fill="#3fae63"/>
  <ellipse cx="52" cy="68" rx="11" ry="5" transform="rotate(30 52 68)" fill="#3fae63"/>
  <g fill="#e8508a">
    <circle cx="40" cy="20" r="11"/>
    <circle cx="57" cy="32" r="11"/>
    <circle cx="23" cy="32" r="11"/>
    <circle cx="30" cy="48" r="11"/>
    <circle cx="50" cy="48" r="11"/>
  </g>
  <circle cx="40" cy="35" r="9" fill="#f7c531"/>
  <circle cx="14" cy="10" r="5" fill="#4aa3df"/>
</svg>`;

export function sampleSvgFile(): File {
  return new File([SAMPLE_SVG], 'flower.svg', { type: 'image/svg+xml' });
}
