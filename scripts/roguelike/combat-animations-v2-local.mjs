// Read-only visual acceptance: local fixture + a local saved battle JSON.
// This script never authenticates or sends a game command.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const {chromium, expect} = require('@playwright/test');
const origin = process.env.ANIMATION_TEST_ORIGIN || 'http://127.0.0.1:3002';
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname), 'Local preview origin required');
const out = process.env.ANIMATION_TEST_OUTPUT || 'outputs/combat-animation-v2';
const snapshotPath = process.env.ANIMATION_SNAPSHOT_PATH || `${out}/current-combat-state.json`;
const catalog = JSON.parse(await readFile('backend/animationpresentation/catalog.json', 'utf8'));
const snapshotText = await readFile(snapshotPath, 'utf8');
const snapshot = JSON.parse(snapshotText);
const digest = text => createHash('sha256').update(text).digest('hex');
const evidence = {profiles: catalog.profiles.length, checks: [], areas: [], beams: [], savedAttacks: [], screenshots: [], snapshotSha256: digest(snapshotText)};
await mkdir(out, {recursive: true});
const browser = await chromium.launch({channel: 'chrome', headless: true});
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 1080}});
  const errors = [], apiRequests = [];
  page.on('pageerror', error => {errors.push(error.message); console.error(`Browser runtime error: ${error.message}`);});
  await page.route(`${origin}/api/**`, route => {apiRequests.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`); return route.abort();});
  await page.goto(`${origin}/e2e/fixtures/combat-animations-preview.html?once`, {waitUntil: 'networkidle'});
  await expect(page.getByTestId('tactical-map')).toBeVisible();
  const selector = page.getByLabel('Профиль анимации');
  const pauseAt = async fraction => {
    const duration = await page.locator('.combat-animation').evaluate(el => Number.parseFloat(el.style.getPropertyValue('--fx-duration')));
    await page.evaluate(time => {for (const animation of document.getAnimations()) {animation.pause(); animation.currentTime = time;}}, duration * fraction);
  };
  const capture = async name => {
    await page.screenshot({path: `${out}/${name}.png`, fullPage: true});
    evidence.screenshots.push(`${name}.png`);
  };
  for (const key of ['spell.frost-ray', 'spell.eldritch-blast']) {
    await selector.selectOption(key);
    await expect(page.locator('.combat-charged-ray')).toHaveCount(1);
    const focusDistance = Number(await page.locator('.combat-charged-ray').getAttribute('data-focus-distance'));
    assert(focusDistance > 25, 'Energy focuses in front of the source');
    const phases = [];
    for (const [name, fraction] of [['focus', .24], ['flight', .44], ['impact', .59]]) {
      await page.getByRole('button', {name: 'Повторить анимацию'}).click();
      await pauseAt(fraction);
      phases.push(await page.evaluate(phase => ({phase,
        charge: Number(getComputedStyle(document.querySelector('.combat-ray-focus-core')).opacity),
        release: Number(getComputedStyle(document.querySelector('.combat-ray-release')).opacity),
        impact: Number(getComputedStyle(document.querySelector('.combat-fx-impact .combat-fx-flash')).opacity),
      }), name));
      await capture(`${key.split('.')[1]}-${name}`);
    }
    assert(phases[0].charge > .2 && phases[0].release < .05 && phases[0].impact < .05, `Focus precedes flight and impact: ${JSON.stringify(phases)}`);
    assert(phases[1].release > .2 && phases[1].impact < .05, 'The beam travels before impact');
    assert(phases[2].impact > .2, 'Impact follows the beam');
    evidence.beams.push({key, focusDistance, phases});
  }
  evidence.checks.push('Frost ray and eldritch blast focus in front of the source, release rapidly and impact in separate phases');
  const areaProfiles = ['area_cone', 'area_line', 'area_wave', 'area_burst'].map(primitive => {
    const profile = catalog.profiles.find(row => row.primitive === primitive);
    assert(profile, `Shared catalog provides ${primitive}`);
    return profile;
  });
  for (const profile of areaProfiles) {
    await selector.selectOption(profile.key);
    await expect(page.locator('.combat-area-fx')).toHaveCount(1);
    await page.getByRole('slider', {name: 'Размер области'}).fill(profile.primitive === 'area_burst' ? '5' : '15');
    await page.getByRole('button', {name: 'Повторить анимацию'}).click();
    await pauseAt(.48);
    await capture(`${profile.primitive}-desktop`);
  }
  for (const key of ['spell.entangle', 'spell.hadar-arms', 'spell.sleep', 'spell.fog-cloud']) {
    await selector.selectOption(key);
    await page.getByRole('slider', {name: 'Размер области'}).fill('15');
    await page.getByRole('slider', {name: 'Уровень заклинания'}).fill('1');
    await page.getByRole('button', {name: 'Повторить анимацию'}).click();
    await pauseAt(.48);
    await capture(`${key.split('.')[1]}-area`);
  }
  await selector.selectOption(areaProfiles[0].key);
  for (const kind of ['cone', 'line', 'cube', 'sphere', 'cylinder', 'emanation']) {
    await page.getByLabel('Геометрия области').selectOption(kind);
    await page.getByRole('slider', {name: 'Размер области'}).fill('15');
    await expect(page.locator('.combat-area-fx')).toHaveAttribute('data-area-kind', kind);
    const expected = await page.evaluate(async kind => {
      const {areaPositionsForAction, areaEffectOrigin} = await import('/src/solo-combat/tacticalGrid.ts');
      const input = {board: {battleMap: {width: 12, height: 8, features: []}},
        action: {mechanics: {targeting: {shape: 'area', area: {kind, size_ft: 15, length_ft: 15, width_ft: 5, radius_ft: 15}}}, targeting: {rangeFt: 120}},
        sourcePosition: {x: 3, y: 4}, aimPosition: {x: 8, y: 4}};
      return {cells: areaPositionsForAction(input), origin: areaEffectOrigin(input)};
    }, kind);
    await expect(page.locator('.combat-area-fx')).toHaveAttribute('data-area-cell-count', String(expected.cells.length));
    await expect(page.locator('.combat-area-fx')).toHaveAttribute('data-area-origin', `${expected.origin.x},${expected.origin.y}`);
    assert.equal(await page.locator('.combat-area-fx clipPath path').getAttribute('d'), expected.cells.map(cell => `M${cell.x * 100} ${cell.y * 100}h100v100h-100Z`).join(' '));
    evidence.areas.push({kind, cells: expected.cells.length, origin: expected.origin});
  }
  evidence.checks.push('All six area geometries paint only the exact canonical target cells at their canonical origin');
  await page.getByLabel('Ожидание реакции').check();
  await expect(page.locator('.combat-area-fx')).toHaveCount(0);
  await page.getByLabel('Ожидание реакции').uncheck();
  await selector.selectOption('spell.frost-ray');
  await page.getByLabel('Промах', {exact: true}).check();
  await expect(page.locator('.combat-fx-impact')).toHaveCount(0);
  await page.getByLabel('Промах', {exact: true}).uncheck();
  await page.emulateMedia({reducedMotion: 'reduce'});
  assert.equal(await page.locator('.combat-animation').evaluate(el => el.getAnimations({subtree: true}).length), 0);
  await page.emulateMedia({reducedMotion: 'no-preference'});
  evidence.checks.push('Held area outcome remains hidden; a missed ray has no impact; reduced motion removes animated movement');
  await page.getByLabel('Локальный снимок боя').setInputFiles(resolve(snapshotPath));
  const savedSelector = page.getByLabel('Сохранённое событие');
  await expect(savedSelector).toBeVisible();
  const attacks = await page.evaluate(async state => {
    const {presentCombatEntries} = await import('/src/solo-combat/presentation.ts');
    const before = JSON.stringify(state);
    const projected = presentCombatEntries(state, state.log);
    if (JSON.stringify(state) !== before) throw new Error('Presentation mutated the saved snapshot');
    return projected.filter(beat => beat.roll?.target?.type === 'ac' && beat.rollPhase !== 'before-reaction')
      .map(beat => ({id: beat.id, sourceId: beat.sourceId, name: beat.sourceName, action: beat.actionName, profile: beat.animation?.key, primitive: beat.animation?.primitive, outcome: beat.roll.outcome}));
  }, snapshot);
  const playerAttacks = attacks.filter(beat => beat.sourceId === snapshot.characterId);
  const houndAttacks = attacks.filter(beat => beat.sourceId !== snapshot.characterId);
  assert(playerAttacks.length && playerAttacks.every(beat => beat.primitive === 'melee_slash'), 'All saved player attacks resolve equipped slashing weapon');
  assert(houndAttacks.length && houndAttacks.every(beat => beat.primitive === 'bite'), 'All saved hound attacks resolve entity-bound bite');
  for (const [primitive, name] of [['melee_slash', 'saved-player-slash'], ['bite', 'saved-hound-bite']]) {
    const attack = attacks.find(beat => beat.primitive === primitive && ['hit', 'crit'].includes(beat.outcome))
      ?? attacks.find(beat => beat.primitive === primitive);
    await savedSelector.selectOption(attack.id);
    await expect(page.locator(`.combat-animation[data-animation-profile="${attack.profile}"]`)).toHaveCount(1);
    await page.getByRole('button', {name: 'Повторить анимацию'}).click();
    await pauseAt(.42);
    await capture(name);
  }
  evidence.savedAttacks = attacks;
  evidence.checks.push('Unchanged saved user battle replays equipped sword slash and hound bite through canonical presentation/map components');
  assert.equal(digest(await readFile(snapshotPath, 'utf8')), evidence.snapshotSha256);
  assert.deepEqual(apiRequests, []);
  assert.deepEqual(errors, []);
  evidence.checks.push('No API requests, game commands, snapshot writes or browser errors');
  await writeFile(`${out}/browser-v2-evidence.json`, JSON.stringify(evidence, null, 2));
  console.log(`PASS ${evidence.beams.length} charged rays, ${evidence.areas.length} geometries, ${attacks.length} saved attacks, ${evidence.screenshots.length} screenshots.`);
} finally {await browser.close();}
