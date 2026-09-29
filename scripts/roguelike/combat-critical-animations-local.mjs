// Presentation-only acceptance. Does not authenticate or send battle commands.
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const {chromium, expect} = require('@playwright/test');
const origin = process.env.ANIMATION_TEST_ORIGIN || 'http://127.0.0.1:3002';
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname), 'Local preview origin required');
const out = process.env.ANIMATION_TEST_OUTPUT || 'outputs/combat-animation-critical';
const catalog = JSON.parse(await readFile('backend/animationpresentation/catalog.json', 'utf8'));
const cases = ['weapon.slash', 'weapon.pierce', 'weapon.bash', 'weapon.arrow', 'weapon.throw-axe', 'weapon.firearm'];
const evidence = {origin, profiles: catalog.profiles.length, variants: [], checks: [], screenshots: []};
await mkdir(out, {recursive: true});
const browser = await chromium.launch({channel: 'chrome', headless: true});
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 1080}});
  const errors = [], apiRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(`${origin}/api/**`, route => {apiRequests.push(route.request().method()); return route.abort();});
  await page.goto(`${origin}/e2e/fixtures/combat-animations-preview.html?once`, {waitUntil: 'networkidle'});
  await expect(page.getByTestId('tactical-map')).toBeVisible();
  const selector = page.getByLabel('Профиль анимации');
  const critical = page.getByLabel('Критический удар', {exact: true});
  const miss = page.getByLabel('Промах', {exact: true});
  const held = page.getByLabel('Ожидание реакции', {exact: true});
  const criticalMiss = page.getByLabel('Критический промах', {exact: true});
  const visualPaths = async () => page.locator('.combat-animation path').evaluateAll(paths => paths.map(path => path.getAttribute('d')).join('|'));
  const pauseAt = async fraction => page.evaluate(fraction => {
    const duration = Number.parseFloat(document.querySelector('.combat-animation').style.getPropertyValue('--fx-duration'));
    for (const animation of document.getAnimations()) {animation.pause(); animation.currentTime = duration * fraction;}
  }, fraction);
  const capture = async name => {
    await page.screenshot({path: `${out}/${name}.png`, fullPage: true});
    evidence.screenshots.push(`${name}.png`);
  };
  for (const key of cases) {
    const base = catalog.profiles.find(profile => profile.key === key);
    const criticalKey = catalog.defaults.criticalProfile[key];
    const variant = catalog.profiles.find(profile => profile.key === criticalKey);
    assert(variant && variant.strikeStyle === 'critical');
    await selector.selectOption(key);
    await critical.uncheck();
    await expect(page.locator('.combat-animation')).toHaveAttribute('data-animation-profile', key);
    await expect(page.locator('.combat-animation.is-critical-weapon')).toHaveCount(0);
    const normalPaths = await visualPaths();
    await page.getByRole('button', {name: 'Повторить анимацию'}).click();
    await pauseAt(Math.min(.85, (base.motion.contactRatio ?? .4) + .06));
    await capture(`${key.split('.').at(-1)}-normal`);
    await critical.check();
    await expect(page.locator('.combat-animation')).toHaveAttribute('data-animation-profile', criticalKey);
    await expect(page.locator('.combat-animation.is-critical-weapon')).toHaveCount(1);
    await expect(page.locator('.combat-critical-impact')).toHaveCount(1);
    assert.notEqual(await visualPaths(), normalPaths, 'Critical delivery has distinct geometry, not merely a larger normal impact');
    await page.getByRole('button', {name: 'Повторить анимацию'}).click();
    await pauseAt(variant.motion.contactRatio + .06);
    await capture(`${key.split('.').at(-1)}-critical`);
    evidence.variants.push({base: key, critical: criticalKey, primitive: variant.primitive, durationMs: variant.motion.durationMs, contactRatio: variant.motion.contactRatio});
  }
  evidence.checks.push('Sword, thrust, bash, arrow, thrown axe and firearm each use data-owned critical variants with distinct geometry');
  const phases = [];
  for (const [key, phase, fraction] of [['weapon.bash', 'windup', .24], ['weapon.bash', 'recoil', .75], ['weapon.slash', 'recovery', .70]]) {
    await selector.selectOption(key);
    await critical.check();
    await page.getByRole('button', {name: 'Повторить анимацию'}).click();
    await pauseAt(fraction);
    const values = await page.evaluate(() => ({
      contactOpacity: Number(getComputedStyle(document.querySelector('.combat-critical-contact')).opacity),
      pressureOpacity: Number(getComputedStyle(document.querySelector('.combat-critical-pressure')).opacity),
      sourceClass: document.querySelector('[data-actor-id="caster"] .battle-token').className,
    }));
    if (phase === 'windup') assert.equal(values.contactOpacity, 0, 'Critical contact waits for the authored impact phase');
    else assert(values.contactOpacity < .1, 'The short critical flash is finished during recovery');
    phases.push({key, phase, fraction, ...values});
    await capture(`${key.split('.').at(-1)}-critical-${phase}`);
  }
  evidence.phases = phases;
  evidence.checks.push('Critical wind-up has no premature contact flash; the hit flash ends during recoil and recovery');
  await selector.selectOption('weapon.slash');
  await critical.check();
  await held.check();
  await expect(critical).not.toBeChecked();
  await expect(miss).not.toBeChecked();
  await expect(page.locator('.combat-animation')).toHaveCount(0);
  await expect(page.locator('.combat-floating-cue')).toHaveCount(0);
  const withheld = await page.evaluate(async () => {
    const {combatAnimationForOutcome, getAnimationProfile} = await import('/src/solo-combat/animationProfiles.ts');
    const base = getAnimationProfile('weapon.slash');
    return combatAnimationForOutcome(base, {outcome: 'crit', rollPhase: 'before-reaction'}).key;
  });
  assert.equal(withheld, 'weapon.slash');
  await critical.check();
  await expect(held).not.toBeChecked();
  await expect(page.locator('.combat-animation.is-critical-weapon')).toHaveCount(1);
  await miss.check();
  await expect(critical).not.toBeChecked();
  await expect(page.locator('.combat-animation')).toHaveClass(/is-miss/);
  await expect(page.locator('.combat-critical-impact,.combat-fx-impact')).toHaveCount(0);
  const missPaths = await visualPaths();
  await criticalMiss.check();
  await expect(miss).not.toBeChecked();
  await expect(page.locator('.combat-animation')).toHaveAttribute('data-animation-profile', 'weapon.slash');
  assert.equal(await visualPaths(), missPaths, 'Critical miss retains normal miss geometry');
  await expect(page.locator('.combat-critical-impact,.combat-fx-impact')).toHaveCount(0);
  evidence.checks.push('Provisional critical results are hidden; miss and critical miss have no critical delivery or impact; controls are mutually exclusive');
  await critical.check();
  await page.getByLabel('Палитра урона').selectOption('force');
  await expect(page.locator('.combat-animation')).toHaveAttribute('data-animation-profile', catalog.defaults.criticalProfile['weapon.slash']);
  const force = await page.locator('.combat-animation').evaluate(el => getComputedStyle(el).getPropertyValue('--fx-primary').trim());
  assert.equal(force, '#ef4444');
  await page.getByRole('button', {name: 'Повторить анимацию'}).click();
  await pauseAt(.55);
  await capture('force-slash-critical');
  await page.emulateMedia({reducedMotion: 'reduce'});
  assert.equal(await page.locator('.combat-animation').evaluate(el => el.getAnimations({subtree: true}).length), 0);
  evidence.checks.push('Force damage keeps the critical weapon shape and uses red; reduced motion disables all animation movement');
  await page.emulateMedia({reducedMotion: 'no-preference'});
  await page.setViewportSize({width: 390, height: 844});
  await page.getByRole('button', {name: 'Повторить анимацию'}).click();
  await pauseAt(.55);
  await capture('force-slash-critical-mobile');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Critical controls fit a 390px viewport');
  await page.goto(`${origin}/e2e/fixtures/combat-animations-preview.html?profile=weapon.pierce&critical=1&once`);
  await expect(critical).toBeChecked();
  await expect(page.locator('.combat-animation')).toHaveAttribute('data-animation-profile', catalog.defaults.criticalProfile['weapon.pierce']);
  evidence.checks.push('Critical URL selection and mobile controls work without page overflow');
  assert.deepEqual(apiRequests, []);
  assert.deepEqual(errors, []);
  evidence.checks.push('No API requests, game commands or browser runtime errors');
  await writeFile(`${out}/browser-evidence.json`, JSON.stringify(evidence, null, 2));
  console.log(`PASS ${evidence.variants.length} critical weapon families, ${evidence.checks.length} acceptance checks, ${evidence.screenshots.length} screenshots.`);
} finally {await browser.close();}
