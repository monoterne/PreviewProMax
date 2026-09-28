import { app, BrowserWindow, dialog, ipcMain, Menu, type MenuItemConstructorOptions } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;
let queuedPath: string | null = null;

function isPdfPath(filePath: unknown): filePath is string {
  return typeof filePath === 'string' && path.extname(filePath).toLowerCase() === '.pdf';
}

async function readPdf(filePath: string) {
  if (!isPdfPath(filePath)) throw new Error('Please choose a PDF file.');
  const bytes = await fs.readFile(filePath);
  return { name: path.basename(filePath), bytes: new Uint8Array(bytes) };
}

async function openPath(filePath: string) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    queuedPath = filePath;
    return;
  }
  try {
    mainWindow.webContents.send('document:opened', await readPdf(filePath));
  } catch (error) {
    dialog.showErrorBox('Unable to open PDF', error instanceof Error ? error.message : String(error));
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#151820',
    title: 'Preview Pro Max',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' } : {}),
    webPreferences: {
      preload: path.join(app.getAppPath(), 'electron/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else if (!app.isPackaged && process.env.npm_lifecycle_event === 'dev') {
    mainWindow.loadURL('http://127.0.0.1:5173');
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), 'dist/index.html'));
  }
  mainWindow.webContents.once('did-finish-load', () => {
    if (queuedPath) {
      const filePath = queuedPath;
      queuedPath = null;
      openPath(filePath);
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    const filePath = argv.find(isPdfPath);
    if (filePath) openPath(filePath);
  });
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    openPath(filePath);
  });
  app.whenReady().then(() => {
    const initialPath = process.argv.find(isPdfPath);
    if (initialPath) queuedPath = initialPath;
    createWindow();
    const appMenu: MenuItemConstructorOptions[] = process.platform === 'darwin' ? [{ role: 'appMenu' }] : [];
    const template: MenuItemConstructorOptions[] = [
      ...appMenu,
      { label: 'File', submenu: [
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => mainWindow?.webContents.send('action:open') },
        { role: 'close' }
      ] },
      { label: 'View', submenu: [
        { label: 'Find', accelerator: 'CmdOrCtrl+F', click: () => mainWindow?.webContents.send('action:find') },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => mainWindow?.webContents.send('action:zoom-in') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => mainWindow?.webContents.send('action:zoom-out') },
        { role: 'togglefullscreen' }
      ] },
      { role: 'windowMenu' }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

ipcMain.handle('dialog:open-pdf', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [{ name: 'PDF documents', extensions: ['pdf'] }]
  });
  if (canceled || !filePaths.length) return null;
  return readPdf(filePaths[0]);
});
