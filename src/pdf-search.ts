import type { PDFDocumentProxy } from 'pdfjs-dist';
import { makeSearchHit, type SearchHit } from './search';

// PDF.js needs RegExp.escape; macOS 15's WebKit predates it. Escaping every
// UTF-16 code unit also handles punctuation safely in Unicode regular expressions.
const regex = RegExp as typeof RegExp & { escape?: (text: string) => string };
regex.escape ??= text => text.split('').map(char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');

export async function searchPdf(pdf: PDFDocumentProxy, query: string, signal: AbortSignal): Promise<SearchHit[]> {
  const { EventBus, PDFFindController, PDFLinkService } = await import('pdfjs-dist/web/pdf_viewer.mjs');
  signal.throwIfAborted();
  // Our sidebar owns navigation; the find controller only supplies canonical offsets.
  class SearchLinks extends PDFLinkService {
    get page() { return 1; }
    set page(_value: number) {}
  }
  const eventBus = new EventBus();
  const links = new SearchLinks({ eventBus });
  links.setDocument(pdf);
  const controller = new PDFFindController({ eventBus, linkService: links, updateMatchesCountOnProgress: false });
  controller.setDocument(pdf);
  try {
    await new Promise<void>((resolve, reject) => {
      const complete = () => { cleanup(); resolve(); };
      const abort = () => { cleanup(); reject(signal.reason); };
      const cleanup = () => { eventBus.off('updatefindmatchescount', complete); signal.removeEventListener('abort', abort); };
      eventBus.on('updatefindmatchescount', complete);
      signal.addEventListener('abort', abort, { once: true });
      eventBus.dispatch('find', { type: 'again', query, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: false, matchDiacritics: false });
    });
    const hits: SearchHit[] = [];
    for (let index = 0; index < pdf.numPages; index++) {
      signal.throwIfAborted();
      const starts: number[] = controller.pageMatches?.[index] || [];
      if (!starts.length) continue;
      const content = await (await pdf.getPage(index + 1)).getTextContent({ disableNormalization: true });
      // Keep source offsets for highlights, but put line breaks back into snippets.
      let text = '', rawLength = 0;
      const breaks: number[] = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str; rawLength += item.str.length;
        if (item.hasEOL) { text += '\n'; breaks.push(rawLength); }
      }
      starts.forEach((start, occurrence) => {
        const end = start + controller.pageMatchesLength![index][occurrence];
        const displayStart = start + breaks.filter(offset => offset <= start).length;
        const displayEnd = end + breaks.filter(offset => offset < end).length;
        hits.push({ ...makeSearchHit(text, index + 1, occurrence + 1, displayStart, displayEnd), start, end });
      });
    }
    signal.throwIfAborted();
    return hits;
  } finally {
    // Upstream supports null for disposal, although its generated typings omit it.
    controller.setDocument(null as unknown as PDFDocumentProxy);
  }
}
