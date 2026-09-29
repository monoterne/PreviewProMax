import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import * as Switch from '@radix-ui/react-switch';
import * as Tabs from '@radix-ui/react-tabs';

type SidebarTab = 'pages' | 'search';

export function mountSidebarTabs(node: HTMLElement, onTabChange: (tab: SidebarTab) => void) {
  let setTab: (tab: SidebarTab) => void = () => {};

  function SidebarTabs() {
    const [tab, setValue] = useState<SidebarTab>('pages');
    setTab = setValue;
    return (
      <Tabs.Root className="sidebar-tabs-root" value={tab} onValueChange={value => {
        const next = value as SidebarTab;
        setValue(next);
        onTabChange(next);
      }}>
        <Tabs.List className="sidebar-tabs" aria-label="Sidebar view">
          <Tabs.Trigger className="sidebar-tab" value="pages">Pages</Tabs.Trigger>
          <Tabs.Trigger className="sidebar-tab" value="search">Find</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content className="sidebar-pane" value="pages" forceMount>
          <div className="sidebar-section-heading" id="thumb-count" />
          <div id="thumbnails" className="thumbnails" />
        </Tabs.Content>
        <Tabs.Content className="sidebar-pane" value="search" forceMount>
          <label className="search-label" htmlFor="search-input">Find in document</label>
          <input id="search-input" className="search-input" type="search" placeholder="Search text" autoComplete="off" />
          <div className="search-navigation">
            <div id="search-status" className="search-status" role="status" aria-live="polite">Enter text to search.</div>
            <button id="previous-match" className="icon-button" aria-label="Previous match" title="Previous match (Shift+Enter)" disabled>↑</button>
            <button id="next-match" className="icon-button" aria-label="Next match" title="Next match (Enter)" disabled>↓</button>
          </div>
          <div id="search-results" className="search-results" />
        </Tabs.Content>
      </Tabs.Root>
    );
  }

  const root = createRoot(node);
  flushSync(() => root.render(<SidebarTabs />));
  return { setTab: (tab: SidebarTab) => flushSync(() => setTab(tab)), unmount: () => root.unmount() };
}

export function mountThemeSwitch(node: HTMLElement, initial: { dark: boolean; invertImages: boolean }, onDarkChange: (dark: boolean) => void, onInvertImagesChange: (invert: boolean) => void) {
  let updateDark: (value: boolean) => void = () => {};
  let updateInvert: (value: boolean) => void = () => {};
  function ThemeSwitch() {
    const [dark, setDark] = useState(initial.dark);
    const [invertImages, setInvertImages] = useState(initial.invertImages);
    updateDark = setDark;
    updateInvert = setInvertImages;
    return (
      <div className="theme-controls">
        <div className="theme-control">
          <label htmlFor="dark-mode-switch">Dark mode</label>
          <Switch.Root
            id="dark-mode-switch"
            className="theme-switch"
            aria-label="Dark mode"
            title="Dark mode"
            checked={dark}
            onCheckedChange={checked => { setDark(checked); onDarkChange(checked); }}
          >
            <Switch.Thumb className="theme-switch-thumb" />
          </Switch.Root>
        </div>
        {dark && <div className="theme-control">
          <label htmlFor="invert-images-switch">Invert images</label>
          <Switch.Root
            id="invert-images-switch"
            className="theme-switch"
            aria-label="Invert images in dark mode"
            title="Invert images in dark mode"
            checked={invertImages}
            onCheckedChange={checked => { setInvertImages(checked); onInvertImagesChange(checked); }}
          >
            <Switch.Thumb className="theme-switch-thumb" />
          </Switch.Root>
        </div>}
      </div>
    );
  }
  const root = createRoot(node);
  flushSync(() => root.render(<ThemeSwitch />));
  return { setDark: (value: boolean) => updateDark(value), setInvert: (value: boolean) => updateInvert(value), unmount: () => root.unmount() };
}
