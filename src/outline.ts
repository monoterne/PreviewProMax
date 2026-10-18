import type { PDFDocumentProxy } from 'pdfjs-dist';

let generation = 0;
export async function renderOutline(node: HTMLElement, pdf: PDFDocumentProxy | null, navigate: (page: number) => void) {
  const current = ++generation;
  node.textContent = pdf ? 'Loading contents…' : 'Open a PDF to see its contents.';
  if (!pdf) return;
  try {
    const outline = await pdf.getOutline();
    if (current !== generation) return;
    node.replaceChildren();
    if (!outline?.length) { node.textContent = 'This PDF has no table of contents.'; return; }
    const build = (items: NonNullable<typeof outline>): HTMLElement => {
      const list = document.createElement('ul'); list.className = 'm-0 list-none p-0';
      for (const item of items) {
        const li = document.createElement('li');
        const row = document.createElement('div'); row.className = 'outline-row';
        const button = document.createElement('button'); button.className = 'outline-link'; button.textContent = item.title || 'Untitled';
        button.disabled = !item.dest;
        button.onclick = async () => {
          try {
            const dest = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
            if (!dest || current !== generation) return;
            const index = typeof dest[0] === 'number' ? dest[0] : await pdf.getPageIndex(dest[0]);
            if (current === generation) navigate(index + 1);
          } catch { if (current === generation) button.title = 'This destination is unavailable.'; }
        };
        row.append(button); li.append(row);
        if (item.items.length) {
          const children = build(item.items); children.classList.add('pl-4');
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
