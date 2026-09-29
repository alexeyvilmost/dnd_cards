// Presentation-only acceptance. No authentication, API requests or game commands.
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const {chromium, expect} = require('@playwright/test');
const origin = process.env.ANIMATION_TEST_ORIGIN || 'http://127.0.0.1:3002';
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname), 'Local preview origin required');
const out = process.env.ANIMATION_TEST_OUTPUT || 'outputs/combat-animation-critical';
const catalog = JSON.parse(await readFile('backend/animationpresentation/catalog.json', 'utf8'));
const cases = ['spell.frost-ray', 'spell.eldritch-blast', 'spell.shocking-grasp', 'spell.fire-bolt', 'spell.ice-knife'];
const evidence = {origin, profiles: catalog.profiles.length, mappings: [], variants: [], checks: [], screenshots: []};
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
  // Every mapping goes through the production outcome selector and renderer.
  for (const [base, key] of Object.entries(catalog.defaults.criticalProfile)) {
    const variant = catalog.profiles.find(row => row.key === key);
    await selector.selectOption(base);
    await critical.check();
    await expect(page.locator('.combat-animation')).toHaveAttribute('data-animation-profile', key);
    await expect(page.locator('.combat-animation')).toHaveAttribute('data-critical-effect', variant.criticalEffect === 'magic' ? 'magic' : 'weapon');
    await expect(page.locator('[data-critical-impact]')).toHaveCount(1);
    evidence.mappings.push({base, critical: key, effect: variant.criticalEffect ?? 'weapon'});
  }
  const outcomes = await page.evaluate(async () => {
    const {builtInAnimationCatalog: catalog, combatAnimationForOutcome} = await import('/src/solo-combat/animationProfiles.ts');
    return Object.entries(catalog.defaults.criticalProfile).map(([base, key]) => {
      const profile = catalog.profiles.find(row => row.key === base);
      return {base, key,
        confirmed: combatAnimationForOutcome(profile, {outcome: 'crit', rollPhase: 'after-reaction'}).key,
        held: combatAnimationForOutcome(profile, {outcome: 'crit', rollPhase: 'before-reaction'}).key,
        miss: combatAnimationForOutcome(profile, {outcome: 'crit_miss'}).key};
    });
  });
  for (const row of outcomes) {assert.equal(row.confirmed, row.key); assert.equal(row.held, row.base); assert.equal(row.miss, row.base);}
  evidence.checks.push(`${outcomes.length} data mappings resolve and render; each withholds provisional and critical-miss variants`);
  for (const key of cases) {
    const base = catalog.profiles.find(row => row.key === key);
    const criticalKey = catalog.defaults.criticalProfile[key];
    const variant = catalog.profiles.find(row => row.key === criticalKey);
    await selector.selectOption(key);
    await critical.uncheck();
    await expect(page.locator('.combat-animation')).toHaveAttribute('data-animation-profile', key);
    await expect(page.locator('.combat-animation.is-critical-magic')).toHaveCount(0);
    const normalPaths = await visualPaths();
    await page.getByRole('button', {name: 'Повторить анимацию'}).click();
    await pauseAt((base.motion.contactRatio ?? .54) + .06);
    await capture(`${key.split('.').at(-1)}-normal`);
    await critical.check();
    await expect(page.locator('.combat-animation')).toHaveAttribute('data-animation-profile', criticalKey);
    await expect(page.locator('.combat-animation.is-critical-magic')).toHaveCount(1);
    await expect(page.locator('.combat-critical-magic-impact')).toHaveCount(1);
    await expect(page.locator('.combat-critical-impact')).toHaveCount(0);
    assert.notEqual(await visualPaths(), normalPaths, 'Critical magic uses distinct focus, delivery and impact geometry');
    const phases = [];
    for (const [phase, fraction] of [['focus', Math.max(.15, variant.motion.launchRatio - .1)], ['flight', (variant.motion.launchRatio + variant.motion.contactRatio) / 2], ['impact', variant.motion.contactRatio + .06], ['recovery', .82]]) {
      await page.getByRole('button', {name: 'Повторить анимацию'}).click();
      await pauseAt(fraction);
      const flare = await page.locator('.combat-critical-magic-flare').evaluate(el => Number(getComputedStyle(el).opacity));
      if (phase === 'focus' || phase === 'flight') assert.equal(flare, 0, 'No critical hit before contact');
      if (phase === 'recovery') assert(flare < .1, 'Critical magic flash ends during recovery');
      await capture(`${key.split('.').at(-1)}-critical-${phase}`);
      phases.push({phase, fraction, flare});
    }
    evidence.variants.push({base: key, critical: criticalKey, primitive: variant.primitive, phases});
  }
  evidence.checks.push('Charged frost and force rays, ordinary lightning beam, fire projectile and magical thrown knife have distinct critical phases');
  await selector.selectOption('spell.eldritch-blast');
  await critical.check();
  assert.equal(await page.locator('.combat-animation').evaluate(el => getComputedStyle(el).getPropertyValue('--fx-primary').trim()), '#ef4444');
  await expect(page.locator('.combat-spell-circle')).toHaveCount(1);
  await held.check();
  await expect(critical).not.toBeChecked();
  await expect(page.locator('.combat-animation,.combat-floating-cue')).toHaveCount(0);
  await miss.check();
  await expect(page.locator('.combat-animation')).toHaveClass(/is-miss/);
  await expect(page.locator('[data-critical-impact],.combat-fx-impact')).toHaveCount(0);
  const missPaths = await visualPaths();
  await criticalMiss.check();
  assert.equal(await visualPaths(), missPaths);
  await expect(page.locator('.combat-animation')).toHaveAttribute('data-animation-profile', 'spell.eldritch-blast');
  await expect(page.locator('[data-critical-impact],.combat-fx-impact')).toHaveCount(0);
  await critical.check();
  await page.emulateMedia({reducedMotion: 'reduce'});
  assert.equal(await page.locator('.combat-animation').evaluate(el => el.getAnimations({subtree: true}).length), 0);
  await capture('eldritch-blast-critical-reduced-motion');
  evidence.checks.push('Force critical beam stays red, held results stay hidden, both misses retain normal delivery, reduced motion is static');
  assert.deepEqual(apiRequests, []);
  assert.deepEqual(errors, []);
  evidence.checks.push('No API requests, game commands or browser runtime errors');
  await writeFile(`${out}/browser-magic-evidence.json`, JSON.stringify(evidence, null, 2));
  console.log(`PASS ${evidence.mappings.length} critical mappings, ${evidence.variants.length} magic examples, ${evidence.screenshots.length} screenshots.`);
} finally {await browser.close();}
