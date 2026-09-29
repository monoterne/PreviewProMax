import { test, expect } from '@playwright/test';

// Different page sizes, split text items, and enough results to overflow the sidebar.
function fixture() {
  const objects = ['', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids: number[] = [];
  for (let page = 1; page <= 24; page++) {
    const content = `BT /F1 20 Tf 32 720 Td (Page ${page}) Tj 0 -40 Td (alpha target) Tj 0 -40 Td (beta target) Tj 0 -40 Td (split) Tj 0 -28 Td (target) Tj 0 -40 Td (inter-) Tj 0 -28 Td (national) Tj ET`;
    const stream = objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`) - 1;
    kids.push(objects.push(`<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${page % 2 ? 612 : 500} 792] /Resources << /Font << /F1 1 0 R >> >> /Contents ${stream} 0 R >>`) - 1);
  }
  const pages = objects.push(`<< /Type /Pages /Kids [${kids.map(n => `${n} 0 R`).join(' ')}] /Count ${kids.length} >>`) - 1;
  for (const kid of kids) objects[kid] = objects[kid].replace('/Parent 0 0 R', `/Parent ${pages} 0 R`);
  const outlineRoot = objects.length;
  objects.push(`<< /Type /Outlines /First ${outlineRoot + 1} 0 R /Last ${outlineRoot + 1} 0 R /Count 2 >>`);
  objects.push(`<< /Title (Chapter one) /Parent ${outlineRoot} 0 R /Dest [${kids[4]} 0 R /Fit] /First ${outlineRoot + 2} 0 R /Last ${outlineRoot + 2} 0 R /Count 1 >>`);
  objects.push(`<< /Title (Section two) /Parent ${outlineRoot + 1} 0 R /Dest (section-two) >>`);
  const root = objects.push(`<< /Type /Catalog /Pages ${pages} 0 R /Outlines ${outlineRoot} 0 R /Names << /Dests << /Names [(section-two) [${kids[11]} 0 R /Fit]] >> >> >>`) - 1;
  let data = '%PDF-1.4\n'; const offsets = [0];
  for (let i = 1; i < objects.length; i++) { offsets.push(data.length); data += `${i} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = data.length;
  data += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) data += `${String(offset).padStart(10, '0')} 00000 n \n`;
  data += `trailer\n<< /Size ${objects.length} /Root ${root} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return [...new TextEncoder().encode(data)];
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(bytes => {
    // Exercise the compatibility path used by older system webviews.
    (RegExp as any).escape = undefined;
    let consumed = false;
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: () => 1,
        invoke: async (command: string) => {
          if (command === 'take_pending_document') { if (consumed) return null; consumed = true; return 'find-fixture.pdf'; }
          if (command === 'plugin:dialog|open') return ['second.pdf', 'third.pdf'];
          if (command === 'new_window') { (window as any).__newWindows = ((window as any).__newWindows || 0) + 1; return 'viewer-1'; }
          if (command === 'read_document') return new Uint8Array(bytes);
          return 1;
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
    });
  }, fixture());
  await page.goto('/');
  await expect(page.locator('.page-shell').first()).toHaveAttribute('data-rendered', 'true');
});

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
  await page.locator('#dark-mode-switch').click();
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
  await page.locator('#invert-images-switch').click();
  await expect(page.locator('html')).toHaveAttribute('data-invert-images', 'false');
  await page.reload();
  await expect(page.locator('#dark-mode-switch')).toHaveAttribute('data-state', 'checked');
  await expect(page.locator('#invert-images-switch')).toHaveAttribute('data-state', 'unchecked');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('#dark-mode-switch')).toHaveAttribute('data-state', 'unchecked');
  await expect(page.locator('#invert-images-switch')).toHaveCount(0);
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
  await page.locator('#rotate').click();
  await page.locator('#zoom-in').click();
  await page.locator('#search-toggle').click();
  await page.locator('#search-input').fill('beta');
  await expect(page.locator('.search-result')).toHaveCount(24);
  await page.locator('.search-result').nth(10).click();
  const shell = page.locator('.page-shell[data-page="11"]');
  await expect(shell.locator('.search-match.selected')).toHaveText('beta');
  const bounds = await shell.boundingBox();
  const mark = await shell.locator('.search-match.selected').boundingBox();
  expect(mark!.x).toBeGreaterThanOrEqual(bounds!.x);
  expect(mark!.y).toBeGreaterThanOrEqual(bounds!.y);
  expect(mark!.x + mark!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
  expect(mark!.y + mark!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height);
});

test('scrolling through a long document keeps retained page canvases bounded', async ({ page }) => {
  for (const number of [5, 10, 15, 20, 24, 1]) {
    await page.locator('#page-number').fill(String(number));
    await page.locator('#page-number').press('Enter');
    await expect(page.locator(`.page-shell[data-page="${number}"] canvas`)).toBeVisible();
    await expect.poll(() => page.locator('.page-shell canvas').count()).toBeLessThan(8);
  }
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
