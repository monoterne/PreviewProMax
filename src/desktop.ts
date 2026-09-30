import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';

export type OpenedDocument = { name: string; path: string; bytes: Uint8Array };
export type SavedTab = { path: string; page: number; zoom: number; rotation: number; fit: boolean; top: number; left: number };
export type SavedWindow = { id: string; tabs: SavedTab[]; active: number; updated: number };
export type SessionInfo = { restore: SavedWindow | null; recent: SavedWindow[] };
export const getSessions = () => invoke<SessionInfo>('get_sessions');
export const saveSession = (session: SavedWindow) => invoke<void>('save_session', { session });
export const archiveSession = () => invoke<void>('archive_session');

export async function readDocument(path: string): Promise<OpenedDocument> {
  const bytes = await invoke<ArrayBuffer>('read_document', { path });
  return { name: path.split(/[\\/]/).pop() || 'Document', path, bytes: new Uint8Array(bytes) };
}
export async function pickDocumentPaths(): Promise<string[]> {
  const paths = await open({ multiple: true, directory: false });
  return paths === null ? [] : typeof paths === 'string' ? [paths] : paths;
}
export const newWindow = () => invoke<string>('new_window');
export const onMenuAction = (callback: (action: string) => void) => listen<string>('menu-action', event => callback(event.payload));
export const closeWindow = () => invoke<void>('close_window');

export function onOpenedDocument(callback: (file: OpenedDocument) => Promise<void>, onError: (error: unknown) => void): () => void {
  let disposed = false;
  let consuming = false;
  let requested = false;
  let unlisten: UnlistenFn | undefined;
  const consumePending = async () => {
    requested = true;
    if (consuming) return;
    consuming = true;
    try {
      while (!disposed && requested) {
        requested = false;
        let path: string | null;
        while (!disposed && (path = await invoke<string | null>('take_pending_document'))) {
          await callback(await readDocument(path));
        }
      }
    } catch (error) { onError(error); }
    finally { consuming = false; }
  };
  void listen('open-document-path', () => { void consumePending(); }).then(stop => {
    if (disposed) stop();
    else { unlisten = stop; void consumePending(); }
  });
  return () => { disposed = true; unlisten?.(); };
}

export const windowReady = (dark: boolean) => invoke<void>('window_ready', { dark });
