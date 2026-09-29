// Verify actual executed ancestry actions on the running local 2D renderer.
// Inputs are isolated engine exports, never the user's live combat state.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const {chromium, expect} = require('@playwright/test');
const origin = process.env.ANIMATION_TEST_ORIGIN || 'http://127.0.0.1:3001';
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname), 'Local preview origin required');
const out = process.env.ANIMATION_TEST_OUTPUT || 'outputs/combat-animation-v2';
const credentials = JSON.parse(await readFile('outputs/combat-animation-286/credentials.json', 'utf8'));
const auth = await fetch(`${origin}/api/auth/login`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(credentials)});
assert.equal(auth.status, 200);
const {token} = await auth.json();
const response = await fetch(`${origin}/api/animations`, {headers: {Authorization: `Bearer ${token}`}});
assert.equal(response.status, 200);
const catalog = await response.json();
const browser = await chromium.launch({channel: 'chrome', headless: true});
const evidence = {origin, apiCatalogVersion: catalog.version, profiles: catalog.profiles.length, actions: [], browserRequests: [], errors: []};
await mkdir(out, {recursive: true});
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  page.on('pageerror', error => evidence.errors.push(error.message));
  await page.route(`${origin}/api/**`, route => {evidence.browserRequests.push(route.request().method()); return route.abort();});
  for (const [cardNumber, profile] of [['ACT-breath-fire', 'breath.fire'], ['ACT-breath-acid', 'breath.acid']]) {
    const {state} = JSON.parse(await readFile(`${out}/${cardNumber}-executed.json`, 'utf8'));
    await page.goto(`${origin}/e2e/fixtures/combat-animations-preview.html?once`);
    const cast = await page.evaluate(async ({state, catalog}) => {
      const {setCombatAnimationCatalog} = await import('/src/solo-combat/animationProfiles.ts');
      const {presentCombatEntries} = await import('/src/solo-combat/presentation.ts');
      setCombatAnimationCatalog(catalog);
      const before = JSON.stringify(state);
      const beats = presentCombatEntries(state, state.log);
      if (JSON.stringify(state) !== before) throw new Error('Presentation changed the executed state');
      const cast = beats.find(beat => beat.area && !beat.suppressAnimation && beat.animation?.key.startsWith('breath.'));
      if (!cast) throw new Error('Executed breath has no canonical animation beat');
      return {id: cast.id, profile: cast.animation.key, cells: cast.area.cells.length, origin: cast.area.origin};
    }, {state, catalog});
    assert.equal(cast.profile, profile);
    await page.getByLabel('Локальный снимок боя').setInputFiles({name: `${cardNumber}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state))});
    await page.getByLabel('Сохранённое событие').selectOption(cast.id);
    await expect(page.locator('.combat-animation')).toHaveCount(1);
    await expect(page.locator(`.combat-animation[data-animation-profile="${profile}"]`)).toHaveCount(1);
    await expect(page.locator('.combat-area-fx')).toHaveAttribute('data-area-kind', 'cone');
    await expect(page.locator('.combat-area-fx')).toHaveAttribute('data-area-cell-count', String(cast.cells));
    await expect(page.locator('.combat-spell-circle')).toHaveCount(0);
    await page.getByRole('button', {name: 'Повторить анимацию'}).click();
    await page.evaluate(() => {
      const duration = Number.parseFloat(document.querySelector('.combat-animation').style.getPropertyValue('--fx-duration'));
      for (const animation of document.getAnimations()) {animation.pause(); animation.currentTime = duration * .48;}
    });
    const screenshot = `${cardNumber}-executed-3001.png`;
    await page.screenshot({path: `${out}/${screenshot}`, fullPage: true});
    evidence.actions.push({cardNumber, ...cast, screenshot});
  }
  assert.deepEqual(evidence.browserRequests, []);
  assert.deepEqual(evidence.errors, []);
  await writeFile(`${out}/breath-execution-browser-evidence.json`, JSON.stringify(evidence, null, 2));
  console.log(`PASS ${evidence.actions.length} actually executed ancestry breaths on ${origin}: single area per cast, zero spell circles, zero game commands.`);
} finally {await browser.close();}
