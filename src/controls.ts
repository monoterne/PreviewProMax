export type SidebarTab = 'pages' | 'search' | 'contents';

// These nodes remain mounted: switching views never replaces an input or its listeners.
export function mountSidebarTabs(node: HTMLElement, onTabChange: (tab: SidebarTab, focusInput: boolean) => void) {
  const tabs: SidebarTab[] = ['pages', 'search', 'contents'];
  node.innerHTML = `<div class="sidebar-tabs-root">
    <div class="sidebar-tabs" role="tablist" aria-label="Sidebar view">${tabs.map((tab, i) => `<button id="sidebar-${tab}" class="sidebar-tab" role="tab" aria-controls="pane-${tab}">${['Pages', 'Find', 'Contents'][i]}</button>`).join('')}</div>
    <section id="pane-pages" class="sidebar-pane" role="tabpanel" aria-labelledby="sidebar-pages"><div class="sidebar-section-heading" id="thumb-count"></div><div id="thumbnails" class="thumbnails"></div></section>
    <section id="pane-search" class="sidebar-pane" role="tabpanel" aria-labelledby="sidebar-search">
      <label class="search-label" for="search-input">Find in document</label>
      <input id="search-input" class="search-input" type="search" placeholder="Search text" autocomplete="off">
      <div class="search-navigation"><div id="search-status" class="search-status" role="status" aria-live="polite">Enter text to search.</div>
        <button id="previous-match" class="icon-button" aria-label="Previous match" title="Previous match (Shift+Enter)" disabled>↑</button>
        <button id="next-match" class="icon-button" aria-label="Next match" title="Next match (Enter)" disabled>↓</button></div>
      <div id="search-results" class="search-results"></div>
    </section>
    <section id="pane-contents" class="sidebar-pane" role="tabpanel" aria-labelledby="sidebar-contents"><div id="outline" class="min-h-0 overflow-auto p-2">Open a PDF to see its contents.</div></section>
  </div>`;
  function setTab(selected: SidebarTab) {
    for (const tab of tabs) {
      const active = tab === selected;
      const button = node.querySelector<HTMLButtonElement>(`#sidebar-${tab}`)!;
      button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
      button.dataset.state = active ? 'active' : 'inactive';
      const pane = node.querySelector<HTMLElement>(`#pane-${tab}`)!;
      pane.hidden = !active; pane.dataset.state = button.dataset.state;
    }
  }
  for (const [index, tab] of tabs.entries()) {
    const button = node.querySelector<HTMLButtonElement>(`#sidebar-${tab}`)!;
    button.onclick = () => { setTab(tab); onTabChange(tab, true); };
    button.onkeydown = event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault(); setTab(tabs[next]); onTabChange(tabs[next], false);
      node.querySelector<HTMLButtonElement>(`#sidebar-${tabs[next]}`)!.focus();
    };
  }
  setTab('pages');
  return { setTab };
}

export function mountThemeSwitch(node: HTMLElement, initial: { dark: boolean; invertImages: boolean }, onDarkChange: (dark: boolean) => void, onInvertImagesChange: (invert: boolean) => void) {
  node.className = 'theme-controls';
  function control(id: string, label: string, checked: boolean, change: (value: boolean) => void) {
    const container = document.createElement('div'); container.className = 'theme-control';
    container.innerHTML = `<label for="${id}">${label}</label><button id="${id}" class="theme-switch" role="switch" aria-label="${label}"><span class="theme-switch-thumb"></span></button>`;
    const button = container.querySelector('button')!;
    function set(value: boolean) {
      checked = value; button.setAttribute('aria-checked', String(value));
      button.dataset.state = value ? 'checked' : 'unchecked';
      button.firstElementChild!.setAttribute('data-state', button.dataset.state);
    }
    button.onclick = () => { set(!checked); change(checked); };
    set(checked); return { container, set };
  }
  const invert = control('invert-images-switch', 'Invert images', initial.invertImages, onInvertImagesChange);
  const dark = control('dark-mode-switch', 'Dark mode', initial.dark, value => { setDark(value); onDarkChange(value); });
  node.append(dark.container);
  function setDark(value: boolean) { dark.set(value); if (value) node.append(invert.container); else invert.container.remove(); }
  setDark(initial.dark);
  return { setDark, setInvert: invert.set };
}
