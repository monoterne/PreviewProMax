import { readFileSync } from 'node:fs';

// Different page sizes, split text items, and enough results to overflow the sidebar.
export function fixture() {
  const objects = ['', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids: number[] = [];
  for (let page = 1; page <= 24; page++) {
    const content = `BT /F1 20 Tf 32 720 Td (Page ${page}) Tj 0 -40 Td (alpha target) Tj 0 -40 Td (beta target) Tj 0 -40 Td (split) Tj 0 -28 Td (target) Tj 0 -40 Td (inter-) Tj 0 -28 Td (national) Tj ET`;
    const stream = objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`) - 1;
    kids.push(objects.push(`<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${page % 2 ? 612 : 500} 792] /Resources << /Font << /F1 1 0 R >> >> /Contents ${stream} 0 R >>`) - 1);
  }
  const pages = objects.push(`<< /Type /Pages /Kids [${kids.map(n => `${n} 0 R`).join(' ')}] /Count ${kids.length} >>`) - 1;
  for (const kid of kids) objects[kid] = objects[kid].replace('/Parent 0 0 R', `/Parent ${pages} 0 R`);
  const link = objects.push(`<< /Type /Annot /Subtype /Link /Rect [32 650 150 680] /Border [0 0 0] /Dest [${kids[11]} 0 R /Fit] >>`) - 1;
  objects[kids[0]] = objects[kids[0]].replace(' /Contents', ` /Annots [${link} 0 R] /Contents`);
  const outlineRoot = objects.length;
  objects.push(`<< /Type /Outlines /First ${outlineRoot + 1} 0 R /Last ${outlineRoot + 1} 0 R /Count 2 >>`);
  objects.push(`<< /Title (Chapter one) /Parent ${outlineRoot} 0 R /Dest [${kids[4]} 0 R /Fit] /First ${outlineRoot + 2} 0 R /Last ${outlineRoot + 2} 0 R /Count 1 >>`);
  objects.push(`<< /Title (Section two) /Parent ${outlineRoot + 1} 0 R /Dest (section-two) >>`);
  // An embedded CFF font exercises the same conversion path as LaTeX fonts.
  // Use the redistributable font from PDF.js; never commit a user's document.
  const font = readFileSync('node_modules/pdfjs-dist/standard_fonts/FoxitSerif.pfb').toString('latin1');
  const fontFile = objects.push(`<< /Length ${font.length} /Subtype /Type1C >>\nstream\n${font}\nendstream`) - 1;
  const descriptor = objects.push(`<< /Type /FontDescriptor /FontName /EmbeddedSerif /Flags 34 /FontBBox [-168 -218 1000 898] /ItalicAngle 0 /Ascent 683 /Descent -217 /CapHeight 662 /StemV 80 /FontFile3 ${fontFile} 0 R >>`) - 1;
  objects[1] = `<< /Type /Font /Subtype /Type1 /BaseFont /EmbeddedSerif /Encoding /WinAnsiEncoding /FirstChar 32 /LastChar 126 /Widths [${Array(95).fill(500).join(' ')}] /FontDescriptor ${descriptor} 0 R >>`;
  const root = objects.push(`<< /Type /Catalog /Pages ${pages} 0 R /Outlines ${outlineRoot} 0 R /Names << /Dests << /Names [(section-two) [${kids[11]} 0 R /Fit]] >> >> >>`) - 1;
  let data = '%PDF-1.4\n'; const offsets = [0];
  for (let i = 1; i < objects.length; i++) { offsets.push(data.length); data += `${i} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = data.length;
  data += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) data += `${String(offset).padStart(10, '0')} 00000 n \n`;
  data += `trailer\n<< /Size ${objects.length} /Root ${root} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return [...Buffer.from(data, 'latin1')];
}

