import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';

export type OpenedDocument = { name: string; bytes: Uint8Array };

export async function readPdf(path: string): Promise<OpenedDocument> {
  const bytes = await invoke<ArrayBuffer>('read_pdf', { path });
  return { name: path.split(/[\\/]/).pop() || 'Document.pdf', bytes: new Uint8Array(bytes) };
}

export async function pickPdf(): Promise<OpenedDocument | null> {
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'PDF documents', extensions: ['pdf'] }]
  });
  return typeof path === 'string' ? readPdf(path) : null;
}

export function onOpenedPdf(callback: (file: OpenedDocument) => void): () => void {
  let disposed = false;
  let unlisten: UnlistenFn | undefined;
  const consumePending = async () => {
    try {
      const path = await invoke<string | null>('take_pending_pdf');
      if (path && !disposed) callback(await readPdf(path));
    } catch (error) {
      console.error('Unable to open PDF from the operating system:', error);
    }
  };
  void listen('open-pdf-path', () => { void consumePending(); }).then(stop => {
    if (disposed) stop();
    else {
      unlisten = stop;
      void consumePending();
    }
  });
  return () => { disposed = true; unlisten?.(); };
}
