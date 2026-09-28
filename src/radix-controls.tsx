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
          <div id="search-status" className="search-status">Enter text to search.</div>
          <div id="search-results" className="search-results" />
        </Tabs.Content>
      </Tabs.Root>
    );
  }

  const root = createRoot(node);
  flushSync(() => root.render(<SidebarTabs />));
  return { setTab, unmount: () => root.unmount() };
}

export function mountThemeSwitch(node: HTMLElement, onChange: (dark: boolean) => void) {
  function ThemeSwitch() {
    const [dark, setDark] = useState(false);
    return (
      <div className="theme-control">
        <label htmlFor="dark-mode-switch">Dark mode</label>
        <Switch.Root
          id="dark-mode-switch"
          className="theme-switch"
          checked={dark}
          onCheckedChange={checked => { setDark(checked); onChange(checked); }}
        >
          <Switch.Thumb className="theme-switch-thumb" />
        </Switch.Root>
      </div>
    );
  }
  const root = createRoot(node);
  flushSync(() => root.render(<ThemeSwitch />));
  return () => root.unmount();
}
