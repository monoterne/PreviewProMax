import { test, expect, type Page } from '@playwright/test';
import { fixture } from '../fixtures/pdf';


async function useViewOption(page: Page, selector: string) {
  const panel = page.locator('#view-menu');
  if (!await panel.isVisible()) await page.getByRole('button', { name: 'View options', exact: true }).click();
  await page.locator(selector).click();
  if (await panel.isVisible()) await page.locator('#view-toggle').click();
}

async function screenshotColors(page: Page, screenshot: Buffer) {
  return page.evaluate(async encoded => {
    const image = new Image();
    image.src = `data:image/png;base64,${encoded}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    return {
      corner: Array.from(pixels.slice(0, 3)),
      hasWhiteInk: pixels.some((red, i) => i % 4 === 0 && red >= 250 && pixels[i + 1] >= 250 && pixels[i + 2] >= 250),
    };
  }, screenshot.toString('base64'));
}

async function pageFill(page: Page) {
  const clip = await page.locator('.page-shell').first().evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return { x: Math.round(bounds.left + 8), y: Math.round(bounds.top + 8), width: 2, height: 2 };
  });
  return (await screenshotColors(page, await page.screenshot({ clip }))).corner;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(bytes => {
    // Exercise the compatibility path used by older system webviews.
    (RegExp as any).escape = undefined;
    delete (ReadableStream.prototype as any)[Symbol.asyncIterator];
    (Math as any).sumPrecise = undefined;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        const source = `Math.sumPrecise = undefined; Map.prototype.getOrInsertComputed = undefined; await import(${JSON.stringify(new URL(String(url), location.href).href)});`;
        const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        super(blobUrl, options);
        // The module URL is retained until the first PDF.js message confirms loading.
        this.addEventListener('message', () => URL.revokeObjectURL(blobUrl), { once: true });
      }
    };
    let consumed = false;
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<string, number>();
    const pendingPaths: string[] = [];
    Object.assign(window, {
      __pendingPaths: pendingPaths,
      __emitDesktopEvent(event: string, payload?: unknown) {
        const id = listeners.get(event)!;
        callbacks.get(id)!({ event, id, payload });
      },
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback(callback: (event: unknown) => void) {
          const id = callbacks.size + 1;
          callbacks.set(id, callback);
          return id;
        },
        invoke: async (command: string, args?: any) => {
          if (command === 'plugin:event|listen') { listeners.set(args.event, args.handler); return args.handler; }
          if (command === 'take_pending_document') {
            if (consumed || localStorage.getItem('__skipPending')) return pendingPaths.shift() ?? null;
            consumed = true;
            (window as any).__initialPathTaken = true;
            return 'find-fixture.pdf';
          }
          if (command === 'get_sessions') {
            if (localStorage.getItem('__holdStartup')) await new Promise(resolve => Object.assign(window, { __resumeStartup: resolve }));
            return JSON.parse(localStorage.getItem('__testSessions') || '{"restore":null,"recent":[]}');
          }
          if (command === 'save_session') { (window as any).__savedSession = args?.session; return null; }
          if (command === 'archive_session') return null;
          if (command === 'plugin:dialog|open') return ['second.pdf', 'third.pdf'];
          if (command === 'new_window') { (window as any).__newWindows = ((window as any).__newWindows || 0) + 1; return 'viewer-1'; }
          if (command === 'read_document') {
            if (args.path === 'missing.pdf') throw new Error('File is unavailable');
            return new Uint8Array(bytes);
          }
          return 1;
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
    });
  }, fixture());
  await page.goto('/');
  await expect(page.locator('.page-shell').first()).toHaveAttribute('data-rendered', 'true');
});

test('fit width can resize during the first render without hiding the document', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 1330, height: 850 });
  // Hold text extraction so the first page is still rendering when the window resizes.
  await page.addInitScript(() => {
    const postMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...options) {
      if (message?.action === 'GetTextContent' && message.data.pageIndex === 0) {
        Worker.prototype.postMessage = postMessage;
        Object.assign(window, { resumeText: () => Reflect.apply(postMessage, this, [message, ...options]) });
        return;
      }
      Reflect.apply(postMessage, this, [message, ...options]);
    };
  });
  await page.reload();
  await page.waitForFunction(() => 'resumeText' in window);
  await expect(page.locator('.thumbnail-paper canvas').first()).toBeVisible();
  await expect(page.locator('#zoom-label')).toHaveText('170%');
  const first = page.locator('.page-shell').first();
  await expect(first.locator('canvas')).toBeVisible();
  const bounds = (await first.boundingBox())!;
  const clip = { x: Math.ceil(bounds.x + 30), y: Math.ceil(bounds.y + 60), width: 280, height: 180 };
  expect((await screenshotColors(page, await page.screenshot({ clip }))).hasWhiteInk).toBe(true);
  await page.setViewportSize({ width: 2000, height: 900 });
  await expect(page.locator('#zoom-label')).toHaveText('250%');
  await expect(first).toHaveAttribute('data-rendered-zoom', '2.5');
  await page.evaluate(() => (window as Window & { resumeText(): void }).resumeText());
  await expect(first.locator('canvas')).toBeVisible();
  const text = first.getByText('alpha target', { exact: true });
  expect((await screenshotColors(page, await text.screenshot())).hasWhiteInk).toBe(true);
});

test('document tabs scroll horizontally and keep their controls fully visible', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 640 });
  // Give scrollbars physical space even on a host that uses overlay scrollbars.
  await page.addStyleTag({ content: `
    .document-tab-list { scrollbar-width: auto; }
    .document-tab-list::-webkit-scrollbar { width: 16px; height: 16px; }
  ` });
  const list = page.getByRole('tablist', { name: 'Open documents' });
  for (const extraTabs of [0, 8]) {
    for (let i = 0; i < extraTabs; i++) await page.locator('#new-tab').click();
    const metrics = await list.evaluate(el => ({
      vertical: el.scrollHeight - el.clientHeight,
      horizontal: el.scrollWidth - el.clientWidth,
      tabHeight: el.firstElementChild!.getBoundingClientRect().height,
      availableHeight: el.clientHeight,
    }));
    expect(metrics.vertical).toBe(0);
    expect(metrics.availableHeight).toBeGreaterThanOrEqual(metrics.tabHeight);
    if (extraTabs) expect(metrics.horizontal).toBeGreaterThan(0);
    else expect(metrics.horizontal).toBe(0);
  }
  await list.getByRole('tab').first().press('End');
  await expect(list.getByRole('tab').last()).toBeFocused();
  expect(await list.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
});

test('a PDF opened from Finder at launch stays selected after session restore', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('__holdStartup', 'true');
    localStorage.setItem('__testSessions', JSON.stringify({ recent: [], restore: {
      id: 'previous', active: 0, tabs: [{ path: 'previous.pdf', page: 1, zoom: 1, fit: true, rotation: 0, top: 0, left: 0 }],
    } }));
  });
  await page.reload();
  await page.waitForFunction(() => (window as any).__initialPathTaken && (window as any).__resumeStartup);
  await page.evaluate(() => (window as any).__resumeStartup());
  await expect(page.getByRole('tab', { name: 'previous.pdf' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'find-fixture.pdf' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.page-shell').first().locator('canvas')).toBeVisible();
});

for (const source of ['Finder', 'drop']) {
  test(`a ${source} batch opens every readable PDF in the running window`, async ({ page }) => {
    await page.evaluate(source => {
      const native = window as any;
      const paths = ['first.pdf', 'missing.pdf', 'last.pdf'];
      if (source === 'Finder') {
        native.__pendingPaths.push(...paths);
        native.__emitDesktopEvent('open-document-path');
      } else {
        const payload = { paths, position: { x: 20, y: 20 } };
        native.__emitDesktopEvent('tauri://drag-enter', payload);
        native.__emitDesktopEvent('tauri://drag-drop', payload);
      }
    }, source);
    await expect(page.locator('.document-tab-title')).toHaveText(['find-fixture.pdf', 'first.pdf', 'last.pdf']);
    await expect(page.getByRole('tab', { name: 'last.pdf' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.page-shell').first().locator('canvas')).toBeVisible();
    await expect(page.locator('#drop-overlay')).toBeHidden();
  });
}

test('sidebar and selected thumbnails keep their size when switching tabs', async ({ page }) => {
  const thumbnail = page.locator('.thumbnail-paper').first();
  await expect(thumbnail.locator('canvas')).toBeVisible();
  const before = await thumbnail.boundingBox();
  expect(before!.height).toBeGreaterThan(150);
  await page.getByRole('tab', { name: 'Find', exact: true }).click();
  await page.getByRole('tab', { name: 'Pages', exact: true }).click();
  await expect(thumbnail.locator('canvas')).toBeVisible();
  const after = await thumbnail.boundingBox();
  expect(Math.abs(after!.height - before!.height)).toBeLessThan(1);
  await page.locator('.thumbnail[data-page="4"]').click();
  await expect(page.locator('#page-number')).toHaveValue('4');
  await page.waitForTimeout(350);
  await expect(page.locator('#page-number')).toHaveValue('4');
});

test('pinch and modified mouse wheel zoom the page around the pointer', async ({ page }) => {
  const before = await page.evaluate(() => {
    const shell = document.querySelector('.page-shell')!.getBoundingClientRect();
    return { zoom: document.querySelector('#zoom-label')!.textContent, x: shell.left + shell.width / 2, y: shell.top + shell.height / 3 };
  });
  await page.locator('#viewer').dispatchEvent('wheel', { deltaY: -160, ctrlKey: true, clientX: before.x, clientY: before.y });
  await expect(page.locator('#zoom-label')).not.toHaveText(before.zoom!);
  await expect(page.locator('#fit-width')).not.toHaveClass(/selected/);
  const position = await page.evaluate(({ x, y }) => {
    const shell = document.querySelector('.page-shell')!.getBoundingClientRect();
    return { x: shell.left + shell.width / 2 - x, y: shell.top + shell.height / 3 - y };
  }, before);
  expect(Math.abs(position.x)).toBeLessThan(3);
  expect(Math.abs(position.y)).toBeLessThan(3);

  const wheelZoom = await page.locator('#zoom-label').textContent();
  await page.locator('#viewer').dispatchEvent('wheel', { deltaY: 120, clientX: before.x, clientY: before.y });
  await expect(page.locator('#zoom-label')).toHaveText(wheelZoom!);

  await page.evaluate(({ x, y }) => {
    const viewer = document.querySelector('#viewer')!;
    viewer.dispatchEvent(new Event('gesturestart', { bubbles: true, cancelable: true }));
    const change = new Event('gesturechange', { bubbles: true, cancelable: true });
    Object.assign(change, { scale: 1.5, clientX: x, clientY: y });
    viewer.dispatchEvent(change);
    viewer.dispatchEvent(new Event('gestureend', { bubbles: true, cancelable: true }));
  }, before);
  await expect(page.locator('#zoom-label')).not.toHaveText(wheelZoom!);
});

test('trackpad pinch updates the page continuously before the gesture ends', async ({ page }) => {
  const result = await page.evaluate(() => {
    const viewer = document.querySelector('#viewer')!;
    const pages = document.querySelector<HTMLElement>('#pages')!;
    const shell = document.querySelector<HTMLElement>('.page-shell')!;
    const canvas = shell.querySelector('canvas');
    const rect = shell.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 3;
    const widths = [rect.width];
    viewer.dispatchEvent(new Event('gesturestart', { bubbles: true, cancelable: true }));
    for (const scale of [1.013, 1.027, 1.041]) {
      const change = new Event('gesturechange', { bubbles: true, cancelable: true });
      Object.assign(change, { scale, clientX: x, clientY: y });
      viewer.dispatchEvent(change);
      widths.push(shell.getBoundingClientRect().width);
    }
    const samePage = shell === document.querySelector('.page-shell');
    const sameCanvas = canvas === shell.querySelector('canvas');
    const previewZoom = pages.style.getPropertyValue('--page-preview-scale');
    const previewLabel = document.querySelector('#zoom-label')!.textContent;
    viewer.dispatchEvent(new Event('gestureend', { bubbles: true, cancelable: true }));
    (window as any).__zoomCanvas = canvas;
    return { widths, samePage, sameCanvas, previewZoom, previewLabel,
      previewEnded: pages.dataset.zoomPreview === undefined,
      pageKept: shell === document.querySelector('.page-shell'),
      canvasKept: canvas === shell.querySelector('canvas') && !!canvas?.width,
      loadingShown: !!shell.querySelector('.page-loading') };
  });
  expect(result.widths[1]).toBeGreaterThan(result.widths[0]);
  expect(result.widths[2]).toBeGreaterThan(result.widths[1]);
  expect(result.widths[3]).toBeGreaterThan(result.widths[2]);
  expect(result.samePage && result.sameCanvas).toBe(true);
  expect(result.previewZoom).not.toBe('');
  expect(result.previewEnded).toBe(true);
  expect(result.pageKept && result.canvasKept).toBe(true);
  expect(result.loadingShown).toBe(false);
  await expect(page.locator('#zoom-label')).toHaveText(result.previewLabel!);
  await expect.poll(() => page.evaluate(() => document.querySelector('.page-shell canvas') !== (window as any).__zoomCanvas)).toBe(true);

  // A separate wheel sequence starts after the native pinch's trailing events.
  await page.waitForTimeout(150);
  const wheel = await page.evaluate(() => {
    const viewer = document.querySelector('#viewer')!;
    const shell = document.querySelector<HTMLElement>('.page-shell')!;
    const rect = shell.getBoundingClientRect();
    const widths = [rect.width];
    for (let i = 0; i < 3; i++) {
      viewer.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true,
        deltaY: -4, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 3 }));
      widths.push(shell.getBoundingClientRect().width);
    }
    return { widths, samePage: shell === document.querySelector('.page-shell') };
  });
  expect(wheel.samePage).toBe(true);
  expect(wheel.widths[1]).toBeGreaterThan(wheel.widths[0]);
  expect(wheel.widths[2]).toBeGreaterThan(wheel.widths[1]);
  expect(wheel.widths[3]).toBeGreaterThan(wheel.widths[2]);
  await expect.poll(() => page.locator('#pages').evaluate(el => (el as HTMLElement).dataset.zoomPreview)).toBeUndefined();
});

test('pinching a later page keeps the same document point in place', async ({ page }) => {
  await page.locator('.thumbnail[data-page="12"]').click();
  const shell = page.locator('.page-shell[data-page="12"]');
  await expect(shell.locator('canvas')).toBeVisible();
  const positions = await page.evaluate(() => {
    const viewer = document.querySelector('#viewer')!;
    const shell = document.querySelector<HTMLElement>('.page-shell[data-page="12"]')!;
    const rect = shell.getBoundingClientRect();
    const x = rect.left + rect.width * 0.5;
    const y = rect.top + rect.height * 0.4;
    const offsets: { x: number; y: number; top: number; left: number }[] = [];
    const record = () => {
      const current = shell.getBoundingClientRect();
      offsets.push({ x: current.left + current.width * 0.5 - x, y: current.top + current.height * 0.4 - y,
        top: viewer.scrollTop, left: viewer.scrollLeft });
    };
    viewer.dispatchEvent(new Event('gesturestart', { bubbles: true, cancelable: true }));
    for (const scale of [1.08, 1.16, 1.09, 1.22, 1.19]) {
      const change = new Event('gesturechange', { bubbles: true, cancelable: true });
      Object.assign(change, { scale, clientX: x, clientY: y });
      viewer.dispatchEvent(change);
      record();
    }
    viewer.dispatchEvent(new Event('gestureend', { bubbles: true, cancelable: true }));
    record();
    return { offsets, samePage: shell === document.querySelector('.page-shell[data-page="12"]'),
      canvasVisible: !!shell.querySelector('canvas')?.width };
  });
  expect(positions.samePage && positions.canvasVisible).toBe(true);
  expect(Math.max(...positions.offsets.map(offset => Math.hypot(offset.x, offset.y))), JSON.stringify(positions.offsets)).toBeLessThan(3);
});

test('a second pinch keeps the page visible while the first render finishes', async ({ page }) => {
  const result = await page.evaluate(() => {
    const viewer = document.querySelector('#viewer')!;
    const shell = document.querySelector<HTMLElement>('.page-shell')!;
    const canvas = shell.querySelector('canvas');
    const rect = shell.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 3;
    for (const scale of [1.2, 1.1]) {
      viewer.dispatchEvent(new Event('gesturestart', { bubbles: true, cancelable: true }));
      const change = new Event('gesturechange', { bubbles: true, cancelable: true });
      Object.assign(change, { scale, clientX: x, clientY: y });
      viewer.dispatchEvent(change);
      viewer.dispatchEvent(new Event('gestureend', { bubbles: true, cancelable: true }));
    }
    (window as any).__oldPinchCanvas = canvas;
    return { pageKept: shell === document.querySelector('.page-shell'),
      canvasKept: canvas === shell.querySelector('canvas') && !!canvas?.width,
      zoom: document.querySelector('#zoom-label')!.textContent };
  });
  expect(result.pageKept && result.canvasKept).toBe(true);
  await expect.poll(() => page.evaluate(() => document.querySelector('.page-shell canvas') !== (window as any).__oldPinchCanvas)).toBe(true);
  await expect(page.locator('#zoom-label')).toHaveText(result.zoom!);
});

test('a pinch keeps its original anchor when the reported centroid jitters', async ({ page }) => {
  await page.locator('.thumbnail[data-page="12"]').click();
  await expect(page.locator('.page-shell[data-page="12"] canvas')).toBeVisible();
  const offsets = await page.evaluate(() => {
    const viewer = document.querySelector('#viewer')!;
    const shell = document.querySelector<HTMLElement>('.page-shell[data-page="12"]')!;
    const rect = shell.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height * 0.4;
    const positions: number[] = [];
    viewer.dispatchEvent(new Event('gesturestart', { bubbles: true, cancelable: true }));
    for (const [scale, jitter] of [[1.1, 0], [0.65, 8], [1.25, -6], [1.05, 10]]) {
      const change = new Event('gesturechange', { bubbles: true, cancelable: true });
      Object.assign(change, { scale, clientX: x + jitter, clientY: y - jitter });
      viewer.dispatchEvent(change);
      const current = shell.getBoundingClientRect();
      // Vertical position stays anchored even when the narrow page has no horizontal scroll range.
      positions.push(current.top + current.height * 0.4 - y);
    }
    viewer.dispatchEvent(new Event('gestureend', { bubbles: true, cancelable: true }));
    const final = shell.getBoundingClientRect();
    positions.push(final.top + final.height * 0.4 - y);
    return positions;
  });
  expect(Math.max(...offsets.map(Math.abs)), JSON.stringify(offsets)).toBeLessThan(3);
});

test('pinch end ignores duplicate wheel zoom and ordinary scrolling can resume', async ({ page }) => {
  const result = await page.evaluate(() => {
    const viewer = document.querySelector<HTMLElement>('#viewer')!;
    const shell = document.querySelector<HTMLElement>('.page-shell')!;
    const rect = shell.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 3;
    viewer.dispatchEvent(new Event('gesturestart', { bubbles: true, cancelable: true }));
    const change = new Event('gesturechange', { bubbles: true, cancelable: true });
    Object.assign(change, { scale: 1.2, clientX: x, clientY: y });
    viewer.dispatchEvent(change);
    viewer.dispatchEvent(new Event('gestureend', { bubbles: true, cancelable: true }));
    const label = document.querySelector('#zoom-label')!.textContent;
    viewer.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true,
      deltaY: -20, clientX: x, clientY: y }));
    const ordinary = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 });
    viewer.dispatchEvent(ordinary);
    return { label, finalLabel: document.querySelector('#zoom-label')!.textContent, blocked: ordinary.defaultPrevented };
  });
  expect(result.finalLabel).toBe(result.label);
  expect(result.blocked).toBe(false);
  await page.locator('#viewer').hover();
  const before = await page.locator('#viewer').evaluate(el => el.scrollTop);
  await page.mouse.wheel(0, 220);
  await expect.poll(() => page.locator('#viewer').evaluate(el => el.scrollTop)).toBeGreaterThan(before + 100);
});

test('wheel zoom followed by scrolling does not jump back when its timer ends', async ({ page }) => {
  await page.locator('#viewer').dispatchEvent('wheel', { ctrlKey: true, deltaY: -30, clientX: 600, clientY: 350 });
  const scrolling = await page.evaluate(() => {
    const viewer = document.querySelector<HTMLElement>('#viewer')!;
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 150 });
    viewer.dispatchEvent(wheel);
    viewer.scrollTop += 150;
    return { top: viewer.scrollTop, blocked: wheel.defaultPrevented };
  });
  expect(scrolling.blocked).toBe(false);
  await page.waitForTimeout(500);
  expect(await page.locator('#viewer').evaluate(el => el.scrollTop)).toBeCloseTo(scrolling.top, 0);
});

test('compact toolbar keeps every control inside the window in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 640 });
  const name = 'Research notes with a very long document title and appendix.pdf';
  await page.evaluate(path => {
    localStorage.setItem('__skipPending', 'true');
    localStorage.setItem('__testSessions', JSON.stringify({ restore: {
      id: 'compact-window', active: 0, tabs: [{ path, page: 1, zoom: 1, rotation: 0, fit: true, top: 0, left: 0 }],
    }, recent: [] }));
  }, name);
  await page.reload();
  await expect(page.locator('.page-shell').first()).toHaveAttribute('data-rendered', 'true');
  await page.getByRole('tab', { name, exact: true }).focus();
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await useViewOption(page, '#dark-mode-switch');
    const geometry = await page.evaluate(() => {
      const header = document.querySelector('.toolbar')!.getBoundingClientRect();
      const tabs = document.querySelector('.document-bar')!.getBoundingClientRect();
      const nav = document.querySelector('#navigation')!.getBoundingClientRect();
      const buttons = [...document.querySelectorAll<HTMLElement>('.toolbar button')]
        .filter(button => button.getClientRects().length).map(button => {
          const rect = button.getBoundingClientRect();
          return { name: button.getAttribute('aria-label'), left: rect.left, right: rect.right, bottom: rect.bottom };
        });
      const left = document.querySelector('.toolbar-left')!.getBoundingClientRect();
      const right = document.querySelector('.toolbar-right')!.getBoundingClientRect();
      return { buttons, headerBottom: header.bottom, tabsTop: tabs.top, navBottom: nav.bottom, leftEnd: left.right, navStart: nav.left, navEnd: nav.right, rightStart: right.left };
    });
    for (const control of geometry.buttons) {
      expect(control.left, control.name!).toBeGreaterThanOrEqual(0);
      expect(control.right, control.name!).toBeLessThanOrEqual(760);
      expect(control.bottom, control.name!).toBeLessThanOrEqual(geometry.headerBottom);
    }
    expect(geometry.tabsTop).toBeGreaterThanOrEqual(geometry.navBottom);
    expect(geometry.leftEnd).toBeLessThanOrEqual(geometry.navStart);
    expect(geometry.navEnd).toBeLessThanOrEqual(geometry.rightStart);
    await page.screenshot({ path: `test-results/compact-${theme}.png` });
  }
});

test('view options support keyboard dismissal and keep navigation clear', async ({ page }) => {
  const toggle = page.getByRole('button', { name: 'View options', exact: true });
  await toggle.focus();
  await toggle.press('ArrowDown');
  await expect(page.locator('#rotate')).toBeFocused();
  await page.locator('#rotate').press('Escape');
  await expect(page.locator('#view-menu')).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.press('Enter');
  await page.locator('#rotate').press('Tab');
  await expect(page.locator('#dark-mode-switch')).toBeFocused();
  await page.locator('#dark-mode-switch').press('Tab');
  await expect(page.locator('#view-menu')).toBeHidden();
  await expect(page.locator('#open-button')).toBeFocused();
  await toggle.click();
  await page.getByRole('button', { name: 'Drawing tools', exact: true }).click();
  await expect(page.locator('#view-menu')).toBeHidden();
  await expect(page.locator('#drawing-menu')).toBeVisible();
  await page.getByRole('button', { name: 'Pencil', exact: true }).press('Escape');
  await expect(page.locator('#drawing-menu')).toBeHidden();
  await page.locator('#sidebar-toggle').click();
  await expect(page.locator('#sidebar')).toBeHidden();
  await expect(page.locator('#sidebar-toggle')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#sidebar-toggle').click();
  await expect(page.locator('#sidebar')).toBeVisible();
  await expect(page.locator('.thumbnail.active')).toHaveAttribute('aria-current', 'page');
});

test('open tabs are saved and listed on an empty tab', async ({ page }) => {
  await page.locator('.thumbnail[data-page="4"]').click();
  await page.locator('#zoom-in').click();
  await expect.poll(() => page.evaluate(() => (window as any).__savedSession?.tabs[0]?.page)).toBe(4);
  const saved = await page.evaluate(() => (window as any).__savedSession);
  expect(saved.tabs[0].path).toBe('find-fixture.pdf');
  expect(saved.tabs[0].zoom).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'New tab', exact: true }).click();
  await expect(page.locator('#recent-windows')).toBeVisible();
  await expect(page.locator('.recent-window')).toContainText('find-fixture.pdf');
  await page.screenshot({ path: 'test-results/recent-light.png' });
  await useViewOption(page, '#dark-mode-switch');
  await page.screenshot({ path: 'test-results/recent-dark.png' });
});

test('restores every tab and its active page from a saved window', async ({ page }) => {
  const saved = {
    id: 'previous-window', active: 1, updated: Date.now(), tabs: [
      { path: 'alpha.pdf', page: 5, zoom: 1.5, rotation: 0, fit: false, top: 0, left: 0 },
      { path: 'beta.pdf', page: 9, zoom: 1.45, rotation: 90, fit: false, top: 0, left: 0 },
    ],
  };
  await page.evaluate(session => {
    localStorage.setItem('__skipPending', 'true');
    localStorage.setItem('__testSessions', JSON.stringify({ restore: session, recent: [session] }));
  }, saved);
  await page.reload();
  await expect(page.getByRole('tab', { name: 'alpha.pdf' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'beta.pdf' })).toBeVisible();
  await expect(page.locator('#page-number')).toHaveValue('9');
  await expect(page.locator('#zoom-label')).toHaveText('145%');
  await page.getByRole('tab', { name: 'alpha.pdf' }).click();
  await expect(page.locator('#page-number')).toHaveValue('5');
  await expect(page.locator('#zoom-label')).toHaveText('150%');
  await page.getByRole('button', { name: 'New tab', exact: true }).click();
  await expect(page.locator('#recent-windows')).toBeVisible();
  await page.locator('.recent-window').first().click();
  await expect(page.locator('.document-tab')).toHaveCount(4);
});

test('find lists all matches and highlights the actual PDF glyphs at the correct scale', async ({ page }) => {
  await page.locator('#search-toggle').click();
  await page.locator('#search-input').fill('target');
  await expect(page.locator('.search-result')).toHaveCount(72);
  expect((await page.locator('#search-input').boundingBox())!.height).toBeGreaterThanOrEqual(32);
  const metrics = await page.locator('.page-shell').first().locator('.textLayer span[role="presentation"]').first().evaluate(el => ({
    font: parseFloat(getComputedStyle(el).fontSize),
    expected: parseFloat((el as HTMLElement).style.getPropertyValue('--font-height')) * parseFloat(getComputedStyle(el.closest('.textLayer')!).getPropertyValue('--scale-factor')),
  }));
  expect(metrics.font).toBeCloseTo(metrics.expected, 1);
  await page.locator('.search-result').nth(61).click();
  await expect(page.locator('#page-number')).toHaveValue('21');
  await expect(page.locator('.page-shell[data-page="21"] .search-match.selected')).toHaveText('target');
  await page.locator('#search-input').press('Enter');
  await expect(page.locator('.search-result.active')).toHaveAttribute('data-index', '62');
  await page.screenshot({ path: 'test-results/find-light.png' });
  await useViewOption(page, '#dark-mode-switch');
  await page.screenshot({ path: 'test-results/find-dark.png' });
});

test('a phrase across PDF lines uses the same occurrence in the list and on the page', async ({ page }) => {
  await page.locator('#search-toggle').click();
  await page.locator('#search-input').fill('split target');
  await expect(page.locator('.search-result')).toHaveCount(24);
  await page.locator('.search-result').first().click();
  const marks = page.locator('.page-shell[data-page="1"] .search-match.selected');
  await expect(marks).toHaveCount(2);
  await expect(marks).toHaveText(['split', 'target']);
});

test('tabs restore page and find state while releasing inactive page canvases', async ({ page }) => {
  await page.locator('#search-toggle').click();
  await page.locator('#search-input').fill('target');
  await expect(page.locator('.search-result')).toHaveCount(72);
  await page.locator('.search-result').nth(31).click();
  await expect(page.locator('#page-number')).toHaveValue('11');
  await page.locator('#open-button').click();
  await expect(page.getByRole('tab', { name: 'third.pdf', exact: true })).toBeVisible();
  await expect(page.locator('.document-tab')).toHaveCount(3);
  await expect(page.locator('#search-input')).toHaveValue('');
  await page.getByRole('tab', { name: 'find-fixture.pdf', exact: true }).click();
  await expect(page.locator('#search-input')).toHaveValue('target');
  await expect(page.locator('.search-result')).toHaveCount(72);
  await expect(page.locator('.search-result.active')).toHaveAttribute('data-index', '31');
  await expect(page.locator('#page-number')).toHaveValue('11');
  await expect(page.locator('.page-shell[data-page="11"] canvas')).toBeVisible();
  expect(await page.locator('.page-shell canvas').count()).toBeLessThan(8);
  await page.getByRole('button', { name: 'Close second.pdf', exact: true }).click();
  await expect(page.locator('.document-tab')).toHaveCount(2);
  await page.locator('#new-window').click();
  expect(await page.evaluate(() => (window as any).__newWindows)).toBe(1);
});

test('system theme is the default and image inversion survives a new launch', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('#dark-mode-switch')).toHaveAttribute('data-state', 'checked');
  await useViewOption(page, '#invert-images-switch');
  await expect(page.locator('html')).toHaveAttribute('data-invert-images', 'false');
  await page.reload();
  await expect(page.locator('#dark-mode-switch')).toHaveAttribute('data-state', 'checked');
  await expect(page.locator('#invert-images-switch')).toHaveAttribute('data-state', 'unchecked');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('#dark-mode-switch')).toHaveAttribute('data-state', 'unchecked');
  await expect(page.locator('#invert-images-switch')).toHaveCount(0);
});

test('dark pages and thumbnails use the ui tint and white text', async ({ page }) => {
  await useViewOption(page, '#dark-mode-switch');
  await useViewOption(page, '#invert-images-switch');
  await expect(page.locator('html')).toHaveAttribute('data-invert-images', 'false');
  await expect(page.locator('.page-shell').first()).toHaveAttribute('data-rendered', 'true');
  await expect(page.locator('.thumbnail-paper canvas').first()).toBeVisible();

  const colors = await page.evaluate(() => {
    const pageCanvas = document.querySelector<HTMLCanvasElement>('.page-shell canvas')!;
    const thumbCanvas = document.querySelector<HTMLCanvasElement>('.thumbnail-paper canvas')!;
    const pageColor = getComputedStyle(document.documentElement).getPropertyValue('--page').trim();
    const corner = (canvas: HTMLCanvasElement) => Array.from(canvas.getContext('2d')!.getImageData(canvas.width - 2, canvas.height - 2, 1, 1).data).slice(0, 3);
    const pixels = pageCanvas.getContext('2d')!.getImageData(0, 0, pageCanvas.width, Math.ceil(pageCanvas.height * .25)).data;
    let hasWhiteText = false;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] >= 250 && pixels[index + 1] >= 250 && pixels[index + 2] >= 250) { hasWhiteText = true; break; }
    }
    return { pageColor, pageCorner: corner(pageCanvas), thumbCorner: corner(thumbCanvas), hasWhiteText };
  });
  const background = [1, 3, 5].map(index => parseInt(colors.pageColor.slice(index, index + 2), 16));
  expect(colors.pageCorner).toEqual(background);
  expect(colors.thumbCorner).toEqual(background);
  expect(colors.hasWhiteText).toBe(true);
  await page.screenshot({ path: 'test-results/dark-preserve.png' });
});

test('dark page fill stays consistent across zoom compositing and raster replacement', async ({ page }) => {
  await useViewOption(page, '#dark-mode-switch');
  for (const preserveImages of [false, true]) {
    if (preserveImages) await useViewOption(page, '#invert-images-switch');
    const shell = page.locator('.page-shell').first();
    await expect(shell).toHaveAttribute('data-rendered', 'true');
    const baseline = await pageFill(page);
    expect(baseline).toEqual([35, 36, 40]);
    // A retained raster enters a separate compositing group while it scales.
    // Hold that state so screenshots cannot miss a brief flash before replacement.
    await shell.locator('.page-content').evaluate(element => {
      (element as HTMLElement).style.transform = 'scale(1.04)';
    });
    expect(await pageFill(page)).toEqual(baseline);
    await shell.locator('.page-content').evaluate(element => {
      (element as HTMLElement).style.transform = '';
    });
    await page.evaluate(() => {
      const viewer = document.querySelector('#viewer')!;
      const shell = document.querySelector('.page-shell')!;
      const bounds = shell.getBoundingClientRect();
      (window as any).__fillCanvas = shell.querySelector('canvas');
      viewer.dispatchEvent(new Event('gesturestart', { bubbles: true, cancelable: true }));
      const change = new Event('gesturechange', { bubbles: true, cancelable: true });
      Object.assign(change, { scale: 1.04, clientX: bounds.left + bounds.width / 2, clientY: bounds.top + 20 });
      viewer.dispatchEvent(change);
    });
    expect(await pageFill(page)).toEqual(baseline);
    await page.locator('#viewer').dispatchEvent('gestureend');
    await expect.poll(() => page.evaluate(() => document.querySelector('.page-shell canvas') !== (window as any).__fillCanvas)).toBe(true);
    expect(await pageFill(page)).toEqual(baseline);
  }
});

test('a replaced query cannot leave stale results or navigate to the previous query', async ({ page }) => {
  await page.locator('#search-toggle').click();
  await page.locator('#search-input').fill('target');
  await expect(page.locator('.search-result')).toHaveCount(72);
  await page.locator('#search-input').fill('beta');
  await page.locator('#search-input').press('Enter');
  await expect(page.locator('.search-result')).toHaveCount(24);
  await page.locator('#search-input').press('Enter');
  await expect(page.locator('.search-result.active')).toHaveAttribute('data-index', '0');
  await expect(page.locator('.search-match.selected')).toHaveText('beta');
});

test('a page selection cancels pending match navigation without jumping back', async ({ page }) => {
  await page.locator('#search-toggle').click();
  await page.locator('#search-input').fill('target');
  await expect(page.locator('.search-result')).toHaveCount(72);
  await page.evaluate(() => {
    (document.querySelectorAll('.search-result')[61] as HTMLElement).click();
    (document.querySelector('#page-number') as HTMLInputElement).value = '1';
    document.querySelector('#page-number')!.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(500);
  await expect(page.locator('#page-number')).toHaveValue('1');
  expect(await page.locator('#viewer').evaluate(el => el.scrollTop)).toBeLessThan(40);
});

test('find highlights remain inside the PDF after rotation and zoom', async ({ page }) => {
  await useViewOption(page, '#rotate');
  await page.locator('#zoom-in').click();
  await page.locator('#search-toggle').click();
  await page.locator('#search-input').fill('beta');
  await expect(page.locator('.search-result')).toHaveCount(24);
  await page.locator('.search-result').nth(10).click();
  const shell = page.locator('.page-shell[data-page="11"]');
  await expect(shell.locator('.search-match.selected')).toHaveText('beta');
  // Read both rectangles in one frame: result navigation can scroll between
  // separate browser round trips, especially on a Windows CI runner.
  const geometry = await shell.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const mark = element.querySelector('.search-match.selected')!.getBoundingClientRect();
    return { left: mark.left - bounds.left, top: mark.top - bounds.top,
      right: bounds.right - mark.right, bottom: bounds.bottom - mark.bottom };
  });
  for (const inset of Object.values(geometry)) expect(inset).toBeGreaterThanOrEqual(0);
});

test('scrolling through a long document keeps retained page canvases bounded', async ({ page }) => {
  for (const number of [5, 10, 15, 20, 24, 1]) {
    await page.locator('#page-number').fill(String(number));
    await page.locator('#page-number').press('Enter');
    await expect(page.locator(`.page-shell[data-page="${number}"] canvas`)).toBeVisible();
    await expect.poll(() => page.locator('.page-shell canvas').count()).toBeLessThan(8);
  }
});

test('selected text markup survives a page rerender and reload', async ({ page }) => {
  await page.locator('.page-shell[data-page="1"] .textLayer span').first().evaluate(span => {
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    span.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Markup selected text' }).click();
  await page.getByRole('button', { name: 'Highlight green' }).click();
  await expect(page.locator('.page-shell[data-page="1"] .markup-mark.markup-green').first()).toBeVisible();
  await page.reload();
  await expect(page.locator('.page-shell[data-page="1"] .markup-mark.markup-green').first()).toBeVisible();
});

test('pencil and shapes persist and the eraser removes a drawing', async ({ page }) => {
  const choose = async (name: string) => {
    await page.getByRole('button', { name: /Drawing tools/ }).click();
    await page.getByRole('button', { name, exact: true }).click();
  };
  const draw = async (startX: number, startY: number, endX: number, endY: number) => {
    const bounds = (await page.locator('.page-shell[data-page="1"] .drawing-layer').boundingBox())!;
    await page.mouse.move(bounds.x + startX, bounds.y + startY);
    await page.mouse.down();
    await page.mouse.move(bounds.x + endX, bounds.y + endY, { steps: 5 });
    await page.mouse.up();
  };
  await choose('Pencil');
  await draw(40, 40, 110, 80);
  await choose('Rectangle');
  await draw(140, 50, 230, 120);
  await choose('Circle');
  await draw(250, 50, 330, 130);
  await expect(page.locator('.page-shell[data-page="1"] .drawing-layer [data-drawing-id]')).toHaveCount(3);
  await useViewOption(page, '#rotate');
  await expect(page.locator('.page-shell[data-page="1"] .drawing-layer [data-drawing-id]')).toHaveCount(3);
  await page.reload();
  await expect(page.locator('.page-shell[data-page="1"] .drawing-layer [data-drawing-id]')).toHaveCount(3);
  await choose('Eraser');
  await page.locator('.page-shell[data-page="1"] rect.drawing-hit').click();
  await expect(page.locator('.page-shell[data-page="1"] .drawing-layer [data-drawing-id]')).toHaveCount(2);
});


test('typing still lists and highlights matches after repeatedly switching sidebar views and documents', async ({ page }) => {
  await page.locator('#open-button').click();
  for (const name of ['find-fixture.pdf', 'third.pdf', 'second.pdf']) {
    await page.getByRole('tab', { name, exact: true }).click();
    await page.getByRole('tab', { name: 'Find', exact: true }).click();
    await page.getByRole('tab', { name: 'Pages', exact: true }).click();
    await page.getByRole('tab', { name: 'Find', exact: true }).click();
    await page.locator('#search-input').pressSequentially('target', { delay: 30 });
    await expect(page.locator('.search-result')).toHaveCount(72);
    await expect(page.locator('.page-shell').first().locator('.search-match')).toHaveCount(3);
  }
});

test('PDF.js finds words hyphenated across lines and highlights both source pieces', async ({ page }) => {
  await page.getByRole('tab', { name: 'Find', exact: true }).click();
  await page.locator('#search-input').fill('international');
  await expect(page.locator('.search-result')).toHaveCount(24);
  await page.locator('.search-result').first().click();
  await expect(page.locator('.search-match.selected')).toHaveText(['inter-', 'national']);
  await page.locator('#search-input').fill('no-such-word');
  await expect(page.locator('#search-status')).toHaveText('No matches found');
  await expect(page.locator('.search-match')).toHaveCount(0);
});

test('contents supports nested entries, named destinations, and keyboard toggles', async ({ page }) => {
  await page.getByRole('tab', { name: 'Contents', exact: true }).click();
  await page.getByRole('button', { name: 'Chapter one', exact: true }).click();
  await expect(page.locator('#page-number')).toHaveValue('5');
  await page.getByRole('button', { name: 'Collapse Chapter one' }).click();
  await expect(page.getByRole('button', { name: 'Section two', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Expand Chapter one' }).press('Enter');
  await page.getByRole('button', { name: 'Section two', exact: true }).click();
  await expect(page.locator('#page-number')).toHaveValue('12');
});

test('links printed in the PDF navigate to internal destinations', async ({ page }) => {
  const links = page.locator('.page-shell[data-page="1"] .page-link');
  await expect(links).toHaveCount(2);
  await expect(page.locator('.page-shell[data-page="1"] .page-link[target="_blank"]')).toHaveAttribute('href', 'https://example.org/');
  await page.locator('.page-shell[data-page="1"] .page-link[href="#"]').click();
  await expect(page.locator('#page-number')).toHaveValue('12');
});


test('embedded CFF fonts load when the system webview lacks Math.sumPrecise', async ({ page }) => {
  await expect.poll(() => page.evaluate(() => Array.from(document.fonts).filter(font => font.family.startsWith('g_') && font.status === 'loaded').length)).toBeGreaterThan(0);
  await page.getByRole('tab', { name: 'Find', exact: true }).click();
  await page.locator('#search-input').fill('alpha');
  await expect(page.locator('.search-result')).toHaveCount(24);
  await expect(page.locator('.page-shell').first().locator('.search-match')).toHaveText('alpha');
});


test('text extraction errors are reported instead of claiming there are no matches', async ({ page }) => {
  // Fail extraction on one offscreen page while the other pages still have matches.
  await page.evaluate(() => {
    const postMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...options) {
      if (message?.action === 'GetTextContent' && message.data.pageIndex === 10) {
        throw new Error('Unable to read fixture page text.');
      }
      Reflect.apply(postMessage, this, [message, ...options]);
    };
  });
  await page.getByRole('tab', { name: 'Find', exact: true }).click();
  await page.locator('#search-input').fill('target');
  await expect(page.locator('#search-status')).toHaveText('Unable to search this document.');
  await page.getByRole('button', { name: 'New tab', exact: true }).click();
  await page.getByRole('tab', { name: 'find-fixture.pdf' }).click();
  await expect(page.locator('#search-status')).toHaveText('Unable to search this document.');
  await expect(page.locator('.search-result')).toHaveCount(0);
});
