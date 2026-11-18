import './compatibility';
import { TextLayer, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { darkenOutsideImages } from './dark-page';

type Viewport = ReturnType<PDFPageProxy['getViewport']>;

export function releaseCanvases(root: Element) {
  root.querySelectorAll('canvas').forEach(canvas => { canvas.width = 0; canvas.height = 0; });
}

// Main pages and thumbnails use the same bounded raster and dark-page treatment.
export async function renderRaster(page: PDFPageProxy, viewport: Viewport, ratio: number, preserveImages: boolean) {
  const canvas = document.createElement('canvas');
  ratio = Math.min(ratio, Math.sqrt(8_000_000 / (viewport.width * viewport.height)));
  canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
  canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas is unavailable.');
  try {
    if (preserveImages) page.imageCoordinates = null;
    await page.render({ canvasContext: context, canvas, viewport,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0], recordImages: preserveImages }).promise;
    if (preserveImages) {
      try { darkenOutsideImages(canvas, page.imageCoordinates); }
      catch (error) { canvas.classList.add('dark-filter-fallback'); console.error('Unable to preserve image colors:', error); }
    }
    return canvas;
  } catch (error) {
    canvas.width = 0; canvas.height = 0;
    throw error;
  }
}

export async function renderText(page: PDFPageProxy, viewport: Viewport) {
  const element = document.createElement('div');
  element.className = 'textLayer';
  element.style.setProperty('--scale-factor', String(viewport.scale));
  element.style.setProperty('--total-scale-factor', String(viewport.scale * viewport.userUnit));
  const content = await page.getTextContent({ disableNormalization: true });
  const text = new TextLayer({ textContentSource: content, container: element, viewport });
  await text.render();
  return { element, divs: text.textDivs as HTMLElement[], strings: text.textContentItemsStr };
}

export type PdfDestination = string | unknown[];

type LinkAnnotation = {
  subtype?: string;
  rect?: number[];
  dest?: PdfDestination;
  url?: string;
  title?: string;
};

export async function renderLinks(page: PDFPageProxy, viewport: Viewport, navigate: (destination: PdfDestination) => Promise<void>) {
  const layer = document.createElement('div');
  layer.className = 'linkLayer';
  const annotations = await page.getAnnotations({ intent: 'display' }) as LinkAnnotation[];
  for (const annotation of annotations) {
    if (annotation.subtype !== 'Link' || !annotation.rect) continue;
    const [x1, y1, x2, y2] = annotation.rect;
    const [left, top] = viewport.convertToViewportPoint(x1, y1);
    const [right, bottom] = viewport.convertToViewportPoint(x2, y2);
    const link = document.createElement('a');
    link.className = 'page-link';
    link.style.left = `${Math.min(left, right)}px`;
    link.style.top = `${Math.min(top, bottom)}px`;
    link.style.width = `${Math.abs(right - left)}px`;
    link.style.height = `${Math.abs(bottom - top)}px`;
    link.setAttribute('aria-label', annotation.title || 'PDF link');
    const destination = annotation.dest;
    if (destination) {
      link.href = '#';
      link.onclick = async event => {
        event.preventDefault();
        try { await navigate(destination); } catch { }
      };
    } else {
      const url = annotation.url;
      if (!url) continue;
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
    layer.append(link);
  }
  return layer;
}
