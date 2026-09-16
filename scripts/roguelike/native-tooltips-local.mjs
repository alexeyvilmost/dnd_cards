// Read-only route/UI checks against local QA-owned sheets and battles.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const base = 'http://127.0.0.1:3001', out = 'outputs/native-tooltips';
await mkdir(out, { recursive: true });
const credentials = JSON.parse(await readFile('outputs/party-maps-254/credentials.json', 'utf8'));
const auth = await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) })).json(); assert(auth.token);
const builds = JSON.parse(await readFile('outputs/martial-classes-256/builds.json', 'utf8'));
const character = builds.find(b => b.card === 'CLASS-monk' && b.level === 3).character;
const party = JSON.parse(await readFile('outputs/martial-classes-256/mixed-party.json', 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
const errors = [], checks = []; page.on('pageerror', e => errors.push(e.message));
const noTitles = async label => {
  const native = await page.locator('body [title]').evaluateAll(nodes => nodes.map(e => ({ tag: e.tagName, title: e.getAttribute('title') })));
  assert.deepEqual(native, [], label);
  assert(await page.title(), 'document title must remain'); checks.push(label);
};
try {
  await page.addInitScript(({ token, user }) => { localStorage.setItem('auth_token', token); localStorage.setItem('user', JSON.stringify(user)); localStorage.setItem('boh:mobile-suggestion-dismissed', '1'); }, auth);
  await page.goto(`${base}/?type=feats`);
  await page.getByRole('button', { name: 'Список', exact: true }).click();
  const row = page.locator('button.w-full.text-left.p-3').first(); await expect(row).toBeVisible(); await row.hover();
  await expect(page.locator('.entity-preview-enter').first()).toBeVisible(); await noTitles('library + custom preview');
  await page.goto(`${base}/character-forge`); await expect(page.locator('.forge-square-card').first()).toBeVisible();
  await noTitles('forge');
  await page.goto(`${base}/characters-v3/${character.id}`);
  await expect(page.getByText(character.name, { exact: true }).first()).toBeVisible(); await noTitles('character sheet');
  const disabledAction = page.locator('.cs-action-tile[aria-disabled="true"]').first();
  if (await disabledAction.count()) {
    await disabledAction.hover(); await expect(page.locator('.forge-effect-popover')).toBeVisible();
    await expect(page.locator('.forge-effect-popover')).toHaveCSS('opacity', '1');
    await noTitles('disabled action keeps canonical explanation only');
    await page.screenshot({ path: `${out}/disabled-action.png` });
  }
  await page.goto(`${base}/characters-v3/${party.characterIds[0]}/combat?roguelike=${party.runId}`);
  await expect(page.locator('.solo-combat-page')).toBeVisible(); await noTitles('combat');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/m/characters/${character.id}`);
  await expect(page.getByText(character.name, { exact: true }).first()).toBeVisible(); await noTitles('mobile sheet');
  assert.deepEqual(errors, []); console.log(JSON.stringify({ checks, errors }));
} finally { await writeFile(`${out}/acceptance.json`, JSON.stringify({ checks, errors }, null, 2)); await browser.close(); }
