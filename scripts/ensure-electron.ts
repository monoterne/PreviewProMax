import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadArtifact } from '@electron/get';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const electronRoot = path.join(projectRoot, 'node_modules', 'electron');
const packageJson = JSON.parse(await readFile(path.join(electronRoot, 'package.json'), 'utf8')) as { version: string };
const binaryPath = process.platform === 'darwin'
  ? 'Electron.app/Contents/MacOS/Electron'
  : process.platform === 'win32' ? 'electron.exe' : 'electron';
const distPath = path.join(electronRoot, 'dist');
if (!existsSync(path.join(distPath, binaryPath))) {
  console.log('Downloading Electron runtime…');
  const archive = await downloadArtifact({
    version: packageJson.version,
    artifactName: 'electron',
    platform: process.platform,
    arch: process.arch
  });
  await mkdir(distPath, { recursive: true });
  if (process.platform === 'win32') {
    const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;
    execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `Expand-Archive -LiteralPath ${psQuote(archive)} -DestinationPath ${psQuote(distPath)} -Force`], { stdio: 'inherit' });
  } else {
    execFileSync('unzip', ['-oq', archive, '-d', distPath], { stdio: 'inherit' });
  }
}
await writeFile(path.join(electronRoot, 'path.txt'), binaryPath);
