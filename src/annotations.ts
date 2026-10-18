import { selectedMarkup, paintMarkup, overlaps, type Markup, type MarkupKind } from './markup';
import { circleEnd, paintDrawings, pointOnPage, updateDrawing, validDrawing, type Drawing, type DrawingTool } from './drawings';
type AnnotationOptions = {
  pages: HTMLElement;
  viewer: HTMLElement;
  renderedText: WeakMap<HTMLElement, { divs: HTMLElement[]; strings: string[] }>;
  enabled: () => boolean;
  getRotation: () => number;
  toast: (message: string) => void;
};
const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

export function mountAnnotations(options: AnnotationOptions) {
  const { pages, viewer, renderedText, enabled, getRotation, toast } = options;
  let selectedText: Omit<Markup, 'kind'>[] = [];
  let annotations: Markup[] = [];
  let annotationKey = '';
  let drawings: Drawing[] = [];
  let drawingKey = '';
  let drawingTool: DrawingTool = null;
  let drawingColor = '#e24b46';
  let drawingWidth = 4;
  let activeDrawing: { drawing: Drawing; layer: SVGSVGElement; group: SVGGElement; pointerId: number } | null = null;

  function readAnnotations(key: string): Markup[] {
    if (!key) return [];
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(stored) ? stored.filter((item): item is Markup =>
        item && typeof item.page === 'number' && Number.isInteger(item.startItem) &&
        Number.isInteger(item.endItem) && typeof item.startOffset === 'number' &&
        typeof item.endOffset === 'number' &&
        ['yellow', 'green', 'blue', 'pink', 'underline', 'strike'].includes(item.kind)) : [];
    } catch { return []; }
  }
  function repaintAnnotations() {
    pages.querySelectorAll<HTMLElement>('.page-shell[data-rendered="true"]').forEach(shell => {
      const text = renderedText.get(shell);
      if (text) paintMarkup(shell, text, annotations);
    });
  }
  function readDrawings(key: string): Drawing[] {
    if (!key) return [];
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(stored) ? stored.filter(validDrawing) : [];
    } catch { return []; }
  }
  function repaintDrawings() {
    pages.querySelectorAll<HTMLElement>('.page-shell[data-rendered="true"]').forEach(shell =>
      paintDrawings(shell, drawings, getRotation(), drawingTool));
  }
  function saveDrawings() {
    try { localStorage.setItem(drawingKey, JSON.stringify(drawings)); }
    catch { toast('Unable to save drawings.'); }
    repaintDrawings();
  }
  function captureSelectedText() {
    const selection = window.getSelection();
    if (!enabled() || !selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const captured: Omit<Markup, 'kind'>[] = [];
    pages.querySelectorAll<HTMLElement>('.page-shell[data-rendered="true"]').forEach(shell => {
      if (!range.intersectsNode(shell)) return;
      const text = renderedText.get(shell);
      if (!text) return;
      const item = selectedMarkup(range, shell, text);
      if (item) captured.push(item);
    });
    if (captured.length) selectedText = captured;
  }
  viewer.addEventListener('pointerup', captureSelectedText);
  viewer.addEventListener('keyup', captureSelectedText);
  viewer.addEventListener('pointerdown', () => { selectedText = []; });
  $('#markup-toggle').addEventListener('pointerdown', captureSelectedText);
  $('#markup-toggle').addEventListener('click', () => {
    const menu = $('#markup-menu');
    menu.hidden = !menu.hidden;
    $('#markup-toggle').setAttribute('aria-expanded', String(!menu.hidden));
  });
  $('#markup-menu').addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-markup]');
    if (!button) return;
    captureSelectedText();
    if (!selectedText.length) { toast('Select text in the PDF first.'); return; }
    const kind = button.dataset.markup as MarkupKind | 'remove';
    if (kind === 'remove') annotations = annotations.filter(mark => !selectedText.some(item => overlaps(mark, item)));
    else annotations.push(...selectedText.map(item => ({ ...item, kind })));
    try { localStorage.setItem(annotationKey, JSON.stringify(annotations)); }
    catch { toast('Unable to save markup.'); }
    repaintAnnotations();
    window.getSelection()?.removeAllRanges();
    selectedText = [];
    $('#markup-menu').hidden = true;
    $('#markup-toggle').setAttribute('aria-expanded', 'false');
  });
  document.addEventListener('pointerdown', event => {
    if (!(event.target as Element).closest('#markup-control')) {
      $('#markup-menu').hidden = true;
      $('#markup-toggle').setAttribute('aria-expanded', 'false');
    }
  });
  function setDrawingTool(tool: DrawingTool) {
    if (activeDrawing) {
      activeDrawing.group.remove();
      if (activeDrawing.layer.hasPointerCapture(activeDrawing.pointerId)) activeDrawing.layer.releasePointerCapture(activeDrawing.pointerId);
    }
    activeDrawing = null;
    drawingTool = tool;
    $('#drawing-toggle').classList.toggle('selected', !!tool);
    $('#drawing-toggle').setAttribute('aria-label', tool ? `Drawing tools: ${tool} active` : 'Drawing tools');
    document.querySelectorAll<HTMLButtonElement>('[data-draw-tool]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.drawTool === tool));
    });
    repaintDrawings();
  }
  $('#drawing-toggle').addEventListener('click', () => {
    const menu = $('#drawing-menu');
    menu.hidden = !menu.hidden;
    $('#drawing-toggle').setAttribute('aria-expanded', String(!menu.hidden));
  });
  $('#drawing-menu').addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-draw-tool], [data-draw-color], #drawing-done');
    if (!button) return;
    if (button.dataset.drawTool) {
      setDrawingTool(button.dataset.drawTool === drawingTool ? null : button.dataset.drawTool as DrawingTool);
      $('#drawing-menu').hidden = true;
      $('#drawing-toggle').setAttribute('aria-expanded', 'false');
    } else if (button.dataset.drawColor) {
      drawingColor = button.dataset.drawColor;
      document.querySelectorAll<HTMLButtonElement>('[data-draw-color]').forEach(color =>
        color.setAttribute('aria-pressed', String(color.dataset.drawColor === drawingColor)));
    } else {
      setDrawingTool(null);
      $('#drawing-menu').hidden = true;
      $('#drawing-toggle').setAttribute('aria-expanded', 'false');
    }
  });
  $<HTMLSelectElement>('#drawing-width').addEventListener('change', event => {
    drawingWidth = Number((event.target as HTMLSelectElement).value);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-draw-color]').forEach(button => {
    button.style.backgroundColor = button.dataset.drawColor!;
    button.setAttribute('aria-pressed', String(button.dataset.drawColor === drawingColor));
  });
  document.addEventListener('pointerdown', event => {
    if (!(event.target as Element).closest('#drawing-control')) {
      $('#drawing-menu').hidden = true;
      $('#drawing-toggle').setAttribute('aria-expanded', 'false');
    }
  });
  pages.addEventListener('pointerdown', event => {
    if (!drawingTool || (event.button !== 0 && event.pointerType !== 'touch')) return;
    const layer = (event.target as Element).closest<SVGSVGElement>('.drawing-layer');
    if (!layer) return;
    event.preventDefault();
    if (drawingTool === 'eraser') {
      const id = (event.target as Element).closest<SVGGElement>('[data-drawing-id]')?.dataset.drawingId;
      if (id) { drawings = drawings.filter(drawing => drawing.id !== id); saveDrawings(); }
      return;
    }
    const shell = layer.closest<HTMLElement>('.page-shell')!;
    const start = pointOnPage(event, layer);
    const drawing: Drawing = { id: crypto.randomUUID(), page: Number(shell.dataset.page), kind: drawingTool,
      points: drawingTool === 'pencil' ? [start] : [start, start], rotation: getRotation(), color: drawingColor, width: drawingWidth };
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.classList.add('drawing-preview');
    updateDrawing(group, drawing, getRotation());
    layer.appendChild(group);
    activeDrawing = { drawing, layer, group, pointerId: event.pointerId };
    layer.setPointerCapture(event.pointerId);
  });
  pages.addEventListener('pointermove', event => {
    const active = activeDrawing;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    const coalesced = active.drawing.kind === 'pencil' ? event.getCoalescedEvents?.() : undefined;
    const samples = coalesced?.length ? coalesced : [event];
    for (const sample of samples) {
      let point = pointOnPage(sample, active.layer);
      if (active.drawing.kind === 'circle') point = circleEnd(active.drawing.points[0], point, active.layer);
      if (active.drawing.kind === 'pencil') {
        const last = active.drawing.points.at(-1)!;
        if (active.drawing.points.length < 10000 && Math.hypot(point[0] - last[0], point[1] - last[1]) > 0.0005)
          active.drawing.points.push(point);
      } else active.drawing.points[1] = point;
    }
    updateDrawing(active.group, active.drawing, getRotation());
  });
  function finishDrawing(event: PointerEvent, cancel = false) {
    const active = activeDrawing;
    if (!active || active.pointerId !== event.pointerId) return;
    activeDrawing = null;
    if (active.layer.hasPointerCapture(event.pointerId)) active.layer.releasePointerCapture(event.pointerId);
    active.group.remove();
    if (cancel) return;
    const [start, end = start] = active.drawing.points;
    if (active.drawing.kind !== 'pencil' && Math.hypot(end[0] - start[0], end[1] - start[1]) < 0.002) return;
    drawings.push(active.drawing);
    saveDrawings();
  }
  pages.addEventListener('pointerup', event => finishDrawing(event));
  pages.addEventListener('pointercancel', event => finishDrawing(event, true));
  function activate(key: string) {
    selectedText = [];
    setDrawingTool(null);
    $('#drawing-menu').hidden = true;
    $('#drawing-toggle').setAttribute('aria-expanded', 'false');
    $('#markup-menu').hidden = true;
    $('#markup-toggle').setAttribute('aria-expanded', 'false');
    annotationKey = key;
    annotations = readAnnotations(annotationKey);
    drawingKey = annotationKey.replace(/^pdf-markup:/, 'pdf-drawings:');
    drawings = readDrawings(drawingKey);
  }
  window.addEventListener('storage', event => {
    if (event.key === annotationKey) { annotations = readAnnotations(annotationKey); repaintAnnotations(); }
    if (event.key === drawingKey) { drawings = readDrawings(drawingKey); repaintDrawings(); }
  });
  return {
    activate,
    paintText: (shell: HTMLElement) => { const text = renderedText.get(shell); if (text) paintMarkup(shell, text, annotations); },
    paintDrawings: (shell: HTMLElement) => paintDrawings(shell, drawings, getRotation(), drawingTool),
    dismissDrawing: () => { if (!drawingTool) return false; setDrawingTool(null); return true; },
  };
}
