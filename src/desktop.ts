import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';

export type OpenedDocument = { name: string; bytes: Uint8Array };

export async function readDocument(path: string): Promise<OpenedDocument> {
  const bytes = await invoke<ArrayBuffer>('read_document', { path });
  return { name: path.split(/[\\/]/).pop() || 'Document', bytes: new Uint8Array(bytes) };
}

export async function pickDocumentFile(): Promise<OpenedDocument | null> {
  const path = await open({
    multiple: false,
    directory: false
  });
  return typeof path === 'string' ? readDocument(path) : null;
}

export function onOpenedDocument(callback: (file: OpenedDocument) => void, onError: (error: unknown) => void): () => void {
  let disposed = false;
  let unlisten: UnlistenFn | undefined;
  const consumePending = async () => {
    try {
      const path = await invoke<string | null>('take_pending_document');
      if (path && !disposed) callback(await readDocument(path));
    } catch (error) {
      onError(error);
    }
  };
  void listen('open-document-path', () => { void consumePending(); }).then(stop => {
    if (disposed) stop();
    else {
      unlisten = stop;
      void consumePending();
    }
  });
  return () => { disposed = true; unlisten?.(); };
}
