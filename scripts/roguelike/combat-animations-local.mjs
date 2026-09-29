// Presentation-only browser acceptance against the dev fixture; no game writes.
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const {chromium, expect} = require('@playwright/test');
const origin = process.env.ANIMATION_TEST_ORIGIN || 'http://127.0.0.1:3001';
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname), 'Local preview origin required');
const out = 'outputs/combat-animation-286';
const catalog = JSON.parse(await readFile('backend/animationpresentation/catalog.json', 'utf8'));
await mkdir(out, {recursive: true});
const browser = await chromium.launch({channel: 'chrome', headless: true});
const evidence = {profiles: [], checks: [], screenshots: []};
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  const errors = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') writes.push(request.url());});
  await page.goto(`${origin}/e2e/fixtures/combat-animations-preview.html?once`, {waitUntil: 'networkidle'});
  await expect(page.getByTestId('tactical-map')).toBeVisible();
  await expect(page.getByTestId('battle-map-3d')).toHaveCount(0);
  const selector = page.getByLabel('Профиль анимации');
  await expect(selector.locator('option')).toHaveCount(catalog.profiles.length);
  for (const profile of catalog.profiles) {
    await selector.selectOption(profile.key);
    await expect(page.locator(`.combat-animation[data-animation-profile="${profile.key}"]`)).toHaveCount(1);
    await expect(page.locator('.combat-animation-canvas')).toHaveCSS('pointer-events', 'none');
    evidence.profiles.push({key: profile.key, primitive: profile.primitive});
  }
  evidence.checks.push('Every shared profile renders on the canonical 2D map with a pointer-transparent canvas');
  await selector.selectOption('spell.fire-bolt');
  await expect(page.locator('.combat-spell-circle')).toHaveAttribute('data-ring-count', '1');
  const radius0 = Number(await page.locator('.combat-spell-circle__ground').getAttribute('r'));
  await page.getByRole('slider', {name: 'Уровень заклинания'}).fill('9');
  await expect(page.locator('.combat-spell-circle')).toHaveAttribute('data-ring-count', '6');
  const radius9 = Number(await page.locator('.combat-spell-circle__ground').getAttribute('r'));
  assert(radius9 > radius0, 'Upcast circle grows as well as gaining rings');
  evidence.checks.push(`Circle level 0→9: 1→6 rings, radius ${radius0}→${radius9}`);
  await page.getByLabel('Ожидание реакции').check();
  await expect(page.locator('.combat-animation')).toHaveCount(0);
  await expect(page.locator('.combat-floating-cue')).toHaveCount(0);
  await page.getByLabel('Ожидание реакции').uncheck();
  await page.getByLabel('Промах', {exact: true}).check();
  await expect(page.locator('.combat-animation')).toHaveClass(/is-miss/);
  await expect(page.locator('.combat-fx-impact')).toHaveCount(0);
  await page.getByLabel('Промах', {exact: true}).uncheck();
  evidence.checks.push('Provisional roll has no outcome animation or cue; committed miss has no impact');
  const capture = async (profile, name, level = 0) => {
    await selector.selectOption(profile);
    await page.getByRole('slider', {name: 'Уровень заклинания'}).fill(String(level));
    await page.getByRole('button', {name: 'Повторить анимацию'}).click();
    await page.evaluate(time => {
      for (const animation of document.getAnimations()) {animation.pause(); animation.currentTime = time;}
    }, catalog.profiles.find(row => row.key === profile).motion.durationMs * .32);
    await page.screenshot({path: `${out}/${name}.png`, fullPage: true});
    evidence.screenshots.push(`${name}.png`);
  };
  await capture('weapon.slash', 'slash-desktop');
  await capture('natural.bite', 'bite-desktop');
  await capture('spell.fire-bolt', 'fire-desktop');
  const centres = await page.evaluate(() => {
    const circle = document.querySelector('.combat-spell-circle');
    const matrix = circle.getScreenCTM();
    const token = document.querySelector('[data-actor-id="caster"] .battle-token').getBoundingClientRect();
    return {circle: {x: matrix.e, y: matrix.f}, token: {x: token.x + token.width / 2, y: token.y + token.height / 2}};
  });
  assert(Math.hypot(centres.circle.x - centres.token.x, centres.circle.y - centres.token.y) < 12, 'Spell circle is centred on the caster, allowing the short token lunge');
  evidence.checks.push('SVG spell origin aligns with the actual caster token after independent map embedding');
  await capture('spell.frost-ray', 'frost-level9-desktop', 9);
  await capture('action.hide', 'hide-desktop');
  await page.emulateMedia({reducedMotion: 'reduce'});
  await selector.selectOption('spell.fire-bolt');
  await expect(page.locator('.combat-fx-projectile')).toBeHidden();
  await expect(page.locator('.combat-spell-circle__reveal')).toHaveCSS('animation-name', 'none');
  assert.equal(await page.locator('.combat-animation').evaluate(el => el.getAnimations({subtree: true}).length), 0);
  evidence.checks.push('Reduced motion disables decorative movement and projectile flight');
  await page.emulateMedia({reducedMotion: 'no-preference'});
  await page.setViewportSize({width: 390, height: 844});
  await capture('spell.frost-ray', 'frost-mobile', 3);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No mobile page overflow');
  await expect(page.getByTestId('tactical-map')).toBeVisible();
  evidence.checks.push('390 px mobile controls and 2D board are visible without page overflow');
  assert.deepEqual(writes, []);
  assert.deepEqual(errors, []);
  evidence.checks.push('No API writes or browser runtime errors');
  await writeFile(`${out}/browser-evidence.json`, JSON.stringify(evidence, null, 2));
  console.log(`PASS ${evidence.profiles.length} animation profiles; ${evidence.checks.length} acceptance checks; ${evidence.screenshots.length} screenshots.`);
} finally {await browser.close();}
