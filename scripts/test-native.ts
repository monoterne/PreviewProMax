import { fixture } from '../tests/fixtures/pdf';
if (process.platform !== 'darwin') throw new Error('This check requires macOS and the Swift command line tools.');
await Bun.write('.tmp/native-fixture.pdf', new Uint8Array(fixture()));
const child = Bun.spawn(['swift', 'tests/native/viewer.swift', '.tmp/native-fixture.pdf', 'target', '72', '1'], { stdout: 'inherit', stderr: 'inherit' });
process.exit(await child.exited);
