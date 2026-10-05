import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, expect, signIn, createRun, hash, watchPageErrors, initializeFixtureEncounter, declinePendingIntent } from './fixtures';
import { readRunInvariant } from '../../scripts/testing/acceptance-observer.mjs';
import { loadMovementProjection } from '../../scripts/testing/movement-encounter-fixture.mjs';

for (const movementOutcome of ['miss', 'hit'] as const) {
test(`S05 ${movementOutcome === 'hit' ? 'held' : 'direct'} movement and authoritative held attack survive reload and retry one paid influence`, async ({ page, api }, testInfo) => {
  const { actorFootprint, footprintDistanceFt, combatActionRangeFt, combatApproachRoute } = await loadMovementProjection();
  const checkErrors = watchPageErrors(page); await signIn(page, api);
  await page.addInitScript(() => {
    if (!localStorage.getItem('site-settings')) localStorage.setItem('site-settings', JSON.stringify({
      combatRollMode: 'standard', enemyCombatRollMode: 'skip', dice3d: false, audioEnabled: false,
    }));
  });
  await page.goto('/settings');
  await page.getByRole('group', { name: 'Действия', exact: true }).getByRole('radio', { name: 'Список', exact: true }).check();
  const fixture = await createRun(api, 'archer');
  await initializeFixtureEncounter(api, fixture, 'durable', movementOutcome);
  expect(Boolean(fixture.run.combat_state), 'Real worker initialization must succeed').toBe(true);
  for (let i = 0; i < 30; i++) {
    const state = fixture.run.combat_state;
    let intent;
    if (state.pendingAlertSwapActorIds?.length) intent = { type: 'alert_swap', actorId: state.pendingAlertSwapActorIds[0], allyActorId: null };
    else if (state.pendingD20Interrupt) intent = { type: 'd20_interrupt', actorId: null };
    else if (state.world.pendingResolution?.request.type === 'reaction') intent = { type: 'reaction', response: { kind: 'reaction', actionId: null } };
    else if (state.world.pendingResolution?.request.type === 'saving_throw') intent = { type: 'saving_throw' };
    else if (state.world.scene.initiative[state.world.scene.activeIndex] !== state.characterId) intent = { type: 'resume' };
    else break;
    await fixture.command('combat_intent', { intent });
  }
  await page.goto(`/characters-v3/${fixture.run.character_id}/combat?roguelike=${fixture.run.id}`);
  const move = page.getByRole('button', { name: /^Движение: / });
  await expect(move).toBeEnabled(); await move.click();
  const movementDialog = page.getByRole('dialog', { name: 'Перемещение', exact: true });
  await expect(movementDialog).toBeVisible();
  const walk = movementDialog.getByRole('button', { name: /^Ходьба/ });
  if (!(await walk.getAttribute('class'))?.split(/\s+/).includes('on')) await walk.click();
  await movementDialog.getByRole('button', { name: 'Применить', exact: true }).click();
  const actorId = fixture.run.combat_state.characterId;
  const oldPosition = fixture.run.combat_state.tokens[actorId].position;
  const oldMovement = fixture.run.combat_state.movementRemainingFt[actorId];
  const movementState = fixture.run.combat_state;
  const adjacentEnemies: any[] = Object.values(movementState.world.actors).filter((actor: any) => actor.kind === 'monster'
    && footprintDistanceFt(oldPosition, movementState.tokens[actor.id].position,
      actorFootprint(movementState.world.actors[actorId], movementState), actorFootprint(actor, movementState)) <= 5);
  expect(adjacentEnemies.length, 'Declared fast melee opponents must have reached the character before its turn').toBeGreaterThan(0);
  const reachable = page.locator('.tactical-cell.is-move-reachable:not(.has-token):not(.is-movement-hazard)');
  await expect(reachable.first()).toBeVisible();
  const cells = await reachable.evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')!));
  const destination = cells.map(label => ({ label, match: label.match(/Клетка (\d+), (\d+)/)! }))
    .map(row => ({ label: row.label, x: Number(row.match[1]) - 1, y: Number(row.match[2]) - 1 }))
    .filter(cell => adjacentEnemies.some(actor => footprintDistanceFt(cell, movementState.tokens[actor.id].position,
      actorFootprint(movementState.world.actors[actorId], movementState), actorFootprint(actor, movementState)) > 5))
    .sort((a, b) => Math.abs(a.x - oldPosition.x) + Math.abs(a.y - oldPosition.y) - Math.abs(b.x - oldPosition.x) - Math.abs(b.y - oldPosition.y))[0];
  expect(Boolean(destination), 'The authored fixture must provide a legal route out of enemy reach').toBe(true);
  const movementResponse = page.waitForResponse(response => response.request().method() === 'POST'
    && response.url().endsWith(`/api/roguelike/runs/${fixture.run.id}/commands`)
    && response.request().postDataJSON()?.payload?.intent?.type === 'move');
  await page.getByRole('button', { name: destination.label, exact: true }).click();
  const moved = await movementResponse;
  expect(moved.status()).toBe(200);
  const moveRequest = moved.request().postDataJSON();
  expect(moveRequest.payload.intent).toEqual({ type: 'move', actorId, destination: { x: destination.x, y: destination.y } });
  const acceptedMove = await moved.json();
  await fixture.reload();
  let movementReactions = 0;
  const reactingEnemies = new Set<string>();
  // Leaving an enemy's reach may accept the move but hold its step until the
  // character decides a real opportunity-hit reaction. HTTP 200 is not proof
  // that the destination has been reached. Resolve that decision in the UI.
  while (fixture.run.combat_state.world.pendingResolution?.request.type === 'reaction') {
    expect(movementReactions, 'Each adjacent training opponent has at most one opportunity reaction').toBeLessThan(adjacentEnemies.length);
    const heldMovement = fixture.run.combat_state;
    expect(heldMovement.world.pendingResolution.request.actorId).toBe(actorId);
    expect(heldMovement.world.pendingResolution.type).toBe('attack_reaction');
    expect(heldMovement.world.pendingResolution.attackRoll.outcome).toBe('hit');
    expect(heldMovement.world.pendingResolution.attackRoll.outcomeOverride?.outcome).toBe('hit');
    const reactingEnemy = heldMovement.world.pendingResolution.sourceActorId;
    expect(adjacentEnemies.some(actor => actor.id === reactingEnemy)).toBe(true);
    expect(reactingEnemies.has(reactingEnemy), 'The same enemy must not reopen its accepted opportunity reaction').toBe(false);
    reactingEnemies.add(reactingEnemy);
    expect(heldMovement.tokens[actorId].position).toEqual(oldPosition);
    const heldBeforeReload = hash(heldMovement);
    await page.reload();
    const reaction = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Пропустить', exact: true }) });
    await expect(reaction).toBeVisible();
    await fixture.reload();
    expect(hash(fixture.run.combat_state), 'A page reload must preserve the held movement').toBe(heldBeforeReload);
    const reactionResponse = page.waitForResponse(response => response.request().method() === 'POST'
      && response.url().endsWith(`/api/roguelike/runs/${fixture.run.id}/commands`)
      && response.request().postDataJSON()?.payload?.intent?.type === 'reaction');
    await reaction.getByRole('button', { name: 'Пропустить', exact: true }).click();
    const declined = await reactionResponse; expect(declined.status()).toBe(200);
    expect(declined.request().postDataJSON().payload.intent).toEqual({ type: 'reaction', response: { kind: 'reaction', actionId: null } });
    movementReactions++;
    await fixture.reload();
  }
  expect(fixture.run.combat_state.tokens[actorId].position).toEqual({ x: destination.x, y: destination.y });
  expect(fixture.run.combat_state.movementRemainingFt[actorId]).toBeLessThan(oldMovement);
  if (movementOutcome === 'hit') expect(movementReactions, 'Declared hit fixture must exercise the saved reaction continuation').toBeGreaterThan(0);
  else expect(movementReactions, 'Declared miss fixture must finish without a hit reaction').toBe(0);
  const oldLogs = new Set(movementState.log.map((entry: any) => entry.id));
  const opportunityRolls = fixture.run.combat_state.log.filter((entry: any) => !oldLogs.has(entry.id))
    .flatMap((entry: any) => entry.records ?? []).filter((record: any) => adjacentEnemies.some(actor => actor.id === record.sourceActorId)
      && record.targetIds.includes(actorId) && record.event?.type === 'roll' && record.event.roll.target?.type === 'ac')
    .map((record: any) => record.event.roll);
  expect(opportunityRolls.length, 'Movement must execute an authoritative opportunity attack even in the direct/miss branch').toBeGreaterThan(0);
  for (const roll of opportunityRolls) {
    expect(roll.outcome).toBe(movementOutcome);
    expect(roll.outcomeOverride?.outcome).toBe(movementOutcome);
    expect(roll.outcomeOverride?.rule).toMatchObject({kind: 'modifier', op: 'outcome', value: movementOutcome,
      natural: {min: 1, max: 20}, applies_to: {roll: 'attack'}});
    expect(roll.dice.some((die: any) => die.sides === 20 && die.result >= 1 && die.result <= 20), 'Training modifier must retain a real rolled d20').toBe(true);
  }
  const movementAfter = hash(await readRunInvariant(api.local, fixture.run.id, moveRequest.command_id));
  expect(hash(await api.request('POST', `/roguelike/runs/${fixture.run.id}/commands`, moveRequest))).toBe(hash(acceptedMove));
  expect(hash(await readRunInvariant(api.local, fixture.run.id, moveRequest.command_id)), 'Repeating the original move must not move or spend again').toBe(movementAfter);
  await testInfo.attach('movement-completion', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
    declaredOutcome: movementOutcome, destination: { x: destination.x, y: destination.y }, oldPosition, movementReactions,
    movementBefore: oldMovement, movementAfter: fixture.run.combat_state.movementRemainingFt[actorId],
    acceptedPendingType: acceptedMove.run.combat_state.world.pendingResolution?.type ?? null,
    committedOpportunityOutcomes: opportunityRolls.map((roll: any) => roll.outcome),
  })) });
  // Leave the page while creating the held action, avoiding presentation
  // automation competing with explicit test commands.
  await page.goto('/roguelike');
  // Return through the same authoritative movement command to retain the
  // original ranged line of sight; movement must still be paid both ways.
  await fixture.command('combat_intent', { intent: { type: 'move', actorId, destination: oldPosition } });
  expect(fixture.run.combat_state.tokens[actorId].position).toEqual(oldPosition);
  const state = fixture.run.combat_state;
  const actor = state.world.actors[state.characterId];
  const action = state.catalogActions.find((row: any) => row.mechanics?.primitive?.type === 'weapon_attack'
    && row.mechanics.effects?.some((effect: any) => effect.attack_kind === 'weapon_ranged'));
  expect(Boolean(action), 'Canonical data must expose a ranged weapon attack').toBe(true);
  const targets: any[] = Object.values(state.world.actors).filter((row: any) => row.kind === 'monster' && row.runtime.hp.current > 0);
  const target = targets.find(row => combatApproachRoute(state, actor.id, row.id, combatActionRangeFt(state, actor.id, action))?.available);
  expect(Boolean(target), 'Attack setup must have a canonical available approach route').toBe(true);
  expect(state.world.pendingResolution?.type ?? null).toBe(null);
  expect(state.pendingD20Interrupt?.operation ?? null).toBe(null);
  const resourcesBefore = structuredClone(actor.runtime.resources);
  const inventoryBefore = structuredClone(actor.runtime.inventory);
  const targetHP = hash(target.runtime.hp);
  await fixture.command('combat_intent', { intent: { type: 'approach_action', actorId: actor.id, actionId: action.id, targetActorId: target.id } });
  const held = fixture.run.combat_state.pendingD20Interrupt;
  expect(held?.operation).toBe('roll_influence');
  expect(hash(fixture.run.combat_state.world.actors[target.id].runtime.hp), 'Target damage must wait for the held choice').toBe(targetHP);
  const heldHash = hash(held);
  const beforeForgery = hash(fixture.run.combat_state);
  const privateBeforeForgery = await readRunInvariant(api.local, fixture.run.id);
  await api.request('POST', `/roguelike/runs/${fixture.run.id}/commands`, {
    command_id: randomUUID(), expected_revision: fixture.run.revision, type: 'combat_intent',
    payload: { intent: { type: 'd20_interrupt', actorId: actor.id, effectId: 'forged-local-influence' } },
  }, 409);
  await fixture.reload(); expect(hash(fixture.run.combat_state)).toBe(beforeForgery);
  expect(hash(await readRunInvariant(api.local, fixture.run.id))).toBe(hash(privateBeforeForgery));

  await page.goto(`/characters-v3/${fixture.run.character_id}/combat?roguelike=${fixture.run.id}`);
  const influences = page.getByRole('region', { name: 'Повлиять на бросок', exact: true });
  const reroll = influences.getByRole('button').first();
  await expect(reroll).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByText('Результат ещё не подтверждён', { exact: true })).toBeVisible();
  await page.reload(); await expect(reroll).toBeEnabled({ timeout: 30_000 });
  await fixture.reload(); expect(hash(fixture.run.combat_state.pendingD20Interrupt)).toBe(heldHash);
  await expect(reroll).toHaveClass(/sheet-item-row/);
  await reroll.hover(); await expect(page.locator('.forge-effect-popover .sp-tip')).toBeVisible();
  await page.mouse.move(5, 5);
  await page.locator('.combat-roll-details summary').click();
  await expect(page.getByLabel('Расчёт КД цели', { exact: true })).not.toContainText('не сохранена');

  // Lose the response only AFTER the real backend accepted the command. No
  // fabricated API success is ever supplied to this browser test.
  let accepted: any;
  await page.route(`**/api/roguelike/runs/${fixture.run.id}/commands`, async route => {
    const request = route.request().postDataJSON();
    if (accepted || request.payload?.intent?.type !== 'd20_interrupt' || !request.payload.intent.effectId) return route.fallback();
    const response = await route.fetch();
    if (!response.ok()) throw new Error(`Real influence rejected: HTTP ${response.status()}`);
    accepted = { request, result: await response.json() };
    await route.abort('connectionreset');
  });
  await reroll.click();
  await expect.poll(() => Boolean(accepted)).toBe(true);
  const savedAfter = (await api.request('GET', `/roguelike/runs/${fixture.run.id}`)).run;
  const privateAfter = await readRunInvariant(api.local, fixture.run.id, accepted.request.command_id);
  expect(privateAfter.command_receipts).toBe(1);
  expect(hash(await api.request('POST', `/roguelike/runs/${fixture.run.id}/commands`, accepted.request))).toBe(hash(accepted.result));
  const reloaded = (await api.request('GET', `/roguelike/runs/${fixture.run.id}`)).run;
  expect(hash(reloaded)).toBe(hash(savedAfter));
  expect(hash(await readRunInvariant(api.local, fixture.run.id, accepted.request.command_id))).toBe(hash(privateAfter));
  const chosenId = accepted.request.payload.intent.effectId;
  expect(held.responders.some((row: any) => row.effectId === chosenId), 'The selected UI action must be an authoritative offered action').toBe(true);
  const coreActions = JSON.parse(readFileSync(new URL('../src/engine/data/rollInfluences.json', import.meta.url), 'utf8'));
  const chosen = coreActions.find((row: any) => row.id === chosenId) ?? state.catalogActions.find((row: any) => row.id === chosenId)?.mechanics;
  expect(Boolean(chosen?.activation?.cost), 'Influence cost must come from its canonical declaration').toBe(true);
  const afterActor = reloaded.combat_state.world.actors[actor.id];
  for (const cost of chosen.activation.cost) {
    expect(afterActor.runtime.resources[cost.resource]).toBe(resourcesBefore[cost.resource] - Number(cost.amount ?? 1));
  }
  const changedInventory = inventoryBefore.filter((row: any) => {
    const after = afterActor.runtime.inventory.find((item: any) => item.cardId === row.cardId);
    return Number(after?.qty ?? 0) !== Number(row.qty);
  });
  expect(changedInventory.length, 'A ranged attack spends exactly one ammunition kind').toBe(1);
  const ammunition = changedInventory[0];
  expect(afterActor.runtime.inventory.find((row: any) => row.cardId === ammunition.cardId)?.qty ?? 0).toBe(ammunition.qty - 1);
  await page.reload(); await expect(influences).toHaveCount(0);
  expect(reloaded.combat_state.outcome).toBe('active');
    const endTurn = page.getByRole('button', { name: 'Завершить ход', exact: true });
    await expect(endTurn).toBeEnabled();
    const endResponse = page.waitForResponse(response => response.request().method() === 'POST'
      && response.url().endsWith(`/api/roguelike/runs/${fixture.run.id}/commands`)
      && response.request().postDataJSON()?.payload?.intent?.type === 'end_turn');
    await endTurn.click();
    const ended = await endResponse; expect(ended.status()).toBe(200);
    expect((await readRunInvariant(api.local, fixture.run.id, ended.request().postDataJSON().command_id)).command_receipts).toBe(1);
  await fixture.verifySource(); checkErrors();
});
}

test('S10 real victory grants rewards once and returns to the same camp after reload', async ({ page, api }) => {
  const checkErrors = watchPageErrors(page); await signIn(page, api);
  await page.addInitScript(() => localStorage.setItem('site-settings', JSON.stringify({ combatRollMode: 'skip', enemyCombatRollMode: 'skip', dice3d: false, audioEnabled: false })));
  const fixture = await createRun(api, 'archer');
  await initializeFixtureEncounter(api, fixture, 'passive');
  let attacks = 0;
  // Real rolls remain random. Passive one-HP catalog creatures make this a
  // bounded combat-to-victory scenario without an opposing damage race.
  for (let step = 0; step < 80 && fixture.run.combat_state.outcome === 'active'; step++) {
    const state = fixture.run.combat_state;
    let intent = declinePendingIntent(state);
    if (!intent) {
      const actor = state.world.actors[state.characterId];
      if (actor.runtime.resources.action === 0) intent = { type: 'end_turn', actorId: actor.id };
      else {
        const action = state.catalogActions.find((row: any) => row.mechanics?.primitive?.type === 'weapon_attack'
          && row.mechanics.effects?.some((effect: any) => effect.attack_kind === 'weapon_ranged'));
        const target: any = Object.values(state.world.actors).find((row: any) => row.kind === 'monster' && row.runtime.hp.current > 0);
        expect(Boolean(action && target)).toBe(true);
        intent = { type: 'approach_action', actorId: actor.id, actionId: action.id, targetActorId: target.id }; attacks++;
      }
    }
    await fixture.command('combat_intent', { intent });
  }
  expect(attacks).toBeGreaterThan(0); expect(fixture.run.combat_state.outcome).toBe('victory');
  await page.goto(`/characters-v3/${fixture.run.character_id}/combat?roguelike=${fixture.run.id}`);
  await expect(page.getByRole('heading', { name: 'Награда за победу', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Вернуться в лагерь', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/roguelike/${fixture.run.id}$`));
  await fixture.reload(); expect(fixture.run.phase).toBe('camp'); expect(fixture.run.encounters_won).toBe(1);
  expect(fixture.run.experience).toBeGreaterThan(0);
  const rewarded = hash(fixture.run), evidence = hash(await readRunInvariant(api.local, fixture.run.id));
  await page.reload(); await expect(page).toHaveURL(new RegExp(`/roguelike/${fixture.run.id}$`));
  await fixture.reload(); expect(hash(fixture.run)).toBe(rewarded);
  expect(hash(await readRunInvariant(api.local, fixture.run.id))).toBe(evidence);
  await fixture.verifySource(); checkErrors();
});
