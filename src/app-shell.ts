import { isTauri } from '@tauri-apps/api/core';
import { mountDropdown } from './dropdown';

const paths: Record<string, string> = {
  settings: '<path d="M4 7h10m4 0h2M4 17h2m4 0h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  pencil: '<path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14v6Z"/>',
  rectangle: '<rect x="4" y="5" width="16" height="14" rx="2"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  eraser: '<path d="m7 21-4.3-4.3a2.4 2.4 0 0 1 0-3.4L13.3 2.7a2.4 2.4 0 0 1 3.4 0l4.6 4.6a2.4 2.4 0 0 1 0 3.4L11 21H7ZM6.5 9.5l8 8M11 21h10"/>',
  highlight: '<path d="m9 11 7-7 5 5-7 7M9 11l5 5-3 3-5-5 3-3ZM3 21h8M6 14l-3 6 6-3"/>',
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
export function mountApp(app: HTMLDivElement) {
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  const savedInvertImages = localStorage.getItem('invert-images') !== 'false';
  const macHeader = isTauri() && navigator.platform.startsWith('Mac');
  document.documentElement.dataset.theme = systemTheme.matches ? 'dark' : 'light';
  document.documentElement.dataset.invertImages = String(savedInvertImages);
  app.innerHTML = `
  <header class="toolbar"${macHeader ? ' data-window-controls="macos" data-tauri-drag-region="deep"' : ''}>
    <div class="toolbar-left">
      <button id="sidebar-toggle" class="icon-button" aria-label="Toggle sidebar" aria-controls="sidebar" aria-expanded="false" title="Toggle sidebar" disabled>${icon('panel')}</button>
    </div>
    <div class="toolbar-center" id="navigation" role="group" aria-label="Page navigation and zoom" data-tauri-drag-region="false" hidden>
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
      <div class="drawing-control document-tool" id="drawing-control" hidden>
        <button class="icon-button" id="drawing-toggle" aria-label="Drawing tools" aria-expanded="false" aria-controls="drawing-menu" title="Drawing tools">${icon('pencil')}</button>
        <div class="drawing-menu" id="drawing-menu" data-tauri-drag-region="false" hidden>
          <div class="drawing-tools" role="group" aria-label="Drawing tool">
            <button type="button" data-draw-tool="pencil" aria-label="Pencil" title="Pencil">${icon('pencil')}</button>
            <button type="button" data-draw-tool="rectangle" aria-label="Rectangle" title="Rectangle">${icon('rectangle')}</button>
            <button type="button" data-draw-tool="circle" aria-label="Circle" title="Circle">${icon('circle')}</button>
            <button type="button" data-draw-tool="eraser" aria-label="Eraser" title="Eraser">${icon('eraser')}</button>
          </div>
          <div class="drawing-options">
            <span>Color</span>
            <div class="drawing-colors" aria-label="Drawing color">
              <button type="button" data-draw-color="#e24b46" aria-label="Red" title="Red"></button>
              <button type="button" data-draw-color="#2672d9" aria-label="Blue" title="Blue"></button>
              <button type="button" data-draw-color="#23834b" aria-label="Green" title="Green"></button>
              <button type="button" data-draw-color="#252525" aria-label="Black" title="Black"></button>
              <button type="button" data-draw-color="#ffffff" aria-label="White" title="White"></button>
            </div>
            <label for="drawing-width">Line width</label>
            <select id="drawing-width" aria-label="Drawing line width"><option value="2">Thin</option><option value="4" selected>Medium</option><option value="8">Thick</option></select>
          </div>
          <button type="button" id="drawing-done" class="drawing-done">Done drawing</button>
        </div>
      </div>
      <div class="markup-control document-tool" id="markup-control" hidden>
        <button class="icon-button" id="markup-toggle" aria-label="Markup selected text" aria-expanded="false" aria-controls="markup-menu" title="Markup selected text">${icon('highlight')}</button>
        <div class="markup-menu" id="markup-menu" data-tauri-drag-region="false" hidden>
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
      <button class="icon-button document-tool" id="search-toggle" aria-label="Find in document" title="Find in document" hidden>${icon('search')}</button>
      <div class="view-control">
        <button class="icon-button" id="view-toggle" aria-label="View options" aria-expanded="false" aria-controls="view-menu" title="View options">${icon('settings')}</button>
        <div class="view-menu" id="view-menu" role="group" aria-label="View options" data-tauri-drag-region="false" hidden>
          <button class="menu-item document-tool" id="rotate" aria-label="Rotate pages" hidden>${icon('rotate', 16)}<span>Rotate clockwise</span></button>
          <div class="menu-heading">Appearance</div>
          <div id="theme-control"></div>
        </div>
      </div>
      <button id="open-button" class="open-button" aria-label="Open PDF">${icon('folder', 16)}<span>Open</span></button>
    </div>
  </header>
  <div class="document-bar"><div id="document-tabs-root"></div><button id="new-window" class="icon-button" aria-label="New window" title="New window (⌘/Ctrl+N)">${icon('window')}</button></div>
  <div class="workspace">
    <aside class="sidebar" id="sidebar" aria-label="Document navigation" hidden><div id="sidebar-tabs-root"></div></aside>
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

  const view = mountDropdown(app.querySelector<HTMLButtonElement>('#view-toggle')!, app.querySelector<HTMLElement>('#view-menu')!);
  app.querySelector('#rotate')!.addEventListener('click', () => view.close(true));
  return { systemTheme, savedInvertImages };
}
