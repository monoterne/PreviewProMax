export type DocumentTabLabel = { id: string; name: string };

export function mountDocumentTabs(node: HTMLElement, onSelect: (id: string) => void, onClose: (id: string) => void, onNew: () => void) {
  node.innerHTML = '<div class="document-tabs"><div class="document-tab-list" role="tablist" aria-label="Open documents"></div><button id="new-tab" class="icon-button" aria-label="New tab" title="New tab (⌘/Ctrl+T)">+</button></div>';
  node.querySelector<HTMLButtonElement>('#new-tab')!.onclick = onNew;
  const list = node.querySelector<HTMLElement>('.document-tab-list')!;
  const nodes = new Map<string, HTMLElement>();
  list.onkeydown = event => {
    const buttons = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    const next = event.key === 'ArrowRight' ? (index + 1) % buttons.length : event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); buttons[next].focus(); }
  };
  return {
    update(tabs: DocumentTabLabel[], active: string) {
      for (const [id, element] of nodes) if (!tabs.some(tab => tab.id === id)) { element.remove(); nodes.delete(id); }
      for (const tab of tabs) {
        let element = nodes.get(tab.id);
        if (!element) {
          element = document.createElement('div'); element.className = 'document-tab';
          element.innerHTML = '<button class="document-tab-title" role="tab" aria-controls="viewer"></button><button class="document-tab-close">×</button>';
          element.querySelector<HTMLButtonElement>('[role="tab"]')!.onclick = () => onSelect(tab.id);
          element.querySelector<HTMLButtonElement>('.document-tab-close')!.onclick = () => onClose(tab.id);
          nodes.set(tab.id, element); list.append(element);
        }
        element.dataset.active = String(tab.id === active);
        const title = element.querySelector<HTMLButtonElement>('[role="tab"]')!;
        title.id = `document-tab-${tab.id}`; title.textContent = tab.name; title.title = tab.name;
        title.dataset.state = tab.id === active ? 'active' : 'inactive';
        title.setAttribute('aria-selected', String(tab.id === active)); title.tabIndex = tab.id === active ? 0 : -1;
        element.querySelector('.document-tab-close')!.setAttribute('aria-label', `Close ${tab.name}`);
      }
      document.querySelector('#viewer')?.setAttribute('aria-labelledby', `document-tab-${active}`);
    },
  };
}
