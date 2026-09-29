import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import * as Tabs from '@radix-ui/react-tabs';

export type DocumentTabLabel = { id: string; name: string };

export function mountDocumentTabs(node: HTMLElement, onSelect: (id: string) => void, onClose: (id: string) => void, onNew: () => void) {
  const root = createRoot(node);
  return {
    update(tabs: DocumentTabLabel[], active: string) {
      flushSync(() => root.render(
        <Tabs.Root className="document-tabs" value={active} onValueChange={onSelect} activationMode="manual">
          <Tabs.List className="document-tab-list" aria-label="Open documents">
            {tabs.map(tab => <div className="document-tab" data-active={tab.id === active} key={tab.id}>
              <Tabs.Trigger id={`document-tab-${tab.id}`} className="document-tab-title" value={tab.id} aria-controls="viewer" title={tab.name}>{tab.name}</Tabs.Trigger>
              <button className="document-tab-close" aria-label={`Close ${tab.name}`} onClick={() => onClose(tab.id)}>×</button>
            </div>)}
          </Tabs.List>
          <button id="new-tab" className="icon-button" aria-label="New tab" title="New tab (⌘/Ctrl+T)" onClick={onNew}>+</button>
        </Tabs.Root>
      ));
      document.querySelector('#viewer')?.setAttribute('aria-labelledby', `document-tab-${active}`);
    },
  };
}
