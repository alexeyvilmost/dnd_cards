// Read-only local browser check; isolated canonical UI fixture, no gameplay writes.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const base = 'http://127.0.0.1:3001', out = 'outputs/preview-anchor';
await mkdir(out, { recursive: true });
const credentials = JSON.parse(await readFile('outputs/party-maps-254/credentials.json', 'utf8'));
const auth = await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) })).json();
assert(auth.token);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
const errors = [], checks = []; page.on('pageerror', e => errors.push(e.message));
try {
  await page.addInitScript(({ token, user }) => { localStorage.setItem('auth_token', token); localStorage.setItem('user', JSON.stringify(user)); }, auth);
  await page.route('**/api/actions/qa-preview-linked', route => route.fulfill({ json: { id: 'qa-preview-linked', name: 'Вложенное действие', description: 'Содержимое ссылки доступно для изучения.', mechanics: {} } }));
  await page.goto(`${base}/roguelike`);
  await page.evaluate(async () => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const client = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { default: SheetActionLine } = await import('/src/components/SheetActionLine.tsx');
    const { PinModeProvider } = await import('/src/hooks/usePinMode.tsx');
    const host = document.createElement('div'); host.id = 'preview-anchor-qa';
    Object.assign(host.style, { position: 'fixed', inset: '0', background: '#17140f', zIndex: '9000' }); document.body.append(host);
    const root = (client.createRoot ?? client.default.createRoot)(host);
    const action = { id: 'qa-preview-parent', name: 'Тестовое действие', description: 'Изучить [[Вложенное действие|action:qa-preview-linked]].', mechanics: {} };
    window.renderPreviewQA = (x, y, variant = 'icon') => root.render(React.createElement(PinModeProvider, {},
      React.createElement('div', { style: { position: 'absolute', left: x, top: y, width: variant === 'row' ? 300 : 48 } },
        React.createElement(SheetActionLine, { name: action.name, actionRef: action, variant, onActivate: () => {} }))));
    window.renderPreviewQA(100, 100);
  });
  for (const [width, height] of [[1440, 1000], [390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const [x, y] of [[30, 30], [width - 80, 30], [30, height - 85], [width - 80, height - 85]]) {
      await page.mouse.move(width / 2, height / 2);
      await page.evaluate(([x, y]) => window.renderPreviewQA(x, y), [x, y]);
      const trigger = page.locator('#preview-anchor-qa button').first(); const box = await trigger.boundingBox();
      await page.mouse.move(box.x + 4, box.y + 4);
      const preview = page.locator('.forge-effect-popover'); await expect(preview).toBeVisible();
      const before = await preview.boundingBox();
      await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4, { steps: 6 });
      const after = await preview.boundingBox();
      assert.deepEqual(after, before, 'moving within icon must not move preview');
      assert(before.x >= 0 && before.y >= 0 && before.x + before.width <= width + 1 && before.y + before.height <= height + 1, 'viewport fit');
      assert.equal(await preview.evaluate(e => getComputedStyle(e).animationName), 'entity-preview-appear');
      await page.keyboard.press('t');
      await preview.locator('.ft-link').hover();
      const nested = page.locator('.entity-preview-enter').filter({ hasText: 'Содержимое ссылки доступно' });
      await expect(nested).toBeVisible();
      assert.deepEqual(await preview.boundingBox(), before, 'pinned parent stays stationary');
      await nested.hover(); await expect(nested).toBeVisible();
      await page.keyboard.press('Escape'); await expect(preview).toHaveCount(0); await expect(nested).toHaveCount(0);
      checks.push(`${width}x${height}: centre anchor, still preview, nested T link, viewport ${x},${y}`);
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.renderPreviewQA(30, 30, 'row'));
  await page.locator('#preview-anchor-qa button').hover();
  await expect(page.locator('.forge-effect-popover')).toBeVisible();
  assert.equal(await page.locator('.forge-effect-popover').evaluate(e => getComputedStyle(e).animationName), 'none');
  await page.screenshot({ path: `${out}/row-mobile.png` });
  checks.push('row preview; reduced motion');
  // Also exercise the older list implementation on the actual local library.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/?type=feats`);
  await page.getByRole('button', { name: 'Список', exact: true }).click();
  const row = page.locator('button.w-full.text-left.p-3').first();
  await expect(row).toBeVisible(); await row.hover();
  const libraryPreview = page.locator('.fixed.z-50.entity-preview-enter');
  await expect(libraryPreview).toBeVisible();
  await page.waitForTimeout(250); // allow preview images/fonts to settle
  const listBefore = await libraryPreview.boundingBox(), rowBox = await row.boundingBox();
  await page.mouse.move(rowBox.x + rowBox.width - 5, rowBox.y + rowBox.height - 5);
  assert.deepEqual(await libraryPreview.boundingBox(), listBefore, 'library preview does not follow row pointer');
  await page.keyboard.press('t'); await page.mouse.move(10, 10);
  await expect(libraryPreview).toBeVisible(); await page.keyboard.press('Escape'); await expect(libraryPreview).toHaveCount(0);
  checks.push('live library list: initial enter, stationary anchor, T/Escape');
  assert.deepEqual(errors, []); console.log(JSON.stringify({ checks: checks.length, errors }));
} finally { await writeFile(`${out}/acceptance.json`, JSON.stringify({ checks, errors }, null, 2)); await browser.close(); }
