import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Original vector artwork. Keep each material separate for Icon Composer.
const root = resolve(import.meta.dirname, "..");
const icons = resolve(root, "src-tauri/icons");
const source = resolve(icons, "PreviewProMax.icon");
await mkdir(resolve(source, "Assets"), { recursive: true });
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${body}</svg>\n`;
const paper = (dark = false) => `<g transform="rotate(10 517 464)">
  <rect x="308" y="174" width="418" height="570" rx="24" fill="${dark ? "#4b596a" : "#f9fbff"}"/>
  <path d="M365 253h245M365 292h190" stroke="${dark ? "#8598b1" : "#b8c8da"}" stroke-width="13" stroke-linecap="round"/>
</g>`;
const frame = `<g transform="rotate(-9 451 504)"><rect x="164" y="310" width="578" height="406" rx="25" fill="#f8fbff"/></g>`;
const landscape = `<defs>
  <linearGradient id="sky" x2="0" y2="1"><stop stop-color="#4f9fe9"/><stop offset="1" stop-color="#c2e6fb"/></linearGradient>
  <linearGradient id="near" x2="0" y2="1"><stop stop-color="#237db5"/><stop offset="1" stop-color="#104a84"/></linearGradient>
  <clipPath id="picture"><rect x="187" y="333" width="532" height="339" rx="8"/></clipPath>
</defs><g transform="rotate(-9 451 504)"><g clip-path="url(#picture)">
  <path fill="url(#sky)" d="M187 333h532v339H187z"/>
  <circle cx="607" cy="407" r="32" fill="#f4faff"/>
  <path d="M170 598 359 393 524 594 625 475 744 613v80H170Z" fill="#80bade"/>
  <path d="m302 455 57-62 58 71-56-19-27 20Z" fill="#eef8ff"/>
  <path d="M154 668 332 522 459 618 571 521 761 680v37H154Z" fill="url(#near)"/>
  <path d="M187 644q117-33 239 7t293-1v48H187Z" fill="#143e68"/>
</g></g>`;
const handle = `<defs><linearGradient id="handle" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#485365"/><stop offset=".45" stop-color="#232e40"/><stop offset="1" stop-color="#111a28"/></linearGradient></defs>
  <path d="m751 716 92 97" stroke="#c3d5e8" stroke-width="62" stroke-linecap="round"/>
  <path d="m763 728 81 86" stroke="url(#handle)" stroke-width="49" stroke-linecap="round"/>`;
const lens = `<defs><linearGradient id="rim" x2=".8" y2="1"><stop stop-color="#fff"/><stop offset=".3" stop-color="#e7f1fa"/><stop offset=".52" stop-color="#819bb7"/><stop offset=".75" stop-color="#e0eaf6"/><stop offset="1" stop-color="#a0b5cd"/></linearGradient><linearGradient id="lens" x2=".7" y2="1"><stop stop-color="#e6f8ff" stop-opacity=".52"/><stop offset="1" stop-color="#70c3f2" stop-opacity=".2"/></linearGradient></defs>
  <circle cx="651" cy="607" r="144" fill="url(#lens)" stroke="url(#rim)" stroke-width="26"/>
  <circle cx="651" cy="607" r="130" fill="none" stroke="#29496b" stroke-opacity=".55" stroke-width="4"/>
  <path d="M551 583a105 105 0 0 1 86-80" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="9" stroke-linecap="round"/>`;
const assets: Record<string, string> = {
  "paper.svg": paper(), "paper-dark.svg": paper(true),
  "frame.svg": frame, "landscape.svg": landscape,
  "handle.svg": handle, "lens.svg": lens,
};
for (const [name, body] of Object.entries(assets)) await writeFile(resolve(source, "Assets", name), svg(body));
const layer = (name: string, image: string, glass: boolean, extra = {}) => ({ name, "image-name": image, glass, ...extra });
const group = (name: string, layers: object[], translucency = 0) => ({
  name, layers, lighting: "individual", "blur-material": 0,
  shadow: { kind: "neutral", opacity: 0.25 },
  translucency: { enabled: translucency > 0, value: translucency },
});
await writeFile(resolve(source, "icon.json"), JSON.stringify({
  fill: { "linear-gradient": ["srgb:0.94,0.97,1,1", "srgb:0.76,0.84,0.93,1"] },
  "fill-specializations": [{ appearance: "dark", value: "system-dark" }],
  groups: [
    group("Magnifier", [layer("Glass lens", "lens.svg", true), layer("Handle", "handle.svg", false)], 0.12),
    group("Landscape", [layer("Blue mountains", "landscape.svg", false), layer("Photo frame", "frame.svg", true, {
      "fill-specializations": [{ appearance: "dark", value: { solid: "srgb:0.31,0.39,0.49,1" } }],
    })]),
    group("Document", [layer("Document", "paper.svg", true, {
      "image-name-specializations": [{ appearance: "dark", value: "paper-dark.svg" }],
      "fill-specializations": [{ appearance: "dark", value: { solid: "srgb:0.24,0.31,0.4,1" } }],
    })]),
  ],
  "supported-platforms": { squares: "shared" },
}, null, 2) + "\n");

// Conventional neutral icon for Windows and macOS before 26.
// The glass material is flattened; the silhouette stays identical.
const fallback = (dark: boolean) => svg(`<defs>
  <linearGradient id="base" x2="0" y2="1"><stop stop-color="${dark ? "#303f52" : "#f4f9ff"}"/><stop offset="1" stop-color="${dark ? "#172334" : "#c5d7eb"}"/></linearGradient>
  <filter id="shadow" x="-.3" y="-.3" width="1.6" height="1.6"><feDropShadow dx="0" dy="12" stdDeviation="12" flood-color="#102541" flood-opacity=".22"/></filter>
</defs><rect x="100" y="100" width="824" height="824" rx="184" fill="url(#base)"/>
<rect x="102" y="102" width="820" height="820" rx="182" fill="none" stroke="${dark ? "#7692b0" : "white"}" stroke-opacity=".5" stroke-width="3"/>
<g filter="url(#shadow)">${paper(dark)}${dark ? frame.replace("#f8fbff", "#6a809a") : frame}${landscape}</g>
<g filter="url(#shadow)">${handle}${lens}</g>`);
await writeFile(resolve(root, "src-tauri/icon.svg"), fallback(false));
await writeFile(resolve(icons, "icon-dark.svg"), fallback(true));
const temporary = resolve(root, ".tmp/generated-icons");
const generated = Bun.spawn(["bun", "tauri", "icon", "src-tauri/icon.svg", "--output", temporary], { cwd: root, stdout: "inherit", stderr: "inherit" });
if (await generated.exited !== 0) throw new Error("Icon generation failed");
for (const name of ["32x32.png", "128x128.png", "128x128@2x.png", "icon.icns", "icon.ico"])
  await copyFile(resolve(temporary, name), resolve(icons, name));
// Keep a high resolution preview alongside the editable source.
const preview = Bun.spawn(["bun", "tauri", "icon", "src-tauri/icon.svg", "--output", temporary, "--png", "1024"], { cwd: root, stdout: "inherit", stderr: "inherit" });
if (await preview.exited !== 0) throw new Error("Icon preview generation failed");
await copyFile(resolve(temporary, "1024x1024.png"), resolve(icons, "icon.png"));
console.log("Generated layered source and desktop fallbacks.");
