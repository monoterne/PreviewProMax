import * as pdfjs from 'pdfjs-dist';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import './style.css';
import { pickDocumentFile, readDocument, onOpenedDocument, type OpenedDocument } from './desktop';
import { darkenOutsideImages } from './dark-page';
import { mountSidebarTabs, mountThemeSwitch } from './radix-controls';
import { findOccurrences, type SearchHit } from './search';

// PDF.js uses recent Map methods that older system webviews may not provide.
const mapPrototype = Map.prototype as Map<unknown, unknown> & {
  getOrInsert?: (key: unknown, value: unknown) => unknown;
  getOrInsertComputed?: (key: unknown, callback: (key: unknown) => unknown) => unknown;
};
mapPrototype.getOrInsert ??= function (key, value) {
  if (!this.has(key)) this.set(key, value);
  return this.get(key);
};
mapPrototype.getOrInsertComputed ??= function (key, callback) {
  if (!this.has(key)) this.set(key, callback(key));
  return this.get(key);
};

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type PdfDocument = pdfjs.PDFDocumentProxy;
type Dimensions = { width: number; height: number };

const paths: Record<string, string> = {
  file: '<path d="M7 2.75h6l4.25 4.25V20a1.25 1.25 0 0 1-1.25 1.25H7A1.25 1.25 0 0 1 5.75 20V4A1.25 1.25 0 0 1 7 2.75Z"/><path d="M13 3v4.5h4.25M8.5 12h6M8.5 15.5h6"/>',
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
document.documentElement.dataset.theme = 'light';
document.documentElement.dataset.invertImages = 'true';
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
      <button class="icon-button document-tool" id="rotate" aria-label="Rotate pages" title="Rotate pages" hidden>${icon('rotate')}</button>
      <button class="icon-button document-tool" id="search-toggle" aria-label="Find in document" title="Find in document" hidden>${icon('search')}</button>
      <span class="toolbar-divider"></span>
      <div id="theme-control"></div>
      <button id="open-button" class="open-button">${icon('folder', 16)}<span>Open</span></button>
    </div>
  </header>
  <div class="workspace">
    <aside class="sidebar" id="sidebar" hidden><div id="sidebar-tabs-root"></div></aside>
    <main id="viewer" class="viewer">
      <div id="welcome" class="welcome">
        <div class="empty-icon">${icon('file', 24)}</div>
        <h1>Open a PDF</h1>
        <button id="welcome-open" class="open-button">${icon('folder', 16)}<span>Choose file</span></button>
        <p>Or drop a PDF here</p>
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
let activeTab: 'pages' | 'search' = 'pages';
const sidebarTabs = mountSidebarTabs(document.querySelector<HTMLElement>('#sidebar-tabs-root')!, tab => {
  activeTab = tab;
  if (tab === 'search') queueMicrotask(() => $<HTMLInputElement>('#search-input').focus());
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
let navigationEpoch = 0;
let searchEpoch = 0;
let hits: SearchHit[] = [];
let selectedHit: SearchHit | null = null;
let pendingHitNavigation: SearchHit | null = null;
let darkMode = false;
let invertImages = true;
let toastTimer: number | undefined;
let pageObserver: IntersectionObserver | null = null;
let thumbObserver: IntersectionObserver | null = null;
const renderedText = new WeakMap<HTMLElement, { divs: HTMLElement[]; strings: string[]; eols: boolean[] }>();

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
function showTab(tab: 'pages' | 'search') {
  activeTab = tab;
  sidebarTabs.setTab(tab);
  if (tab === 'search') queueMicrotask(() => $<HTMLInputElement>('#search-input').focus());
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
  document.querySelectorAll<HTMLElement>('.thumbnail').forEach((el) => el.classList.toggle('active', Number(el.dataset.page) === currentPage));
  const active = thumbs.querySelector<HTMLElement>('.thumbnail.active');
  if (revealThumbnail && active && activeTab === 'pages') {
    const item = active.getBoundingClientRect();
    const list = thumbs.getBoundingClientRect();
    if (item.top < list.top) thumbs.scrollTop += item.top - list.top - 8;
    else if (item.bottom > list.bottom) thumbs.scrollTop += item.bottom - list.bottom + 8;
  }
}
async function goToPage(number: number) {
  if (!pdf) return;
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
function setZoom(value: number, keepFit = false) {
  if (!pdf) return;
  const next = Math.max(0.4, Math.min(3, Math.round(value * 20) / 20));
  if (Math.abs(next - zoom) < 0.001 && keepFit === fitWidth) return;
  fitWidth = keepFit;
  zoom = next;
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  $('#fit-width').classList.toggle('selected', fitWidth);
  rebuildPages();
}
function updatePageSizes() {
  pages.querySelectorAll<HTMLElement>('.page-shell').forEach((shell, index) => {
    const d = pageDimensions(index);
    shell.style.width = `${d.width * zoom}px`;
    shell.style.height = `${d.height * zoom}px`;
  });
}
function rebuildPages() {
  if (!pdf) return;
  renderEpoch++;
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
  pageObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) renderPage(entry.target as HTMLElement, renderEpoch);
  }, { root: viewer, rootMargin: '700px 0px' });
  pages.querySelectorAll('.page-shell').forEach(el => pageObserver!.observe(el));
}
async function renderPage(shell: HTMLElement, epoch: number) {
  if (!pdf || shell.dataset.rendering === 'true' || shell.dataset.rendered === 'true') return;
  shell.dataset.rendering = 'true';
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
    const viewport = page.getViewport({ scale: zoom, rotation });
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
    try {
      const text = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textLayer, viewport });
      await text.render();
      const divs = text.textDivs as HTMLElement[];
      renderedText.set(shell, {
        divs,
        strings: text.textContentItemsStr,
        eols: divs.map(div => div.nextElementSibling?.tagName === 'BR')
      });
    } catch { /* Image-only PDFs still render correctly. */ }
    if (epoch !== renderEpoch) return;
    shell.querySelector('.page-loading')?.remove();
    shell.prepend(canvas, textLayer);
    shell.dataset.rendered = 'true';
    highlightVisibleText(shell);
    if (pendingHitNavigation?.page === number && scrollToSelectedMatch(shell)) pendingHitNavigation = null;
  } catch (error) {
    if (epoch === renderEpoch) shell.querySelector('.page-loading')!.textContent = 'Unable to render this page';
    console.error(error);
  } finally { shell.dataset.rendering = 'false'; }
}
function trimRenderedPages() {
  const view = viewer.getBoundingClientRect();
  const margin = viewer.clientHeight * 1.5;
  pages.querySelectorAll<HTMLElement>('.page-shell[data-rendered="true"]').forEach(shell => {
    const rect = shell.getBoundingClientRect();
    if (rect.bottom < view.top - margin || rect.top > view.bottom + margin) {
      const canvas = shell.querySelector('canvas');
      canvas?.remove();
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      shell.querySelector('.textLayer')?.remove();
      renderedText.delete(shell);
      shell.dataset.rendered = 'false';
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
  const query = $<HTMLInputElement>('#search-input').value.trim();
  const page = Number(shell.dataset.page);
  const pageText = layer.strings.map((value, index) => value + (layer.eols[index] ? ' ' : '')).join('');
  const matches = findOccurrences(pageText, query, page);
  let itemStart = 0;
  layer.divs.forEach((span, index) => {
    const source = layer.strings[index];
    const itemEnd = itemStart + source.length;
    if (!source || !query) { span.textContent = source; itemStart = itemEnd + (layer.eols[index] ? 1 : 0); return; }
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
    itemStart = itemEnd + (layer.eols[index] ? 1 : 0);
  });
}
function scrollToSelectedMatch(shell: HTMLElement) {
  if (!selectedHit) return false;
  const mark = shell.querySelector<HTMLElement>(`mark[data-occurrence="${selectedHit.occurrence}"]`);
  if (!mark) return false;
  const offset = mark.getBoundingClientRect().top - viewer.getBoundingClientRect().top;
  viewer.scrollTo({ top: viewer.scrollTop + offset - viewer.clientHeight * 0.32, behavior: 'auto' });
  return true;
}
function selectSearchHit(index: number) {
  const hit = hits[index];
  if (!hit) return;
  selectedHit = hit;
  pendingHitNavigation = hit;
  $('#search-results').querySelectorAll<HTMLElement>('.search-result').forEach((result, resultIndex) => {
    result.classList.toggle('active', resultIndex === index);
  });
  const shell = pages.querySelector<HTMLElement>(`.page-shell[data-page="${hit.page}"]`);
  if (shell) highlightVisibleText(shell);
  if (shell?.dataset.rendered === 'true' && scrollToSelectedMatch(shell)) pendingHitNavigation = null;
  else goToPage(hit.page);
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
  thumbObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const button = entry.target as HTMLElement;
      button.dataset.visible = String(entry.isIntersecting);
      if (entry.isIntersecting) renderThumbnail(button, renderEpoch);
      else if (button.dataset.rendered === 'true') {
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
async function renderThumbnail(button: HTMLElement, epoch: number) {
  if (!pdf || button.dataset.rendered) return;
  button.dataset.rendered = 'loading';
  try {
    const sourcePdf = pdf;
    const page = await pdf.getPage(Number(button.dataset.page));
    if (pdf !== sourcePdf || epoch !== renderEpoch) return;
    const natural = page.getViewport({ scale: 1, rotation });
    const size = setThumbnailSize(button, { width: natural.width, height: natural.height });
    const viewport = page.getViewport({ scale: size.width / natural.width, rotation });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width * 1.5);
    canvas.height = Math.ceil(viewport.height * 1.5);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const preserveImages = darkMode && !invertImages;
    if (preserveImages) page.imageCoordinates = null;
    await page.render({ canvasContext: canvas.getContext('2d')!, canvas, viewport, transform: [1.5, 0, 0, 1.5, 0, 0], recordImages: preserveImages }).promise;
    if (pdf !== sourcePdf || epoch !== renderEpoch || button.dataset.visible !== 'true') return;
    if (preserveImages) {
      try { darkenOutsideImages(canvas, page.imageCoordinates); }
      catch (error) { canvas.classList.add('dark-filter-fallback'); console.error('Unable to preserve thumbnail image colors:', error); }
    }
    button.querySelector('.thumbnail-paper')!.replaceChildren(canvas);
    button.dataset.rendered = 'true';
  } catch { /* Keep the placeholder until the page is visible again. */ }
  finally { if (button.dataset.rendered === 'loading') button.dataset.rendered = ''; }
}
async function openDocument(file: OpenedDocument) {
  const bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes);
  const task = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
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
    searchEpoch++;
    renderEpoch++;
    navigationEpoch++;
    pageObserver?.disconnect();
    thumbObserver?.disconnect();
    await pdf?.destroy();
    pdf = null;
    $('#welcome').hidden = false;
    pages.hidden = true;
    pdf = loaded;
    documentName = file.name;
    currentPage = 1;
    rotation = 0;
    dimensions = [];
    const first = await loaded.getPage(1);
    const viewport = first.getViewport({ scale: 1 });
    dimensions[0] = { width: viewport.width, height: viewport.height };
    zoom = scaleForFit();
    fitWidth = true;
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    $('#fit-width').classList.add('selected');
    updateTitle();
    $('#welcome').hidden = true;
    pages.hidden = false;
    $('#navigation').hidden = false;
    $<HTMLButtonElement>('#sidebar-toggle').disabled = false;
    document.querySelectorAll<HTMLElement>('.document-tool').forEach(el => el.hidden = false);
    setSidebar(sidebarVisible);
    $<HTMLInputElement>('#search-input').value = '';
    hits = [];
    selectedHit = null;
    pendingHitNavigation = null;
    $('#search-results').innerHTML = '';
    $('#search-status').textContent = 'Enter text to search.';
    rebuildPages();
    makeThumbnails();
    viewer.scrollTop = 0;
    updatePageUi();
  } catch (error) {
    console.error(error);
    toast(error instanceof Error ? error.message : 'Unable to open PDF.');
  }
}
async function pickDocument() {
  try {
    const document = await pickDocumentFile();
    if (document) await openDocument(document);
  } catch (error) { toast(error instanceof Error ? error.message : 'Unable to open file.'); }
}
async function searchDocument() {
  if (!pdf) return;
  const sourcePdf = pdf;
  const query = $<HTMLInputElement>('#search-input').value.trim();
  const epoch = ++searchEpoch;
  const nextHits: SearchHit[] = [];
  hits = [];
  selectedHit = null;
  pendingHitNavigation = null;
  $('#search-results').innerHTML = '';
  pages.querySelectorAll<HTMLElement>('.page-shell').forEach(highlightVisibleText);
  if (!query) { $('#search-status').textContent = 'Enter text to search.'; return; }
  $('#search-status').textContent = 'Searching…';
  for (let page = 1; page <= sourcePdf.numPages; page++) {
    if (epoch !== searchEpoch) return;
    try {
      const content = await sourcePdf.getPage(page).then(p => p.getTextContent());
      if (epoch !== searchEpoch || sourcePdf !== pdf) return;
      const text = content.items.map(item => 'str' in item ? `${item.str}${item.hasEOL ? ' ' : ''}` : '').join('');
      for (const hit of findOccurrences(text, query, page)) nextHits.push(hit);
    } catch { /* Skip pages without readable text. */ }
    if (page % 10 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (epoch !== searchEpoch || sourcePdf !== pdf) return;
  hits = nextHits;
  $('#search-status').textContent = hits.length ? `${hits.length} ${hits.length === 1 ? 'match' : 'matches'} found` : 'No matches found';
  $('#search-results').innerHTML = hits.map((hit, index) => `<button class="search-result" type="button" data-index="${index}"><span class="search-result-location">Page ${hit.page} · match ${hit.occurrence}</span><span class="search-snippet">${escapeHtml(hit.snippet.slice(0, hit.matchStart))}<mark>${escapeHtml(hit.snippet.slice(hit.matchStart, hit.matchEnd))}</mark>${escapeHtml(hit.snippet.slice(hit.matchEnd))}</span></button>`).join('');
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
$('#zoom-in').addEventListener('click', () => setZoom(zoom + 0.15));
$('#zoom-out').addEventListener('click', () => setZoom(zoom - 0.15));
$('#fit-width').addEventListener('click', () => setZoom(scaleForFit(), true));
$('#rotate').addEventListener('click', () => { rotation = (rotation + 90) % 360; if (fitWidth) zoom = scaleForFit(); rebuildPages(); makeThumbnails(); zoomLabel.textContent = `${Math.round(zoom * 100)}%`; });
mountThemeSwitch($('#theme-control'), dark => {
  const wasPreservingImages = darkMode && !invertImages;
  darkMode = dark;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  if (pdf && (wasPreservingImages || (dark && !invertImages))) { rebuildPages(); makeThumbnails(); }
}, invert => {
  invertImages = invert;
  document.documentElement.dataset.invertImages = String(invert);
  if (pdf && darkMode) { rebuildPages(); makeThumbnails(); }
});
$('#search-toggle').addEventListener('click', () => { setSidebar(true); showTab('search'); });
let searchTimer: number | undefined;
$<HTMLInputElement>('#search-input').addEventListener('input', () => { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(searchDocument, 250); });
$<HTMLInputElement>('#search-input').addEventListener('keydown', event => { if (event.key === 'Enter' && hits.length) selectSearchHit(0); if (event.key === 'Escape') showTab('pages'); });
viewer.addEventListener('scroll', () => {
  if (!pdf) return;
  const center = viewer.getBoundingClientRect().top + viewer.clientHeight * 0.32;
  let nearest = currentPage, distance = Infinity;
  pages.querySelectorAll<HTMLElement>('.page-shell').forEach(shell => {
    const rect = shell.getBoundingClientRect();
    const gap = Math.abs(rect.top + Math.min(rect.height * 0.35, 180) - center);
    if (gap < distance) { distance = gap; nearest = Number(shell.dataset.page); }
  });
  if (nearest !== currentPage) { currentPage = nearest; updatePageUi(); }
  trimRenderedPages();
}, { passive: true });
new ResizeObserver(() => refreshFitIfNeeded()).observe(viewer);
window.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); pickDocument(); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); if (pdf) { setSidebar(true); showTab('search'); } }
  if ((event.metaKey || event.ctrlKey) && (event.key === '+' || event.key === '=')) { event.preventDefault(); setZoom(zoom + 0.15); }
  if ((event.metaKey || event.ctrlKey) && event.key === '-') { event.preventDefault(); setZoom(zoom - 0.15); }
  if (event.target instanceof HTMLInputElement) return;
  if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); goToPage(currentPage + 1); }
  if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); goToPage(currentPage - 1); }
});
onOpenedDocument(openDocument, error => toast(error instanceof Error ? error.message : 'Unable to open file.', 6000));
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
    const path = event.payload.paths[0];
    if (!path) return;
    const now = performance.now();
    if (path === lastDropPath && now - lastDropTime < 500) return;
    lastDropPath = path;
    lastDropTime = now;
    void readDocument(path).then(openDocument).catch(error => {
      toast(error instanceof Error ? error.message : 'Unable to open file.', 6000);
    });
  }
}).catch(error => console.error('Unable to listen for file drops:', error));
