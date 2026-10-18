// Panels use ordinary buttons and fields, with consistent keyboard access in WKWebView.
export function mountDropdown(toggle: HTMLButtonElement, panel: HTMLElement) {
  const container = toggle.parentElement!;
  const controls = () => [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), input, select')]
    .filter(element => element.getClientRects().length > 0);
  function close(restoreFocus = false) {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle.focus({ preventScroll: true });
  }
  toggle.addEventListener('click', event => {
    if (!panel.hidden) { close(); return; }
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    if (event.detail === 0) controls()[0]?.focus({ preventScroll: true });
  });
  container.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) {
      event.preventDefault(); event.stopPropagation(); close(true);
    } else if (event.target === toggle && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault(); panel.hidden = false; toggle.setAttribute('aria-expanded', 'true');
      const items = controls();
      (event.key === 'ArrowDown' ? items[0] : items.at(-1))?.focus();
    } else if (event.key === 'Tab' && !panel.hidden && panel.contains(event.target as Node)) {
      const items = controls();
      const current = items.indexOf(event.target as HTMLElement);
      const next = items[current + (event.shiftKey ? -1 : 1)];
      if (next) { event.preventDefault(); next.focus(); }
      else {
        const focusable = [...document.querySelectorAll<HTMLElement>('button, input, select, a[href], [tabindex]')]
          .filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0);
        const destination = event.shiftKey ? toggle : focusable[focusable.indexOf(event.target as HTMLElement) + 1];
        if (destination) { event.preventDefault(); destination.focus(); }
        close();
      }
    }
  });
  container.addEventListener('focusout', event => {
    if (event.relatedTarget instanceof Node && !container.contains(event.relatedTarget)) close();
  });
  document.addEventListener('pointerdown', event => {
    if (event.target instanceof Node && !container.contains(event.target)) close();
  });
  return { close };
}
