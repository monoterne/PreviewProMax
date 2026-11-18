import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PdfDestination } from './pdf-rendering';

let generation = 0;
export async function renderOutline(node: HTMLElement, pdf: PDFDocumentProxy | null, navigate: (pdf: PDFDocumentProxy, destination: PdfDestination) => Promise<void>) {
  const current = ++generation;
  node.textContent = pdf ? 'Loading contents…' : 'Open a PDF to see its contents.';
  if (!pdf) return;
  try {
    const outline = await pdf.getOutline();
    if (current !== generation) return;
    node.replaceChildren();
    if (!outline?.length) { node.textContent = 'This PDF has no table of contents.'; return; }
    const build = (items: NonNullable<typeof outline>): HTMLElement => {
      const list = document.createElement('ul'); list.className = 'outline-list';
      for (const item of items) {
        const li = document.createElement('li');
        const row = document.createElement('div'); row.className = 'outline-row';
        const button = document.createElement('button'); button.className = 'outline-link'; button.textContent = item.title || 'Untitled';
        button.disabled = !item.dest;
        button.onclick = async () => {
          if (current !== generation || !item.dest) return;
          try { await navigate(pdf, item.dest); }
          catch { if (current === generation) button.title = 'This destination is unavailable.'; }
        };
        row.append(button); li.append(row);
        if (item.items.length) {
          const children = build(item.items);
          const toggle = document.createElement('button'); toggle.className = 'outline-toggle';
          toggle.setAttribute('aria-label', `Expand ${item.title}`);
          const setOpen = (open: boolean) => { children.hidden = !open; toggle.textContent = open ? '▾' : '▸'; toggle.setAttribute('aria-expanded', String(open)); toggle.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} ${item.title}`); };
          setOpen(Number(item.count ?? 0) >= 0);
          toggle.onclick = () => setOpen(children.hidden === true);
          row.prepend(toggle); li.append(children);
        }
        list.append(li);
      }
      return list;
    };
    node.append(build(outline));
  } catch { if (current === generation) node.textContent = 'Unable to read the table of contents.'; }
}
