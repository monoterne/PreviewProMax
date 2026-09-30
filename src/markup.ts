export type MarkupKind = 'yellow' | 'green' | 'blue' | 'pink' | 'underline' | 'strike';
export type Markup = {
  page: number;
  startItem: number;
  startOffset: number;
  endItem: number;
  endOffset: number;
  kind: MarkupKind;
};
export type TextItems = { divs: HTMLElement[]; strings: string[] };

function offsetWithin(span: HTMLElement, container: Node, offset: number): number {
  const prefix = document.createRange();
  prefix.selectNodeContents(span);
  prefix.setEnd(container, offset);
  return prefix.toString().length;
}

export function selectedMarkup(range: Range, shell: HTMLElement, text: TextItems): Omit<Markup, 'kind'> | null {
  let startItem = -1, endItem = -1, startOffset = 0, endOffset = 0;
  for (let i = 0; i < text.divs.length; i++) {
    const span = text.divs[i];
    if (!text.strings[i] || !range.intersectsNode(span)) continue;
    const start = span.contains(range.startContainer) ? offsetWithin(span, range.startContainer, range.startOffset) : 0;
    const end = span.contains(range.endContainer) ? offsetWithin(span, range.endContainer, range.endOffset) : text.strings[i].length;
    if (end <= start) continue;
    if (startItem < 0) { startItem = i; startOffset = start; }
    endItem = i; endOffset = end;
  }
  return startItem < 0 ? null : { page: Number(shell.dataset.page), startItem, startOffset, endItem, endOffset };
}

function textPoint(span: HTMLElement, offset: number): [Node, number] {
  const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let remaining = offset;
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) return [node, remaining];
    remaining -= length;
    node = walker.nextNode();
  }
  return [span, span.childNodes.length];
}

export function paintMarkup(shell: HTMLElement, text: TextItems, annotations: Markup[]) {
  const content = shell.querySelector<HTMLElement>('.page-content');
  if (!content) return;
  const matching = annotations.filter(item => item.page === Number(shell.dataset.page));
  let layer = content.querySelector<HTMLElement>('.markup-layer');
  if (!matching.length && !layer) return;
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'markup-layer';
    content.appendChild(layer);
  }
  layer.replaceChildren();
  if (!matching.length) return;
  const bounds = content.getBoundingClientRect();
  const scaleX = bounds.width / content.offsetWidth || 1;
  const scaleY = bounds.height / content.offsetHeight || 1;
  const fragment = document.createDocumentFragment();
  for (const item of matching) {
    const first = text.divs[item.startItem], last = text.divs[item.endItem];
    if (!first || !last) continue;
    try {
      const range = document.createRange();
      range.setStart(...textPoint(first, item.startOffset));
      range.setEnd(...textPoint(last, item.endOffset));
      for (const rect of Array.from(range.getClientRects())) {
        if (!rect.width || !rect.height) continue;
        const mark = document.createElement('span');
        mark.className = `markup-mark markup-${item.kind}`;
        mark.style.left = `${(rect.left - bounds.left) / scaleX}px`;
        mark.style.top = `${(rect.top - bounds.top) / scaleY}px`;
        mark.style.width = `${rect.width / scaleX}px`;
        mark.style.height = `${rect.height / scaleY}px`;
        fragment.appendChild(mark);
      }
    } catch { /* A malformed saved range should not hide the PDF. */ }
  }
  layer.appendChild(fragment);
}

export function overlaps(a: Omit<Markup, 'kind'>, b: Omit<Markup, 'kind'>) {
  if (a.page !== b.page) return false;
  const aStartsBeforeBEnds = a.startItem < b.endItem || (a.startItem === b.endItem && a.startOffset < b.endOffset);
  const bStartsBeforeAEnds = b.startItem < a.endItem || (b.startItem === a.endItem && b.startOffset < a.endOffset);
  return aStartsBeforeBEnds && bStartsBeforeAEnds;
}
