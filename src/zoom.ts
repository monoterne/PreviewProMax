export type ZoomPoint = { page: string; x: number; y: number; pageX: number; pageY: number };
type PinchEvent = Event & { scale: number; clientX: number; clientY: number };
type ZoomOptions = {
  viewer: HTMLElement;
  pages: HTMLElement;
  enabled: () => boolean;
  value: () => number;
  currentPage: () => number;
  preview: (value: number) => void;
  apply: (value: number, fit: boolean, point: ZoomPoint | null) => void;
};
const clampZoom = (value: number) => Math.max(0.4, Math.min(3, value));

export function mountZoom(options: ZoomOptions) {
  const { viewer, pages } = options;
  let previewValue: number | null = null;
  let previewAnchor: ZoomPoint | null = null;
  let pinchStart: number | null = null;
  let pinchAnchor: ZoomPoint | null = null;
  let wheelTimer: number | undefined;
  let nativePinchEnded = -Infinity;

  function capture(x: number, y: number): ZoomPoint | null {
    const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('.page-shell');
    const current = options.currentPage();
    const nearby = [current - 1, current, current + 1]
      .map(page => pages.children.item(page - 1))
      .filter((element): element is HTMLElement => element instanceof HTMLElement);
    const shell = hit && pages.contains(hit) ? hit : nearby.reduce<HTMLElement | null>((nearest, candidate) => {
      if (!nearest) return candidate;
      const distance = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        return Math.max(rect.top - y, y - rect.bottom, 0);
      };
      return distance(candidate) < distance(nearest) ? candidate : nearest;
    }, null);
    if (!shell) return null;
    const rect = shell.getBoundingClientRect();
    return { page: shell.dataset.page!, x, y,
      pageX: Math.max(0, Math.min(1, (x - rect.left) / rect.width)),
      pageY: Math.max(0, Math.min(1, (y - rect.top) / rect.height)) };
  }

  function restore(point: ZoomPoint | null) {
    if (!point) return;
    const shell = pages.querySelector<HTMLElement>(`.page-shell[data-page="${point.page}"]`);
    if (!shell) return;
    const rect = shell.getBoundingClientRect();
    viewer.scrollLeft += rect.left + rect.width * point.pageX - point.x;
    viewer.scrollTop += rect.top + rect.height * point.pageY - point.y;
  }

  function center() {
    const bounds = viewer.getBoundingClientRect();
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  }

  function position(event: PinchEvent) {
    const bounds = viewer.getBoundingClientRect();
    return Number.isFinite(event.clientX) && Number.isFinite(event.clientY) &&
      event.clientX >= bounds.left && event.clientX <= bounds.right &&
      event.clientY >= bounds.top && event.clientY <= bounds.bottom
      ? { x: event.clientX, y: event.clientY } : center();
  }

  function preview(value: number, point: ZoomPoint | null) {
    const next = clampZoom(value);
    if (Math.abs(next - (previewValue ?? options.value())) < 0.0001) return;
    previewValue = next;
    previewAnchor = point;
    pages.dataset.zoomPreview = 'true';
    pages.style.setProperty('--page-preview-scale', String(next / options.value()));
    options.preview(next);
    restore(point);
  }

  function commit() {
    window.clearTimeout(wheelTimer);
    pinchStart = null;
    pinchAnchor = null;
    if (previewValue === null) return;
    const next = previewValue;
    // Capture the current location before changing layout. A normal scroll may
    // have moved the document since the last zoom event.
    const point = previewAnchor ? capture(previewAnchor.x, previewAnchor.y) : null;
    previewValue = null;
    previewAnchor = null;
    delete pages.dataset.zoomPreview;
    pages.style.removeProperty('--page-preview-scale');
    options.apply(next, false, point);
  }

  function set(value: number, fit = false) {
    if (!options.enabled()) return;
    commit();
    const next = clampZoom(Math.round(value * 20) / 20);
    const { x, y } = center();
    options.apply(next, fit, capture(x, y));
  }

  viewer.addEventListener('wheel', event => {
    if (!options.enabled()) return;
    if (!(event.ctrlKey || event.metaKey)) {
      if (pinchStart === null) commit();
      return;
    }
    event.preventDefault();
    // WKWebView can emit both streams for one pinch, including a final wheel
    // event after gestureend. Let the native gesture own its entire sequence.
    if (pinchStart !== null || performance.now() - nativePinchEnded < 120) return;
    const pixels = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 :
      event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewer.clientHeight : 1);
    preview((previewValue ?? options.value()) * Math.exp(-pixels / 400), capture(event.clientX, event.clientY));
    window.clearTimeout(wheelTimer);
    wheelTimer = window.setTimeout(commit, 400);
  }, { passive: false });

  viewer.addEventListener('gesturestart', event => {
    if (!options.enabled()) return;
    event.preventDefault();
    commit();
    pinchStart = options.value();
    // The first change supplies the centroid; some WKWebView gesturestart
    // events have no usable coordinates.
    pinchAnchor = null;
  }, { passive: false });
  viewer.addEventListener('gesturechange', event => {
    if (!options.enabled() || pinchStart === null) return;
    event.preventDefault();
    const pinch = event as PinchEvent;
    if (!Number.isFinite(pinch.scale) || pinch.scale <= 0) return;
    if (!pinchAnchor) {
      const { x, y } = position(pinch);
      pinchAnchor = capture(x, y);
    }
    // Keep the same PDF point even when viewport edges clamp scrolling.
    // Recapturing it on every event accumulates drift when a pinch reverses.
    preview(pinchStart * pinch.scale, pinchAnchor);
  }, { passive: false });
  viewer.addEventListener('gestureend', event => {
    if (pinchStart === null) return;
    event.preventDefault();
    nativePinchEnded = performance.now();
    commit();
  }, { passive: false });
  window.addEventListener('blur', commit);

  return { set, commit, restore };
}
