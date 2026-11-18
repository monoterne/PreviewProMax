import './compatibility';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import './style.css';
import { pickDocumentPaths, readDocument, onOpenPath, onMenuAction, newWindow, closeWindow, windowReady, getSessions, saveSession, archiveSession, type OpenedDocument, type SavedTab, type SavedWindow } from './desktop';
import { mountApp } from './app-shell';
import { releaseCanvases, renderLinks, renderRaster, renderText } from './pdf-rendering';
import { mountZoom, type ZoomPoint } from './zoom';
import { mountSidebarTabs, mountThemeSwitch } from './controls';
import { mountDocumentTabs } from './document-tabs';
import { type SearchHit } from './search';
import { searchPdf } from './pdf-search';
import { renderOutline } from './outline';
import { mountAnnotations } from './annotations';
import type { SidebarTab } from './controls';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type PdfDocument = pdfjs.PDFDocumentProxy;
type Dimensions = { width: number; height: number };

function escapeHtml(text: string) { return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }
const { systemTheme, savedInvertImages } = mountApp(document.querySelector<HTMLDivElement>('#app')!);

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
type SearchState = 'idle' | 'searching' | 'failed';
let searchState: SearchState = 'idle';
let selectedHitIndex = -1;
let darkMode = systemTheme.matches;
let invertImages = savedInvertImages;
let manualTheme = false;
let toastTimer: number | undefined;
let pageObserver: IntersectionObserver | null = null;
let thumbObserver: IntersectionObserver | null = null;
const pageRenders = new WeakMap<HTMLElement, { epoch: number; task: Promise<void> }>();
const renderedText = new WeakMap<HTMLElement, { divs: HTMLElement[]; strings: string[] }>();
const textLayerReady = new WeakMap<Element, Promise<void>>();
const annotationTools = mountAnnotations({
  pages, viewer, renderedText, enabled: () => !!pdf, getRotation: () => rotation, toast,
});

type DocumentTab = {
  id: string; name: string; path: string | null; pdf: PdfDocument | null; page: number; zoom: number;
  rotation: number; fit: boolean; dimensions: Dimensions[]; top: number; left: number;
  query: string; activeQuery: string; searchState: SearchState; hits: SearchHit[]; selected: number;
  sidebarTab: SidebarTab; thumbnailTop: number; resultsTop: number;
  annotationKey: string;
};
let nextDocumentId = 1;
function emptyDocumentTab(): DocumentTab {
  return { id: String(nextDocumentId++), name: 'New tab', path: null, pdf: null, page: 1, zoom: 1.25,
    rotation: 0, fit: true, dimensions: [], top: 0, left: 0, query: '', activeQuery: '',
    searchState: 'idle', hits: [], selected: -1, sidebarTab: 'pages', thumbnailTop: 0, resultsTop: 0, annotationKey: '' };
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
    button.addEventListener('click', () => { void queueOpen(() => restoreSavedWindow(saved)); });
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
    hits, searchState, selected: selectedHitIndex, sidebarTab: activeTab,
    thumbnailTop: thumbs.scrollTop, resultsTop: $('#search-results').scrollTop });
}
function activateDocumentTab(id: string) {
  const tab = documentTabs.find(tab => tab.id === id);
  if (!tab || id === activeDocumentId) return;
  commitZoomPreview();
  saveDocumentTab();
  const previousPdf = pdf;
  searchAbort?.abort();
  searchEpoch++; navigationEpoch++; renderEpoch++; thumbnailEpoch++;
  window.clearTimeout(searchTimer);
  pageObserver?.disconnect(); thumbObserver?.disconnect();
  releaseCanvases(pages); releaseCanvases(thumbs);
  pages.replaceChildren(); thumbs.replaceChildren();
  activeDocumentId = id;
  pdf = tab.pdf; documentName = tab.name; currentPage = tab.page;
  annotationTools.activate(tab.annotationKey);
  zoom = tab.zoom; rotation = tab.rotation; fitWidth = tab.fit; dimensions = tab.dimensions;
  hits = tab.hits; activeSearchQuery = tab.activeQuery; searchState = tab.searchState;
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
    const target = pages.querySelector<HTMLElement>(`.page-shell[data-page="${currentPage}"]`)!;
    void renderPage(target, renderEpoch);
  }
  viewer.scrollTo({ top: tab.top, left: tab.left, behavior: 'auto' });
  thumbs.scrollTop = tab.thumbnailTop;
  $('#search-results').scrollTop = tab.resultsTop;
  if (pdf && tab.query && (tab.searchState === 'searching' || tab.query.trim() !== tab.activeQuery)) void searchDocument();
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
  if (closed.pdf) { await Promise.allSettled([...renderJobs]); await closed.pdf.loadingTask.destroy(); }
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
  $('#sidebar-toggle').setAttribute('aria-expanded', String(shown));
  if (wasShown !== shown) window.setTimeout(() => { if (pdf) refreshFitIfNeeded(); }, 40);
}
function updatePageUi(revealThumbnail = false) {
  if (!pdf) return;
  pageNumber.value = String(currentPage);
  $('#page-total').textContent = `/ ${pdf.numPages}`;
  const previous = thumbs.querySelector<HTMLElement>('.thumbnail.active');
  const active = thumbs.children.item(currentPage - 1) as HTMLElement | null;
  if (previous !== active) {
    previous?.classList.remove('active'); previous?.removeAttribute('aria-current');
    active?.classList.add('active'); active?.setAttribute('aria-current', 'page');
  }
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
  const style = getComputedStyle(pages);
  const available = viewer.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  return Math.max(0.4, Math.min(2.5, available / width));
}
let fitWidth = true;
function refreshFitIfNeeded() { if (fitWidth) setZoom(scaleForFit(), true); }
const zoomController = mountZoom({
  viewer, pages, enabled: () => !!pdf, value: () => zoom, currentPage: () => currentPage,
  preview: value => {
    zoomLabel.textContent = `${Math.round(value * 100)}%`;
    fitWidth = false;
    $('#fit-width').classList.remove('selected');
  },
  apply: applyZoom,
});
function commitZoomPreview() { zoomController.commit(); }
function setZoom(value: number, keepFit = false) { zoomController.set(value, keepFit); }
function applyZoom(next: number, keepFit: boolean, point: ZoomPoint | null) {
  if (!pdf || (Math.abs(next - zoom) < 0.0001 && keepFit === fitWidth)) return;
  fitWidth = keepFit;
  zoom = next;
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  $('#fit-width').classList.toggle('selected', fitWidth);
  renderEpoch++;
  navigationEpoch++;
  updatePageSizes();
  observePages();
  zoomController.restore(point);
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
function trackRender(job: Promise<void>): Promise<void> {
  const task = job.finally(() => renderJobs.delete(task));
  renderJobs.add(task);
  return task;
}
function renderPage(shell: HTMLElement, epoch: number): Promise<void> {
  if (epoch !== renderEpoch || shell.parentElement !== pages) return Promise.resolve();
  const pending = pageRenders.get(shell);
  if (pending) return pending.epoch === epoch ? pending.task : pending.task.then(() => renderPage(shell, renderEpoch));
  const task = trackRender(renderPageContent(shell, epoch).finally(() => {
    if (pageRenders.get(shell)?.task === task) pageRenders.delete(shell);
  }));
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
    const canvas = await renderRaster(page, viewport, Math.min(window.devicePixelRatio || 1, 2), darkMode && !invertImages);
    if (epoch !== renderEpoch) { canvas.width = 0; canvas.height = 0; return; }
    const content = document.createElement('div');
    content.className = 'page-content';
    content.style.width = `${viewport.width}px`;
    content.style.height = `${viewport.height}px`;
    content.append(canvas);
    const previous = shell.querySelector<HTMLElement>('.page-content');
    if (previous) {
      previous.remove();
      releaseCanvases(previous);
    }
    shell.querySelector('.page-loading')?.remove();
    shell.prepend(content);
    shell.dataset.rendered = 'true';
    shell.dataset.renderedZoom = String(zoom);
    renderedText.delete(shell);
    annotationTools.paintDrawings(shell);
    // Text and links belong to this raster, even if a zoom or tab switch replaces it.
    const textReady = renderText(page, viewport).then(text => {
      if (!content.isConnected) return;
      content.append(text.element);
      renderedText.set(shell, { divs: text.divs, strings: text.strings });
      highlightVisibleText(shell);
    }).catch(error => console.error('Unable to extract page text:', error));
    textLayerReady.set(content, trackRender(textReady));
    void trackRender(renderLinks(page, viewport, pdf, pageNumber => { void goToPage(pageNumber); }).then(links => {
      if (content.isConnected) content.append(links);
    }).catch(error => console.error('Unable to load page links:', error)));
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
  annotationTools.paintText(shell);
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
  const status = $('#search-status');
  if (searchState === 'failed') status.textContent = 'Unable to search this document.';
  else if (searchState === 'searching') status.textContent = 'Searching…';
  else status.textContent = hits.length
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
  const content = shell.querySelector('.page-content');
  if (content) await textLayerReady.get(content);
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
    button.setAttribute('aria-label', `Page ${i}`);
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
  return trackRender(renderThumbnailContent(button, epoch));
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
    const canvas = await renderRaster(page, viewport, 1.5, darkMode && !invertImages);
    if (pdf !== sourcePdf || epoch !== thumbnailEpoch || button.dataset.visible !== 'true') {
      canvas.width = 0; canvas.height = 0;
      return;
    }
    button.querySelector('.thumbnail-paper')!.replaceChildren(canvas);
    button.dataset.rendered = 'true';
  } catch { /* Keep the placeholder until the page is visible again. */ }
  finally { if (button.dataset.rendered === 'loading') button.dataset.rendered = ''; }
}
function showOpenError(error: unknown) {
  toast(error instanceof Error ? error.message : String(error), 6000);
}
function queueOpen(work: () => Promise<void>) {
  openQueue = openQueue.then(work).catch(showOpenError);
  return openQueue;
}
function openPaths(paths: string[]) {
  return queueOpen(async () => {
    for (const path of paths) {
      try { await loadDocument(await readDocument(path)); }
      catch (error) { showOpenError(error); }
    }
  });
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
    await loaded.loadingTask.destroy();
    console.error(error);
    toast(error instanceof Error ? error.message : 'Unable to open PDF.');
  }
}
async function pickDocument() {
  try {
    await openPaths(await pickDocumentPaths());
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
      try { await loadDocument(await readDocument(tab.path), tab); }
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
  searchState = query ? 'searching' : 'idle';
  $('#search-results').innerHTML = '';
  pages.querySelectorAll<HTMLElement>('.page-shell').forEach(highlightVisibleText);
  updateSearchStatus();
  if (!query) return;
  try {
    const nextHits = await searchPdf(sourcePdf, query, abort.signal);
    if (epoch !== searchEpoch || sourcePdf !== pdf) return;
    hits = nextHits;
    searchState = 'idle';
    renderSearchResults();
  } catch (error) {
    if (abort.signal.aborted || epoch !== searchEpoch) return;
    searchState = 'failed';
    updateSearchStatus();
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
});
tabBar = mountDocumentTabs($('#document-tabs-root'), activateDocumentTab, id => { void closeDocumentTab(id); }, newDocumentTab);
tabBar.update(documentTabs, activeDocumentId);
$('#new-window').addEventListener('click', () => { void newWindow().catch(error => toast(String(error))); });
$('#search-toggle').addEventListener('click', () => { setSidebar(true); showTab('search'); });
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
  searchState = 'idle';
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
  if (event.key === 'Escape' && annotationTools.dismissDrawing()) return;
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
onOpenPath(path => openPaths([path]), showOpenError);
let lastDropPath = '';
let lastDropTime = 0;
const dropListenerReady = getCurrentWebview().onDragDropEvent(event => {
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
    void openPaths(paths);
  }
}).catch(error => console.error('Unable to listen for file drops:', error));

// Reserve the first turn in this window's open queue before native events arrive.
// Show the themed window before restoring PDFs, which may prompt for a password.
void queueOpen(async () => {
  await dropListenerReady;
  await windowReady(darkMode).catch(console.error);
  const info = await getSessions();
  recentWindows = info.recent;
  renderRecentWindows();
  if (info.restore) await restoreSavedWindow(info.restore, true);
});
