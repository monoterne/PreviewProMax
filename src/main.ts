import './compatibility';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import './style.css';
import { pickDocumentPaths, readDocument, onOpenedDocument, onMenuAction, newWindow, closeWindow, windowReady, getSessions, saveSession, archiveSession, type OpenedDocument, type SavedTab, type SavedWindow } from './desktop';
import { darkenOutsideImages } from './dark-page';
import { mountSidebarTabs, mountThemeSwitch } from './controls';
import { mountDocumentTabs } from './document-tabs';
import { type SearchHit } from './search';
import { searchPdf } from './pdf-search';
import { renderOutline } from './outline';
import { selectedMarkup, paintMarkup, overlaps, type Markup, type MarkupKind } from './markup';
import type { SidebarTab } from './controls';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type PdfDocument = pdfjs.PDFDocumentProxy;
type Dimensions = { width: number; height: number };

const paths: Record<string, string> = {
  file: '<path d="M7 2.75h6l4.25 4.25V20a1.25 1.25 0 0 1-1.25 1.25H7A1.25 1.25 0 0 1 5.75 20V4A1.25 1.25 0 0 1 7 2.75Z"/><path d="M13 3v4.5h4.25M8.5 12h6M8.5 15.5h6"/>',
  window: '<rect x="7" y="7" width="14" height="14" rx="2"/><path d="M16 7V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h3"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.2"/><path d="m15.5 15.5 5 5"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  rotate: '<path d="M20 11a8 8 0 1 1-2.6-5.9M20 4v5h-5"/>',
  fit: '<path d="M8 3H4a1 1 0 0 0-1 1v4m13-5h4a1 1 0 0 1 1 1v4M3 16v4a1 1 0 0 0 1 1h4m13-5v4a1 1 0 0 1-1 1h-4"/>'
};
function icon(name: string, size = 18) { return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`; }
function escapeHtml(text: string) { return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }
function releaseCanvases(root: Element) {
  root.querySelectorAll('canvas').forEach(canvas => { canvas.width = 0; canvas.height = 0; });
}

const app = document.querySelector<HTMLDivElement>('#app')!;
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
const savedInvertImages = localStorage.getItem('invert-images') !== 'false';
document.documentElement.dataset.theme = systemTheme.matches ? 'dark' : 'light';
document.documentElement.dataset.invertImages = String(savedInvertImages);
app.innerHTML = `
  <header class="toolbar">
    <div class="toolbar-left">
      <button id="sidebar-toggle" class="icon-button" aria-label="Toggle sidebar" title="Toggle sidebar" disabled>${icon('panel')}</button>
      <span class="toolbar-divider"></span>
      <strong id="document-title" class="document-title">Preview Pro Max</strong>
    </div>
    <div class="toolbar-center" id="navigation" hidden>
      <button class="icon-button" id="previous-page" aria-label="Previous page" title="Previous page">${icon('chevronLeft')}</button>
      <div class="page-input-wrap"><input id="page-number" type="number" min="1" aria-label="Page number"><span id="page-total">/ 0</span></div>
      <button class="icon-button" id="next-page" aria-label="Next page" title="Next page">${icon('chevronRight')}</button>
      <span class="toolbar-divider"></span>
      <button class="icon-button" id="zoom-out" aria-label="Zoom out" title="Zoom out">${icon('minus')}</button>
      <span id="zoom-label" class="zoom-label">100%</span>
      <button class="icon-button" id="zoom-in" aria-label="Zoom in" title="Zoom in">${icon('plus')}</button>
      <button class="icon-button" id="fit-width" aria-label="Fit width" title="Fit width">${icon('fit')}</button>
    </div>
  <div class="toolbar-right">
      <div class="markup-control document-tool" id="markup-control" hidden>
        <button class="icon-button" id="markup-toggle" aria-label="Markup selected text" aria-expanded="false" aria-controls="markup-menu" title="Markup selected text">Highlight</button>
        <div class="markup-menu" id="markup-menu" hidden>
          <span class="markup-heading">Selected text</span>
          <div class="markup-colors" aria-label="Highlight color">
            <button type="button" class="markup-choice markup-yellow" data-markup="yellow" aria-label="Highlight yellow" title="Highlight yellow"></button>
            <button type="button" class="markup-choice markup-green" data-markup="green" aria-label="Highlight green" title="Highlight green"></button>
            <button type="button" class="markup-choice markup-blue" data-markup="blue" aria-label="Highlight blue" title="Highlight blue"></button>
            <button type="button" class="markup-choice markup-pink" data-markup="pink" aria-label="Highlight pink" title="Highlight pink"></button>
          </div>
          <button type="button" class="markup-menu-item" data-markup="underline">Underline</button>
          <button type="button" class="markup-menu-item" data-markup="strike">Strikethrough</button>
          <button type="button" class="markup-menu-item" data-markup="remove">Remove markup</button>
        </div>
      </div>
      <button class="icon-button document-tool" id="rotate" aria-label="Rotate pages" title="Rotate pages" hidden>${icon('rotate')}</button>
      <button class="icon-button document-tool" id="search-toggle" aria-label="Find in document" title="Find in document" hidden>${icon('search')}</button>
      <span class="toolbar-divider"></span>
      <div id="theme-control"></div>
      <button id="open-button" class="open-button">${icon('folder', 16)}<span>Open</span></button>
    </div>
  </header>
  <div class="document-bar"><div id="document-tabs-root"></div><button id="new-window" class="icon-button" aria-label="New window" title="New window (⌘/Ctrl+N)">${icon('window')}</button></div>
  <div class="workspace">
    <aside class="sidebar" id="sidebar" hidden><div id="sidebar-tabs-root"></div></aside>
    <main id="viewer" class="viewer" role="tabpanel">
      <div id="welcome" class="welcome">
        <div class="empty-icon">${icon('file', 24)}</div>
        <h1>Open a PDF</h1>
        <button id="welcome-open" class="open-button">${icon('folder', 16)}<span>Choose file</span></button>
        <p>Or drop a PDF here</p>
        <section id="recent-windows" class="recent-windows" aria-label="Previously open windows" hidden>
          <h2>Previously open windows</h2>
          <div id="recent-window-list"></div>
        </section>
      </div>
      <div id="pages" class="pages" hidden></div>
    </main>
  </div>
  <div id="drop-overlay" class="drop-overlay" hidden><div>${icon('file', 28)}<strong>Drop PDF to open</strong></div></div>
  <dialog id="password-dialog" class="password-dialog" aria-labelledby="password-title">
    <form method="dialog">
      <h2 id="password-title">Password required</h2>
      <p id="password-message">Enter the password for this PDF.</p>
      <label for="pdf-password">Password</label>
      <input id="pdf-password" type="password" autocomplete="off" />
      <div class="password-actions">
        <button id="password-cancel" class="open-button" type="button">Cancel</button>
        <button class="open-button" value="open">Open</button>
      </div>
    </form>
  </dialog>
  <div id="toast" class="toast" role="status" hidden></div>
`;

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const viewer = $<HTMLElement>('#viewer');
const pages = $<HTMLElement>('#pages');
let activeTab: SidebarTab = 'pages';
const sidebarTabs = mountSidebarTabs(document.querySelector<HTMLElement>('#sidebar-tabs-root')!, (tab, focusInput) => {
  activeTab = tab;
  if (focusInput && tab === 'search') queueMicrotask(() => $<HTMLInputElement>('#search-input').focus({ preventScroll: true }));
});
const thumbs = $<HTMLElement>('#thumbnails');
const pageNumber = $<HTMLInputElement>('#page-number');
const zoomLabel = $<HTMLElement>('#zoom-label');
let pdf: PdfDocument | null = null;
let documentName = '';
let currentPage = 1;
let zoom = 1.25;
let wheelZoom: number | null = null;
let wheelZoomTimer: number | undefined;
let pinchStartZoom = 0;
let previewZoom: number | null = null;
let previewAnchor: ZoomPoint | null = null;
let rotation = 0;
let sidebarVisible = true;
let dimensions: Dimensions[] = [];
let renderEpoch = 0;
let thumbnailEpoch = 0;
let navigationEpoch = 0;
let searchEpoch = 0;
let searchAbort: AbortController | undefined;
let hits: SearchHit[] = [];
let selectedHit: SearchHit | null = null;
let activeSearchQuery = '';
let searchRunning = false;
let selectedHitIndex = -1;
let darkMode = systemTheme.matches;
let invertImages = savedInvertImages;
let manualTheme = false;
let toastTimer: number | undefined;
let pageObserver: IntersectionObserver | null = null;
let thumbObserver: IntersectionObserver | null = null;
const pageRenders = new WeakMap<HTMLElement, { epoch: number; task: Promise<void> }>();
const renderedText = new WeakMap<HTMLElement, { divs: HTMLElement[]; strings: string[] }>();
let selectedText: Omit<Markup, 'kind'>[] = [];
let annotations: Markup[] = [];
let annotationKey = '';

type DocumentTab = {
  id: string; name: string; path: string | null; pdf: PdfDocument | null; page: number; zoom: number;
  rotation: number; fit: boolean; dimensions: Dimensions[]; top: number; left: number;
  query: string; activeQuery: string; searchPending: boolean; hits: SearchHit[]; selected: number;
  sidebarTab: SidebarTab; thumbnailTop: number; resultsTop: number;
  annotationKey: string;
};
type ZoomPoint = { page: string; x: number; y: number; pageX: number; pageY: number };
let nextDocumentId = 1;
function emptyDocumentTab(): DocumentTab {
  return { id: String(nextDocumentId++), name: 'New tab', path: null, pdf: null, page: 1, zoom: 1.25,
    rotation: 0, fit: true, dimensions: [], top: 0, left: 0, query: '', activeQuery: '',
    searchPending: false, hits: [], selected: -1, sidebarTab: 'pages', thumbnailTop: 0, resultsTop: 0, annotationKey: '' };
}
const documentTabs: DocumentTab[] = [emptyDocumentTab()];
let activeDocumentId = documentTabs[0].id;
let tabBar: ReturnType<typeof mountDocumentTabs>;
const renderJobs = new Set<Promise<void>>();
let sharedWorker: pdfjs.PDFWorker | undefined;
let openQueue = Promise.resolve();
let sessionId: string = crypto.randomUUID();
let recentWindows: SavedWindow[] = [];
let restoringSession = false;
let sessionSaveTimer: number | undefined;
let sessionWrite = Promise.resolve();

function renderRecentWindows() {
  const section = $('#recent-windows');
  const list = $('#recent-window-list');
  list.replaceChildren();
  for (const saved of recentWindows.filter(item => item.tabs.length)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'recent-window';
    const names = saved.tabs.map(tab => tab.path.split(/[\\/]/).pop() || 'Document');
    button.textContent = names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ');
    button.title = names.join('\n');
    button.addEventListener('click', () => { void restoreSavedWindow(saved); });
    list.appendChild(button);
  }
  section.hidden = !list.childElementCount;
}

function mergeRecentWindows(incoming: SavedWindow[]) {
  const windows = new Map(recentWindows.map(item => [item.id, item]));
  for (const item of incoming) {
    if (item.updated >= (windows.get(item.id)?.updated ?? 0)) windows.set(item.id, item);
  }
  recentWindows = [...windows.values()].sort((a, b) => b.updated - a.updated).slice(0, 20);
  if (!pdf) renderRecentWindows();
}

function refreshRecentWindows() {
  void getSessions().then(info => mergeRecentWindows(info.recent)).catch(error => console.error('Unable to list previous windows:', error));
}

function queueSessionSave(delay = 250) {
  if (restoringSession) return;
  window.clearTimeout(sessionSaveTimer);
  sessionSaveTimer = window.setTimeout(() => {
    saveDocumentTab();
    const openTabs = documentTabs.filter(tab => tab.pdf && tab.path);
    const tabs = openTabs.map(tab => ({
      path: tab.path!, page: tab.page, zoom: tab.zoom, rotation: tab.rotation,
      fit: tab.fit, top: tab.top, left: tab.left,
    }));
    if (!tabs.length) {
      sessionWrite = sessionWrite.then(archiveSession).catch(error => console.error('Unable to archive open tabs:', error));
      return;
    }
    const session: SavedWindow = { id: sessionId, tabs, active: Math.max(0, openTabs.findIndex(tab => tab.id === activeDocumentId)), updated: Date.now() };
    sessionWrite = sessionWrite.then(() => saveSession(session)).then(() => {
      mergeRecentWindows([session]);
    }).catch(error => console.error('Unable to save open tabs:', error));
  }, delay);
}

function saveDocumentTab() {
  const tab = documentTabs.find(tab => tab.id === activeDocumentId);
  if (!tab) return;
  Object.assign(tab, { pdf, name: pdf ? documentName : 'New tab', page: currentPage, zoom,
    rotation, fit: fitWidth, dimensions, top: viewer.scrollTop, left: viewer.scrollLeft,
    query: $<HTMLInputElement>('#search-input').value, activeQuery: activeSearchQuery,
    hits, searchPending: searchRunning, selected: selectedHitIndex, sidebarTab: activeTab,
    thumbnailTop: thumbs.scrollTop, resultsTop: $('#search-results').scrollTop });
}
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
function activateDocumentTab(id: string) {
  const tab = documentTabs.find(tab => tab.id === id);
  if (!tab || id === activeDocumentId) return;
  commitZoomPreview();
  saveDocumentTab();
  wheelZoom = null;
  pinchStartZoom = 0;
  const previousPdf = pdf;
  searchAbort?.abort();
  searchEpoch++; navigationEpoch++; renderEpoch++; thumbnailEpoch++;
  window.clearTimeout(searchTimer);
  pageObserver?.disconnect(); thumbObserver?.disconnect();
  releaseCanvases(pages); releaseCanvases(thumbs);
  pages.replaceChildren(); thumbs.replaceChildren();
  activeDocumentId = id;
  selectedText = [];
  $('#markup-menu').hidden = true;
  $('#markup-toggle').setAttribute('aria-expanded', 'false');
  pdf = tab.pdf; documentName = tab.name; currentPage = tab.page;
  annotationKey = tab.annotationKey;
  annotations = readAnnotations(annotationKey);
  zoom = tab.zoom; rotation = tab.rotation; fitWidth = tab.fit; dimensions = tab.dimensions;
  hits = tab.hits; activeSearchQuery = tab.activeQuery; searchRunning = false;
  selectedHitIndex = tab.selected; selectedHit = hits[selectedHitIndex] || null;
  $<HTMLInputElement>('#search-input').value = tab.query;
  showTab(tab.sidebarTab, false);
  void renderOutline($('#outline'), pdf, page => goToPage(page));
  $('#welcome').hidden = !!pdf; pages.hidden = !pdf; $('#navigation').hidden = !pdf;
  if (!pdf) { renderRecentWindows(); refreshRecentWindows(); }
  $<HTMLButtonElement>('#sidebar-toggle').disabled = !pdf;
  document.querySelectorAll<HTMLElement>('.document-tool').forEach(el => el.hidden = !pdf);
  setSidebar(sidebarVisible);
  if (pdf && fitWidth) zoom = Math.max(0.4, Math.min(3, Math.round(scaleForFit() * 20) / 20));
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  $('#fit-width').classList.toggle('selected', fitWidth);
  updateTitle();
  tabBar.update(documentTabs, id);
  renderSearchResults();
  if (pdf) {
    rebuildPages(); makeThumbnails(); updatePageUi();
    // Reveal a tab as one frame once its target page is ready. This avoids
    // showing mismatched page placeholders while sizes and text settle.
    pages.style.visibility = 'hidden';
    const epoch = renderEpoch;
    const target = pages.querySelector<HTMLElement>(`.page-shell[data-page="${currentPage}"]`)!;
    void renderPage(target, epoch).finally(() => {
      if (epoch === renderEpoch) pages.style.visibility = '';
    });
  }
  viewer.scrollTo({ top: tab.top, left: tab.left, behavior: 'auto' });
  thumbs.scrollTop = tab.thumbnailTop;
  $('#search-results').scrollTop = tab.resultsTop;
  if (pdf && tab.query && (tab.searchPending || tab.query !== tab.activeQuery)) void searchDocument();
  if (previousPdf && previousPdf !== pdf) {
    void Promise.allSettled([...renderJobs]).then(() => {
      if (pdf !== previousPdf && documentTabs.some(item => item.pdf === previousPdf)) {
        void previousPdf.cleanup().catch(() => {});
      }
    });
  }
  queueSessionSave(0);
}
function newDocumentTab() {
  const tab = emptyDocumentTab();
  documentTabs.push(tab);
  activateDocumentTab(tab.id);
}
async function closeDocumentTab(id: string) {
  const index = documentTabs.findIndex(tab => tab.id === id);
  if (index < 0) return;
  if (documentTabs.length === 1) { await closeWindow(); return; }
  const [closed] = documentTabs.splice(index, 1);
  if (activeDocumentId === id) activateDocumentTab(documentTabs[Math.min(index, documentTabs.length - 1)].id);
  else tabBar.update(documentTabs, activeDocumentId);
  queueSessionSave(0);
  if (closed.pdf) { await Promise.allSettled([...renderJobs]); await closed.pdf.destroy(); }
}

function toast(message: string, duration = 3500) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el.hidden = true; }, duration);
}
function displayName(name: string) { return name.replace(/\.pdf$/i, ''); }
function requestPassword(wrongPassword: boolean): Promise<string | null> {
  const dialog = $<HTMLDialogElement>('#password-dialog');
  const input = $<HTMLInputElement>('#pdf-password');
  $('#password-message').textContent = wrongPassword ? 'Incorrect password. Try again.' : 'Enter the password for this PDF.';
  input.value = '';
  dialog.returnValue = '';
  dialog.showModal();
  input.focus();
  return new Promise(resolve => dialog.addEventListener('close', () => {
    resolve(dialog.returnValue === 'open' ? input.value : null);
  }, { once: true }));
}
$<HTMLButtonElement>('#password-cancel').addEventListener('click', () => $<HTMLDialogElement>('#password-dialog').close('cancel'));
function updateTitle() {
  $('#document-title').textContent = pdf ? displayName(documentName) : 'Preview Pro Max';
  document.title = pdf ? `${documentName} — Preview Pro Max` : 'Preview Pro Max';
}
function showTab(tab: SidebarTab, focus = true) {
  activeTab = tab;
  sidebarTabs.setTab(tab);
  if (focus && tab === 'search') queueMicrotask(() => $<HTMLInputElement>('#search-input').focus({ preventScroll: true }));
}
function setSidebar(visible: boolean) {
  const wasShown = !$('#sidebar').hidden;
  sidebarVisible = visible;
  const shown = visible && !!pdf;
  $('#sidebar').hidden = !shown;
  $('#sidebar-toggle').classList.toggle('selected', shown);
  if (wasShown !== shown) window.setTimeout(() => { if (pdf) refreshFitIfNeeded(); }, 40);
}
function updatePageUi(revealThumbnail = false) {
  if (!pdf) return;
  pageNumber.value = String(currentPage);
  $('#page-total').textContent = `/ ${pdf.numPages}`;
  const previous = thumbs.querySelector<HTMLElement>('.thumbnail.active');
  const active = thumbs.children.item(currentPage - 1) as HTMLElement | null;
  if (previous !== active) { previous?.classList.remove('active'); active?.classList.add('active'); }
  if (revealThumbnail && active && activeTab === 'pages') {
    const item = active.getBoundingClientRect();
    const list = thumbs.getBoundingClientRect();
    if (item.top < list.top) thumbs.scrollTop += item.top - list.top - 8;
    else if (item.bottom > list.bottom) thumbs.scrollTop += item.bottom - list.bottom + 8;
  }
}
async function goToPage(number: number) {
  if (!pdf) return;
  commitZoomPreview();
  const sourcePdf = pdf;
  const target = Math.max(1, Math.min(pdf.numPages, Math.round(number) || 1));
  const epoch = ++navigationEpoch;
  if (!dimensions[target - 1]) {
    try {
      const page = await sourcePdf.getPage(target);
      if (pdf !== sourcePdf || epoch !== navigationEpoch) return;
      const viewport = page.getViewport({ scale: 1 });
      dimensions[target - 1] = { width: viewport.width, height: viewport.height };
      const shell = pages.querySelector<HTMLElement>(`.page-shell[data-page="${target}"]`);
      const d = pageDimensions(target - 1);
      if (shell) {
        shell.style.width = `${d.width * zoom}px`;
        shell.style.height = `${d.height * zoom}px`;
      }
      const button = thumbs.querySelector<HTMLElement>(`.thumbnail[data-page="${target}"]`);
      if (button) setThumbnailSize(button, d);
    } catch (error) { console.error('Unable to read page dimensions:', error); }
  }
  if (pdf !== sourcePdf || epoch !== navigationEpoch) return;
  currentPage = target;
  updatePageUi(true);
  queueSessionSave();
  const shell = pages.querySelector<HTMLElement>(`.page-shell[data-page="${currentPage}"]`);
  if (shell) {
    const offset = shell.getBoundingClientRect().top - viewer.getBoundingClientRect().top;
    viewer.scrollTo({ top: viewer.scrollTop + offset - 24, behavior: 'auto' });
  }
}
function pageDimensions(index: number): Dimensions {
  const d = dimensions[index] || dimensions[0] || { width: 612, height: 792 };
  return rotation % 180 ? { width: d.height, height: d.width } : d;
}
function scaleForFit() {
  const width = pageDimensions(0).width;
  return Math.max(0.4, Math.min(2.5, (viewer.clientWidth - 112) / width));
}
let fitWidth = true;
function refreshFitIfNeeded() { if (fitWidth) setZoom(scaleForFit(), true); }
function captureZoomPoint(x: number, y: number): ZoomPoint | null {
  const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('.page-shell');
  const nearby = [currentPage - 1, currentPage, currentPage + 1]
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
function restoreZoomPoint(point: ZoomPoint | null) {
  if (!point) return;
  const shell = pages.querySelector<HTMLElement>(`.page-shell[data-page="${point.page}"]`);
  if (!shell) return;
  const rect = shell.getBoundingClientRect();
  viewer.scrollLeft += rect.left + rect.width * point.pageX - point.x;
  viewer.scrollTop += rect.top + rect.height * point.pageY - point.y;
}
function previewScale(value: number, x: number, y: number) {
  if (!pdf) return;
  const next = Math.max(0.4, Math.min(3, value));
  if (Math.abs(next - (previewZoom ?? zoom)) < 0.0001) return;
  const point = captureZoomPoint(x, y);
  previewZoom = next;
  previewAnchor = point;
  pages.dataset.zoomPreview = 'true';
  pages.style.setProperty('--page-preview-scale', String(next / zoom));
  zoomLabel.textContent = `${Math.round(next * 100)}%`;
  fitWidth = false;
  $('#fit-width').classList.remove('selected');
  restoreZoomPoint(point);
}
function commitZoomPreview() {
  if (previewZoom === null) return;
  const next = previewZoom;
  const point = previewAnchor;
  previewZoom = null;
  previewAnchor = null;
  wheelZoom = null;
  pinchStartZoom = 0;
  window.clearTimeout(wheelZoomTimer);
  delete pages.dataset.zoomPreview;
  pages.style.removeProperty('--page-preview-scale');
  applyZoom(next, false, point);
}
function setZoom(value: number, keepFit = false, anchor?: { x: number; y: number }, precise = false) {
  if (!pdf) return;
  if (previewZoom !== null) commitZoomPreview();
  const next = Math.max(0.4, Math.min(3, precise ? value : Math.round(value * 20) / 20));
  if (Math.abs(next - zoom) < 0.0001 && keepFit === fitWidth) return;
  const bounds = viewer.getBoundingClientRect();
  const point = captureZoomPoint(anchor?.x ?? bounds.left + bounds.width / 2, anchor?.y ?? bounds.top + bounds.height / 2);
  applyZoom(next, keepFit, point);
}
function applyZoom(next: number, keepFit: boolean, point: ZoomPoint | null) {
  if (!pdf) return;
  fitWidth = keepFit;
  zoom = next;
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  $('#fit-width').classList.toggle('selected', fitWidth);
  renderEpoch++;
  navigationEpoch++;
  updatePageSizes();
  observePages();
  restoreZoomPoint(point);
  trimRenderedPages();
  queueSessionSave();
}
function updatePageSizes() {
  pages.querySelectorAll<HTMLElement>('.page-shell').forEach((shell, index) => {
    const d = pageDimensions(index);
    shell.style.width = `${d.width * zoom}px`;
    shell.style.height = `${d.height * zoom}px`;
    const content = shell.querySelector<HTMLElement>('.page-content');
    if (content) {
      const drawnZoom = Number(shell.dataset.renderedZoom) || zoom;
      content.style.transform = Math.abs(drawnZoom - zoom) < 0.0001 ? '' : `scale(${zoom / drawnZoom})`;
    }
  });
}
function observePages() {
  pageObserver?.disconnect();
  const epoch = renderEpoch;
  pageObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) void renderPage(entry.target as HTMLElement, epoch);
  }, { root: viewer, rootMargin: '700px 0px' });
  pages.querySelectorAll('.page-shell').forEach(el => pageObserver!.observe(el));
}
function rebuildPages() {
  if (!pdf) return;
  pages.style.visibility = '';
  renderEpoch++;
  navigationEpoch++;
  pageObserver?.disconnect();
  releaseCanvases(pages);
  pages.innerHTML = '';
  for (let i = 0; i < pdf.numPages; i++) {
    const shell = document.createElement('section');
    shell.className = 'page-shell';
    shell.dataset.page = String(i + 1);
    shell.setAttribute('aria-label', `Page ${i + 1}`);
    shell.innerHTML = `<div class="page-loading"></div><div class="page-number-label">${i + 1}</div>`;
    pages.appendChild(shell);
  }
  updatePageSizes();
  observePages();
}
function renderPage(shell: HTMLElement, epoch: number): Promise<void> {
  if (epoch !== renderEpoch || shell.parentElement !== pages) return Promise.resolve();
  const pending = pageRenders.get(shell);
  if (pending) return pending.epoch === epoch ? pending.task : pending.task.then(() => renderPage(shell, renderEpoch));
  const task = renderPageContent(shell, epoch).finally(() => {
    if (pageRenders.get(shell)?.task === task) pageRenders.delete(shell);
    renderJobs.delete(task);
  });
  renderJobs.add(task);
  pageRenders.set(shell, { epoch, task });
  return task;
}
async function renderPageContent(shell: HTMLElement, epoch: number) {
  if (!pdf || (shell.dataset.rendered === 'true' && Math.abs(Number(shell.dataset.renderedZoom) - zoom) < 0.0001)) return;
  const number = Number(shell.dataset.page);
  try {
    const page = await pdf.getPage(number);
    if (epoch !== renderEpoch) return;
    const natural = page.getViewport({ scale: 1 });
    if (!dimensions[number - 1] || dimensions[number - 1].width !== natural.width || dimensions[number - 1].height !== natural.height) {
      dimensions[number - 1] = { width: natural.width, height: natural.height };
      const d = pageDimensions(number - 1);
      shell.style.width = `${d.width * zoom}px`;
      shell.style.height = `${d.height * zoom}px`;
    }
    const viewport = page.getViewport({ scale: zoom, rotation: (page.rotate + rotation) % 360 });
    const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (viewport.width * viewport.height)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas is unavailable.');
    const preserveImages = darkMode && !invertImages;
    if (preserveImages) page.imageCoordinates = null;
    await page.render({ canvasContext: context, canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0], recordImages: preserveImages }).promise;
    if (epoch !== renderEpoch) return;
    if (preserveImages) {
      try { darkenOutsideImages(canvas, page.imageCoordinates); }
      catch (error) { canvas.classList.add('dark-filter-fallback'); console.error('Unable to preserve image colors:', error); }
    }
    const textLayer = document.createElement('div');
    textLayer.className = 'textLayer';
    textLayer.style.setProperty('--scale-factor', String(viewport.scale));
    textLayer.style.setProperty('--total-scale-factor', String(viewport.scale * viewport.userUnit));
    try {
      const content = await page.getTextContent({ disableNormalization: true });
      const text = new pdfjs.TextLayer({ textContentSource: content, container: textLayer, viewport });
      await text.render();
      const divs = text.textDivs as HTMLElement[];
      if (epoch === renderEpoch) renderedText.set(shell, { divs, strings: text.textContentItemsStr });
    } catch { /* Image-only PDFs still render correctly. */ }
    if (epoch !== renderEpoch) return;
    const content = document.createElement('div');
    content.className = 'page-content';
    content.style.width = `${viewport.width}px`;
    content.style.height = `${viewport.height}px`;
    content.append(canvas, textLayer);
    const previous = shell.querySelector<HTMLElement>('.page-content');
    if (previous) {
      previous.remove();
      releaseCanvases(previous);
    }
    shell.querySelector('.page-loading')?.remove();
    shell.prepend(content);
    shell.dataset.rendered = 'true';
    shell.dataset.renderedZoom = String(zoom);
    highlightVisibleText(shell);
  } catch (error) {
    if (epoch === renderEpoch) shell.querySelector('.page-loading')?.replaceChildren('Unable to render this page');
    console.error(error);
  }
}
function trimRenderedPages() {
  const view = viewer.getBoundingClientRect();
  const margin = viewer.clientHeight * 1.5;
  pages.querySelectorAll<HTMLElement>('.page-shell[data-rendered="true"]').forEach(shell => {
    const rect = shell.getBoundingClientRect();
    if (rect.bottom < view.top - margin || rect.top > view.bottom + margin) {
      const content = shell.querySelector('.page-content');
      if (content) { content.remove(); releaseCanvases(content); }
      renderedText.delete(shell);
      shell.dataset.rendered = 'false';
      delete shell.dataset.renderedZoom;
      if (!shell.querySelector('.page-loading')) {
        const loading = document.createElement('div');
        loading.className = 'page-loading';
        shell.prepend(loading);
      }
    }
  });
}

function highlightVisibleText(shell: HTMLElement) {
  const layer = renderedText.get(shell);
  if (!layer) return;
  const query = activeSearchQuery;
  const page = Number(shell.dataset.page);
  const matches = hits.filter(hit => hit.page === page);
  let itemStart = 0;
  layer.divs.forEach((span, index) => {
    const source = layer.strings[index];
    const itemEnd = itemStart + source.length;
    if (!source || !query) { span.textContent = source; itemStart = itemEnd; return; }
    const content = document.createDocumentFragment();
    let from = 0;
    for (const hit of matches) {
      if (hit.end <= itemStart || hit.start >= itemEnd) continue;
      const start = Math.max(from, hit.start - itemStart);
      const end = Math.min(source.length, hit.end - itemStart);
      if (end <= start) continue;
      content.append(document.createTextNode(source.slice(from, start)));
      const mark = document.createElement('mark');
      mark.className = 'search-match';
      if (selectedHit?.page === page && selectedHit.occurrence === hit.occurrence) mark.classList.add('selected');
      mark.dataset.occurrence = String(hit.occurrence);
      mark.textContent = source.slice(start, end);
      content.append(mark);
      from = end;
    }
    content.append(document.createTextNode(source.slice(from)));
    span.replaceChildren(content);
    itemStart = itemEnd;
  });
  paintMarkup(shell, layer, annotations);
}
function scrollToSelectedMatch(shell: HTMLElement) {
  if (!selectedHit) return false;
  const mark = shell.querySelector<HTMLElement>(`mark[data-occurrence="${selectedHit.occurrence}"]`);
  if (!mark) return false;
  const offset = mark.getBoundingClientRect().top - viewer.getBoundingClientRect().top;
  viewer.scrollTo({ top: viewer.scrollTop + offset - viewer.clientHeight * 0.32, behavior: 'auto' });
  return true;
}
function updateSearchStatus() {
  $('#search-status').textContent = hits.length
    ? selectedHitIndex >= 0 ? `${selectedHitIndex + 1} of ${hits.length} matches` : `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}`
    : activeSearchQuery ? 'No matches found' : 'Enter text to search.';
  $<HTMLButtonElement>('#previous-match').disabled = !hits.length;
  $<HTMLButtonElement>('#next-match').disabled = !hits.length;
}
async function selectSearchHit(index: number) {
  const hit = hits[index];
  if (!hit) return;
  const epoch = ++navigationEpoch;
  selectedHit = hit;
  selectedHitIndex = index;
  pages.querySelectorAll('.search-match.selected').forEach(mark => mark.classList.remove('selected'));
  $('#search-results').querySelectorAll<HTMLElement>('.search-result').forEach((result, resultIndex) => {
    result.classList.toggle('active', resultIndex === index);
    result.setAttribute('aria-current', String(resultIndex === index));
  });
  updateSearchStatus();
  const list = $('#search-results');
  const button = list.querySelector<HTMLElement>('.active');
  if (button) {
    const rect = button.getBoundingClientRect(), bounds = list.getBoundingClientRect();
    if (rect.top < bounds.top) list.scrollTop += rect.top - bounds.top;
    else if (rect.bottom > bounds.bottom) list.scrollTop += rect.bottom - bounds.bottom;
  }
  const shell = pages.querySelector<HTMLElement>(`.page-shell[data-page="${hit.page}"]`);
  if (!shell) return;
  await renderPage(shell, renderEpoch);
  if (epoch !== navigationEpoch || selectedHit !== hit) return;
  highlightVisibleText(shell);
  currentPage = hit.page;
  updatePageUi();
  if (!scrollToSelectedMatch(shell)) await goToPage(hit.page);
}
function moveSearchHit(direction: number) {
  if (!hits.length) return;
  const index = selectedHitIndex < 0 ? (direction > 0 ? 0 : hits.length - 1)
    : (selectedHitIndex + direction + hits.length) % hits.length;
  void selectSearchHit(index);
}
function thumbnailSize(d: Dimensions): Dimensions {
  const scale = Math.min(124 / d.width, 170 / d.height);
  return { width: Math.max(1, d.width * scale), height: Math.max(1, d.height * scale) };
}
function setThumbnailSize(button: HTMLElement, d: Dimensions): Dimensions {
  const size = thumbnailSize(d);
  const paper = button.querySelector<HTMLElement>('.thumbnail-paper')!;
  paper.style.width = `${size.width + 2}px`;
  paper.style.height = `${size.height + 2}px`;
  return size;
}
function makeThumbnails() {
  if (!pdf) return;
  thumbnailEpoch++;
  thumbObserver?.disconnect();
  releaseCanvases(thumbs);
  thumbs.innerHTML = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const button = document.createElement('button');
    button.className = 'thumbnail';
    button.dataset.page = String(i);
    button.innerHTML = `<div class="thumbnail-paper"><span class="thumbnail-placeholder"></span></div><span class="thumbnail-number">${i}</span>`;
    setThumbnailSize(button, pageDimensions(i - 1));
    button.addEventListener('click', () => goToPage(i));
    thumbs.appendChild(button);
  }
  const epoch = thumbnailEpoch;
  thumbObserver = new IntersectionObserver(entries => {
    if (epoch !== thumbnailEpoch) return;
    for (const entry of entries) {
      const button = entry.target as HTMLElement;
      button.dataset.visible = String(entry.isIntersecting);
      if (entry.isIntersecting) renderThumbnail(button, epoch);
      else if (thumbs.clientHeight > 0 && button.dataset.rendered === 'true') {
        releaseCanvases(button);
        const placeholder = document.createElement('span');
        placeholder.className = 'thumbnail-placeholder';
        button.querySelector('.thumbnail-paper')?.replaceChildren(placeholder);
        button.dataset.rendered = '';
      }
    }
  }, { root: thumbs, rootMargin: '300px 0px' });
  thumbs.querySelectorAll('.thumbnail').forEach(el => thumbObserver!.observe(el));
  $('#thumb-count').textContent = `${pdf.numPages} ${pdf.numPages === 1 ? 'page' : 'pages'}`;
  updatePageUi();
}
function renderThumbnail(button: HTMLElement, epoch: number): Promise<void> {
  if (epoch !== thumbnailEpoch || button.parentElement !== thumbs) return Promise.resolve();
  const task = renderThumbnailContent(button, epoch).finally(() => renderJobs.delete(task));
  renderJobs.add(task);
  return task;
}
async function renderThumbnailContent(button: HTMLElement, epoch: number) {
  if (!pdf || button.dataset.rendered) return;
  button.dataset.rendered = 'loading';
  try {
    const sourcePdf = pdf;
    const page = await pdf.getPage(Number(button.dataset.page));
    if (pdf !== sourcePdf || epoch !== thumbnailEpoch) return;
    const natural = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
    const size = setThumbnailSize(button, { width: natural.width, height: natural.height });
    const viewport = page.getViewport({ scale: size.width / natural.width, rotation: (page.rotate + rotation) % 360 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width * 1.5);
    canvas.height = Math.ceil(viewport.height * 1.5);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const preserveImages = darkMode && !invertImages;
    if (preserveImages) page.imageCoordinates = null;
    await page.render({ canvasContext: canvas.getContext('2d')!, canvas, viewport, transform: [1.5, 0, 0, 1.5, 0, 0], recordImages: preserveImages }).promise;
    if (pdf !== sourcePdf || epoch !== thumbnailEpoch || button.dataset.visible !== 'true') return;
    if (preserveImages) {
      try { darkenOutsideImages(canvas, page.imageCoordinates); }
      catch (error) { canvas.classList.add('dark-filter-fallback'); console.error('Unable to preserve thumbnail image colors:', error); }
    }
    button.querySelector('.thumbnail-paper')!.replaceChildren(canvas);
    button.dataset.rendered = 'true';
  } catch { /* Keep the placeholder until the page is visible again. */ }
  finally { if (button.dataset.rendered === 'loading') button.dataset.rendered = ''; }
}
function openDocument(file: OpenedDocument, saved?: SavedTab): Promise<void> {
  const pending = openQueue.then(() => loadDocument(file, saved));
  openQueue = pending.catch(error => toast(String(error)));
  return pending;
}
async function loadDocument(file: OpenedDocument, saved?: SavedTab) {
  const bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes);
  sharedWorker ??= new pdfjs.PDFWorker();
  const task = pdfjs.getDocument({ data: bytes, useSystemFonts: true, worker: sharedWorker });
  let passwordCanceled = false;
  task.onPassword = (updatePassword: (password: string) => void, reason: number) => {
    void requestPassword(reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD).then(password => {
      if (password === null) { passwordCanceled = true; void task.destroy(); }
      else updatePassword(password);
    });
  };
  let loaded: PdfDocument;
  try {
    loaded = await task.promise;
  } catch (error) {
    await task.destroy();
    if (passwordCanceled) return;
    console.error(error);
    const message = error instanceof Error && error.name === 'PasswordException'
      ? 'This PDF is password protected.'
      : 'This file is not a supported PDF. Choose a PDF document.';
    toast(message, 6000);
    return;
  }
  try {
    const first = await loaded.getPage(1);
    const viewport = first.getViewport({ scale: 1 });
    const tab = emptyDocumentTab();
    tab.pdf = loaded;
    tab.name = file.name;
    tab.path = file.path;
    tab.annotationKey = `pdf-markup:${loaded.fingerprints[0] || file.path || file.name}`;
    tab.dimensions = [{ width: viewport.width, height: viewport.height }];
    if (saved) {
      tab.page = Math.max(1, Math.min(loaded.numPages, saved.page));
      tab.zoom = Math.max(0.4, Math.min(3, saved.zoom));
      tab.rotation = saved.rotation % 360;
      tab.fit = saved.fit;
      tab.top = saved.top;
      tab.left = saved.left;
    }
    // Reuse an empty tab; opening another document keeps the current PDF available.
    if (!pdf) {
      const index = documentTabs.findIndex(item => item.id === activeDocumentId);
      saveDocumentTab();
      documentTabs.splice(index, 1, tab);
    } else documentTabs.push(tab);
    activateDocumentTab(tab.id);
  } catch (error) {
    await loaded.destroy();
    console.error(error);
    toast(error instanceof Error ? error.message : 'Unable to open PDF.');
  }
}
async function pickDocument() {
  try {
    for (const path of await pickDocumentPaths()) await openDocument(await readDocument(path));
  } catch (error) { toast(error instanceof Error ? error.message : 'Unable to open file.'); }
}

async function restoreSavedWindow(saved: SavedWindow, startup = false) {
  if (restoringSession) return;
  if (startup) sessionId = saved.id;
  restoringSession = true;
  window.clearTimeout(sessionSaveTimer);
  const restored: (string | null)[] = [];
  let unavailable = 0;
  try {
    for (const tab of saved.tabs) {
      const before = activeDocumentId;
      try { await openDocument(await readDocument(tab.path), tab); }
      catch { /* A missing file is reported with the other unavailable tabs below. */ }
      const opened = activeDocumentId === before ? null : activeDocumentId;
      if (!opened) unavailable++;
      restored.push(opened);
    }
    const target = restored[saved.active] || restored.find(id => id);
    if (target) activateDocumentTab(target);
  } finally {
    restoringSession = false;
    queueSessionSave();
  }
  if (unavailable) toast(`${unavailable} previously open file${unavailable === 1 ? '' : 's'} could not be opened.`, 6000);
}

async function searchDocument() {
  if (!pdf) return;
  const sourcePdf = pdf;
  const query = $<HTMLInputElement>('#search-input').value.trim();
  const epoch = ++searchEpoch;
  searchAbort?.abort();
  const abort = searchAbort = new AbortController();
  hits = [];
  selectedHit = null;
  selectedHitIndex = -1;
  activeSearchQuery = query;
  searchRunning = !!query;
  $('#search-results').innerHTML = '';
  pages.querySelectorAll<HTMLElement>('.page-shell').forEach(highlightVisibleText);
  if (!query) { $('#search-status').textContent = 'Enter text to search.'; return; }
  $('#search-status').textContent = 'Searching…';
  try {
    const nextHits = await searchPdf(sourcePdf, query, abort.signal);
    if (epoch !== searchEpoch || sourcePdf !== pdf) return;
    hits = nextHits;
    searchRunning = false;
    renderSearchResults();
  } catch (error) {
    if (abort.signal.aborted || epoch !== searchEpoch) return;
    searchRunning = false;
    $('#search-status').textContent = 'Unable to search this document.';
    console.error('PDF search failed:', error);
  }
}
function renderSearchResults() {
  updateSearchStatus();
  $('#search-results').innerHTML = hits.map((hit, index) => `<button class="search-result${index === selectedHitIndex ? ' active' : ''}" type="button" aria-current="${index === selectedHitIndex}" data-index="${index}"><span class="search-result-location">Page ${hit.page} · match ${hit.occurrence}</span><span class="search-snippet">${escapeHtml(hit.snippet.slice(0, hit.matchStart))}<mark>${escapeHtml(hit.snippet.slice(hit.matchStart, hit.matchEnd))}</mark>${escapeHtml(hit.snippet.slice(hit.matchEnd))}</span></button>`).join('');
  $('#search-results').querySelectorAll<HTMLButtonElement>('button').forEach(button => button.addEventListener('click', () => selectSearchHit(Number(button.dataset.index))));
  pages.querySelectorAll('.page-shell').forEach(shell => highlightVisibleText(shell as HTMLElement));
}

$('#open-button').addEventListener('click', pickDocument);
$('#welcome-open').addEventListener('click', pickDocument);
$('#sidebar-toggle').addEventListener('click', () => setSidebar(!sidebarVisible));
$('#previous-page').addEventListener('click', () => goToPage(currentPage - 1));
$('#next-page').addEventListener('click', () => goToPage(currentPage + 1));
pageNumber.addEventListener('change', () => goToPage(Number(pageNumber.value)));
pageNumber.addEventListener('keydown', event => { if (event.key === 'Enter') { goToPage(Number(pageNumber.value)); pageNumber.blur(); } });
$('#zoom-in').addEventListener('click', () => { commitZoomPreview(); setZoom(zoom + 0.15); });
$('#zoom-out').addEventListener('click', () => { commitZoomPreview(); setZoom(zoom - 0.15); });
$('#fit-width').addEventListener('click', () => { commitZoomPreview(); setZoom(scaleForFit(), true); });
viewer.addEventListener('wheel', event => {
  if (!pdf || !(event.ctrlKey || event.metaKey)) return;
  event.preventDefault();
  if (pinchStartZoom) return;
  const pixels = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewer.clientHeight : 1);
  wheelZoom = Math.max(0.4, Math.min(3, (wheelZoom ?? previewZoom ?? zoom) * Math.exp(-pixels / 400)));
  previewScale(wheelZoom, event.clientX, event.clientY);
  window.clearTimeout(wheelZoomTimer);
  wheelZoomTimer = window.setTimeout(commitZoomPreview, 400);
}, { passive: false });
// WKWebView reports trackpad pinches as gesture events on some macOS versions.
type PinchEvent = Event & { scale: number; clientX: number; clientY: number };
viewer.addEventListener('gesturestart', event => {
  if (!pdf) return;
  event.preventDefault();
  window.clearTimeout(wheelZoomTimer);
  pinchStartZoom = previewZoom ?? zoom;
});
viewer.addEventListener('gesturechange', event => {
  if (!pdf) return;
  event.preventDefault();
  const pinch = event as PinchEvent;
  if (pinchStartZoom && Number.isFinite(pinch.scale) && pinch.scale > 0) {
    previewScale(pinchStartZoom * pinch.scale, pinch.clientX, pinch.clientY);
  }
});
viewer.addEventListener('gestureend', event => { event.preventDefault(); pinchStartZoom = 0; commitZoomPreview(); });
window.addEventListener('blur', commitZoomPreview);
$('#rotate').addEventListener('click', () => { commitZoomPreview(); rotation = (rotation + 90) % 360; if (fitWidth) zoom = scaleForFit(); rebuildPages(); makeThumbnails(); zoomLabel.textContent = `${Math.round(zoom * 100)}%`; queueSessionSave(); });
function applyDarkMode(dark: boolean) {
  commitZoomPreview();
  const wasPreservingImages = darkMode && !invertImages;
  darkMode = dark;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  if (pdf && (wasPreservingImages || (dark && !invertImages))) { rebuildPages(); makeThumbnails(); }
}
function applyInvertImages(invert: boolean) {
  commitZoomPreview();
  if (invert === invertImages) return;
  invertImages = invert;
  document.documentElement.dataset.invertImages = String(invert);
  if (pdf && darkMode) { rebuildPages(); makeThumbnails(); }
}
const themeControls = mountThemeSwitch($('#theme-control'), { dark: darkMode, invertImages }, dark => {
  manualTheme = true;
  applyDarkMode(dark);
}, invert => {
  localStorage.setItem('invert-images', String(invert));
  applyInvertImages(invert);
});
systemTheme.addEventListener('change', event => {
  if (!manualTheme) { applyDarkMode(event.matches); themeControls.setDark(event.matches); }
});
window.addEventListener('storage', event => {
  if (event.key === 'invert-images') {
    const invert = event.newValue !== 'false';
    applyInvertImages(invert); themeControls.setInvert(invert);
  }
  if (event.key === annotationKey) { annotations = readAnnotations(annotationKey); repaintAnnotations(); }
});
tabBar = mountDocumentTabs($('#document-tabs-root'), activateDocumentTab, id => { void closeDocumentTab(id); }, newDocumentTab);
tabBar.update(documentTabs, activeDocumentId);
$('#new-window').addEventListener('click', () => { void newWindow().catch(error => toast(String(error))); });
$('#search-toggle').addEventListener('click', () => { setSidebar(true); showTab('search'); });
function captureSelectedText() {
  const selection = window.getSelection();
  if (!pdf || !selection || selection.isCollapsed || !selection.rangeCount) return;
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
let searchTimer: number | undefined;
$<HTMLInputElement>('#search-input').addEventListener('input', () => {
  window.clearTimeout(searchTimer);
  searchAbort?.abort();
  searchEpoch++;
  navigationEpoch++;
  hits = [];
  selectedHit = null;
  selectedHitIndex = -1;
  activeSearchQuery = '';
  searchRunning = false;
  $('#search-results').replaceChildren();
  updateSearchStatus();
  pages.querySelectorAll<HTMLElement>('.page-shell').forEach(highlightVisibleText);
  searchTimer = window.setTimeout(searchDocument, 150);
});
$('#previous-match').addEventListener('click', () => moveSearchHit(-1));
$('#next-match').addEventListener('click', () => moveSearchHit(1));
$<HTMLInputElement>('#search-input').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); moveSearchHit(event.shiftKey ? -1 : 1); } if (event.key === 'Escape') showTab('pages'); });
let scrollFrame = 0;
let trimTimer: number | undefined;
viewer.addEventListener('scroll', () => {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
  scrollFrame = 0;
  if (!pdf) return;
  const center = viewer.getBoundingClientRect().top + viewer.clientHeight * 0.32;
  let low = 0, high = pages.children.length - 1;
  let nearest = currentPage;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const rect = pages.children[middle].getBoundingClientRect();
    if (rect.bottom < center) low = middle + 1;
    else if (rect.top > center) high = middle - 1;
    else { nearest = middle + 1; break; }
  }
  if (low > high) {
    const candidates = [high, low].filter(index => index >= 0 && index < pages.children.length);
    nearest = candidates.reduce((best, index) => {
      const rect = pages.children[index].getBoundingClientRect();
      const gap = Math.max(rect.top - center, center - rect.bottom, 0);
      return gap < best.gap ? { page: index + 1, gap } : best;
    }, { page: currentPage, gap: Infinity }).page;
  }
  if (nearest !== currentPage) { currentPage = nearest; updatePageUi(); }
  queueSessionSave();
  window.clearTimeout(trimTimer);
  trimTimer = window.setTimeout(trimRenderedPages, 180);
  });
}, { passive: true });
new ResizeObserver(() => refreshFitIfNeeded()).observe(viewer);
window.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); void newWindow().catch(error => toast(String(error))); return; }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 't') { event.preventDefault(); newDocumentTab(); return; }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'w') { event.preventDefault(); void closeDocumentTab(activeDocumentId); return; }
  if (event.ctrlKey && event.key === 'Tab') {
    event.preventDefault();
    const index = documentTabs.findIndex(tab => tab.id === activeDocumentId);
    activateDocumentTab(documentTabs[(index + (event.shiftKey ? -1 : 1) + documentTabs.length) % documentTabs.length].id);
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); pickDocument(); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); if (pdf) { setSidebar(true); showTab('search'); } }
  if ((event.metaKey || event.ctrlKey) && (event.key === '+' || event.key === '=')) { event.preventDefault(); commitZoomPreview(); setZoom(zoom + 0.15); }
  if ((event.metaKey || event.ctrlKey) && event.key === '-') { event.preventDefault(); commitZoomPreview(); setZoom(zoom - 0.15); }
  if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('input, textarea, button, [role=tab], [contenteditable=true]'))) return;
  if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); goToPage(currentPage + 1); }
  if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); goToPage(currentPage - 1); }
});
void onMenuAction(action => {
  if (action === 'new-tab') newDocumentTab();
  if (action === 'close-tab') void closeDocumentTab(activeDocumentId);
  if (action === 'open') void pickDocument();
  if (action === 'find' && pdf) { setSidebar(true); showTab('search'); }
}).catch(error => console.error('Unable to register menu actions:', error));
onOpenedDocument(openDocument, error => toast(error instanceof Error ? error.message : 'Unable to open file.', 6000));
void getSessions().then(info => {
  recentWindows = info.recent;
  renderRecentWindows();
  if (info.restore) void restoreSavedWindow(info.restore, true);
}).catch(error => console.error('Unable to load previous windows:', error));
let lastDropPath = '';
let lastDropTime = 0;
void getCurrentWebview().onDragDropEvent(event => {
  const overlay = $('#drop-overlay');
  if (event.payload.type === 'enter') {
    overlay.hidden = false;
  } else if (event.payload.type === 'leave') {
    overlay.hidden = true;
  } else if (event.payload.type === 'drop') {
    overlay.hidden = true;
    const paths = event.payload.paths;
    const path = paths.join('\n');
    if (!paths.length) return;
    const now = performance.now();
    if (path === lastDropPath && now - lastDropTime < 500) return;
    lastDropPath = path;
    lastDropTime = now;
    void (async () => { for (const path of paths) await openDocument(await readDocument(path)); })().catch(error => {
      toast(error instanceof Error ? error.message : 'Unable to open file.', 6000);
    });
  }
}).catch(error => console.error('Unable to listen for file drops:', error));

// Hidden native webviews may suspend animation frames. Reveal on the next task,
// once controls and theme are initialized; the native background matches the UI.
window.setTimeout(() => { void windowReady(darkMode).catch(console.error); }, 0);
