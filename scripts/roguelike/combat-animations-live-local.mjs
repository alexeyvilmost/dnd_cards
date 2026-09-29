// Actual authoritative commands on a new QA run for an existing local account.
// No combat state, outcome, resources or dice are patched directly.
import assert from 'node:assert/strict';
import {writeFile, mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const {chromium, expect} = require('@playwright/test');
const base = 'http://127.0.0.1:3001', out = 'outputs/combat-animation-286';
let token;
async function api(method, path, body, expected = 200) {
  const response = await fetch(`${base}/api${path}`, {method, headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})}, body: body === undefined ? undefined : JSON.stringify(body)});
  const result = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result).slice(0, 500)}`);
  return result;
}
await mkdir(out, {recursive: true});
await api('GET', '/animations', undefined, 401);
token = process.env.API_TOKEN;
assert(token, 'Supply API_TOKEN for an existing non-admin account in the local clone');
const auth = {token, user: await api('GET', '/auth/profile')};
const catalog = await api('GET', '/animations');
assert.equal(catalog.profiles.length, 70);
assert.equal(catalog.can_manage, false);
const targetBinding = catalog.bindings[0];
await api('PUT', `/animations/entities/${targetBinding.entity_type}/${targetBinding.entity_id}`, {profile_key: targetBinding.profile_key}, 403);
const template = (await api('GET', '/character-templates')).templates.find(row => row.preset_key === 'swordsman');
assert(template, 'Existing copied preset is available');
const character = await api('POST', `/character-templates/${template.id}/copies`, {name: `QA анимации ${randomUUID().slice(0, 6)}`}, 201);
let run = (await api('POST', '/roguelike/runs', {source_character_id: character.id}, 201)).run;
const evidence = {runId: run.id, characterId: run.character_id, userId: auth.user.id, profiles: catalog.profiles.length, bindings: catalog.bindings.length, checks: ['Unauthenticated catalog: 401', 'Real account catalog: 200', 'Non-admin binding edit: 403'], commands: []};
const command = async (type, payload = {}) => {
  const body = {command_id: randomUUID(), expected_revision: run.revision, type, payload};
  const result = await api('POST', `/roguelike/runs/${run.id}/commands`, body);
  const repeated = await api('POST', `/roguelike/runs/${run.id}/commands`, body);
  assert.deepEqual(repeated, result, 'Repeated authoritative command returns its original response');
  run = result.run;
  evidence.commands.push(type === 'combat_intent' ? payload.intent.type : type);
};
await command('start_encounter');
await command('initialize_combat');
const browser = await chromium.launch({channel: 'chrome', headless: true});
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({token, user}) => {
    localStorage.setItem('auth_token', token); localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('site-settings', JSON.stringify({combat3d: false, combatRollMode: 'skip', enemyCombatRollMode: 'skip'}));
    localStorage.setItem('boh:mobile-suggestion-dismissed', '1');
  }, auth);
  await page.goto(`${base}/e2e/fixtures/combat-animations-preview.html?once`);
  let performed = false;
  for (let index = 0; index < 12 && !performed; index++) {
    const decision = await page.evaluate(async ({state, catalog}) => {
      const {activeActor} = await import('/src/solo-combat/engine.ts');
      const {resolveCombatAnimation, setCombatAnimationCatalog} = await import('/src/solo-combat/animationProfiles.ts');
      setCombatAnimationCatalog(catalog);
      if (state.pendingD20Interrupt) return {intent: {type: 'd20_interrupt', actorId: null}};
      if (state.pendingInterception) return {intent: {type: 'interception', actorId: null}};
      if (state.pendingTriggeredAction) return {intent: {type: 'triggered_action', actionId: null}};
      if (state.pendingAdditionalMovement) return {intent: {type: 'decline_movement', actorId: state.pendingAdditionalMovement.actorId}};
      if (state.world.pendingResolution) return {intent: state.world.pendingResolution.request.type === 'reaction'
        ? {type: 'reaction', response: {kind: 'reaction', actionId: null}} : {type: 'saving_throw'}};
      const actor = activeActor(state);
      if (!state.controlledCharacterIds.includes(actor.id)) return {intent: {type: 'resume'}};
      const action = state.catalogActions.find(row => actor.capabilities.actionIds.includes(row.id) && resolveCombatAnimation(row).key === 'action.dash');
      if (!action) throw new Error('Dash is absent from the real preset action catalog');
      return {intent: {type: 'action', actorId: actor.id, actionId: action.id, targetIds: []}, dash: true};
    }, {state: run.combat_state, catalog});
    const previousSequence = Math.max(0, ...run.combat_state.log.map(entry => entry.sequence ?? 0));
    if (decision.dash) {
      await page.goto(`${base}/characters-v3/${run.character_id}/combat?roguelike=${run.id}`);
      await expect(page.getByTestId('tactical-map')).toBeVisible({timeout: 30000});
      const acceptedResponse = page.waitForResponse(response => response.url().endsWith(`/roguelike/runs/${run.id}/commands`) && response.request().method() === 'POST' && response.status() === 200);
      await page.getByRole('button', {name: 'Рывок', exact: true}).click();
      const response = await acceptedResponse;
      const accepted = await response.json();
      assert.deepEqual(await api('POST', `/roguelike/runs/${run.id}/commands`, response.request().postDataJSON()), accepted);
      run = accepted.run;
      evidence.commands.push('action (ordinary 2D hotbar)');
      await expect(page.locator('.combat-animation[data-animation-profile="action.dash"]')).toBeVisible();
      await page.evaluate(() => {for (const animation of document.getAnimations()) {animation.pause(); animation.currentTime = 240;}});
      await page.screenshot({path: `${out}/live-dash-animation.png`, fullPage: true});
      evidence.checks.push('Ordinary hotbar Dash renders its animation in the actual 2D combat screen');
    } else await command('combat_intent', {intent: decision.intent});
    if (decision.dash) {
      const beats = await page.evaluate(async ({state, previousSequence}) => {
        const {presentCombatEntries} = await import('/src/solo-combat/presentation.ts');
        return presentCombatEntries(state, state.log.filter(entry => (entry.sequence ?? 0) > previousSequence));
      }, {state: run.combat_state, previousSequence});
      assert(beats.some(beat => beat.animation?.key === 'action.dash'), 'Real accepted Dash projects its entity-bound animation');
      evidence.dashBeats = beats.map(beat => ({actionId: beat.actionId, profile: beat.animation?.key, sourceEntryId: beat.sourceEntryId}));
      evidence.checks.push('Real worker Dash command produced its entity-bound animation', 'Command retry reused its accepted outcome without spending again');
      performed = true;
    }
  }
  assert(performed, 'Reached and executed the player turn');
  await writeFile(`${out}/live-run.json`, JSON.stringify(run));
  await page.goto(`${base}/characters-v3/${run.character_id}/combat?roguelike=${run.id}`);
  await expect(page.locator('.solo-combat-page')).toBeVisible({timeout: 30000});
  await expect(page.getByTestId('tactical-map')).toBeVisible({timeout: 30000});
  await page.screenshot({path: `${out}/live-combat-desktop.png`, fullPage: true});
  await page.reload();
  await expect(page.getByTestId('tactical-map')).toBeVisible({timeout: 30000});
  const reloaded = (await api('GET', `/roguelike/runs/${run.id}`)).run;
  assert.equal(reloaded.revision, run.revision);
  evidence.checks.push('Actual 2D combat route loads and reload preserves accepted run revision');
  assert.deepEqual(errors, []);
  await writeFile(`${out}/live-evidence.json`, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {await browser.close();}
