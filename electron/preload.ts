import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  openPdf: () => ipcRenderer.invoke('dialog:open-pdf'),
  onDocument: (callback: (value: any) => void) => {
    const listener = (_event: IpcRendererEvent, document: unknown) => callback(document);
    ipcRenderer.on('document:opened', listener);
    return () => ipcRenderer.removeListener('document:opened', listener);
  },
  onAction: (callback: (value: any) => void) => {
    const actions = ['open', 'find', 'zoom-in', 'zoom-out'];
    const listeners = actions.map(action => {
      const listener = (_event: IpcRendererEvent) => callback(action);
      ipcRenderer.on(`action:${action}`, listener);
      return { action, listener };
    });
    return () => { for (const { action, listener } of listeners) ipcRenderer.removeListener(`action:${action}`, listener); };
  }
});
