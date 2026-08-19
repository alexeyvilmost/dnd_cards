import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseWeaponProfile, weaponAttackMode } from '../src/engine/weaponProfile';
import type { Card } from '../src/types';
import { installForgeApiFixture, type ForgeApiFixture } from './forge-api-fixture';

type JsonRecord = Record<string, unknown>;

interface CompiledRoot {
  draft: JsonRecord & {
    systemId: string;
    rulesetVersion: string;
    characterType: string;
    characterSchemaVersion: number;
    raceId: string;
    lineageId: string | null;
    classId: string;
    backgroundId: string;
    level: number;
    featIds: string[];
    spellIds: string[];
    actionIds: string[];
    effectIds: string[];
    resourceIds: string[];
    resolvedChoices: Record<string, string[]>;
  };
  actor: {
    ac?: number;
    character: {
      abilityScores: JsonRecord;
      skillProficiencies: string[];
      skillExpertise: string[];
      saveProficiencies: string[];
      characterSpeed: number;
      profBonus: number;
    };
    runtime: {
      hp: { current: number; max: number };
      resources: JsonRecord;
      maxResources: JsonRecord;
      equipment: JsonRecord;
      inventory: unknown[];
      activeEffects: unknown[];
    };
    spellcastingAccess?: {
      grants: Array<{
        actionId: string;
        sourceId: string;
        access: string;
        level: number;
        spellcastingAbility: string;
        slotResource?: string;
      }>;
      preparedSources: Record<string, {
        sourceId: string;
        capacity: number;
        availableActionIds: string[];
        preparedActionIds: string[];
      }>;
    };
  };
}

interface CertifiedBrowserAction {
  id: string;
  name: string;
  mechanics: JsonRecord;
  sourceEntityIds: string[];
  spell?: { sourceClass?: string };
}

interface CertifiedAccessSignature {
  grants: Array<{
    actionId: string;
    sourceId: string;
    access: string;
    level: number;
    spellcastingAbility: string;
    slotResource?: string | null;
  }>;
  preparedSources: Array<{
    sourceId: string;
    capacity: number;
    availableActionIds: string[];
    preparedActionIds: string[];
  }>;
}

const compiled = JSON.parse(readFileSync(new URL(
  '../src/pages/rulesLabFixture.generated.json',
  import.meta.url,
), 'utf8')) as {
  source: { ruleset: JsonRecord };
  roots: {
    wizard: CompiledRoot;
    fighter: CompiledRoot;
    magicInitiateFighter: CompiledRoot;
  };
};

const sheetCombatCertification = JSON.parse(readFileSync(new URL(
  '../src/character/sheetCombatCertification.generated.json',
  import.meta.url,
), 'utf8')) as {
  actions: CertifiedBrowserAction[];
  accessSignaturesByAction: Record<string, CertifiedAccessSignature[]>;
};

const IDS = {
  source: '11111111-1111-4111-8111-111111111111',
  target: '22222222-2222-4222-8222-222222222222',
};

function primitive(action: { mechanics: JsonRecord }): string {
  const value = action.mechanics.primitive;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? String((value as JsonRecord).type ?? '')
    : '';
}

function fixtureActionId(api: ForgeApiFixture, type: string): string {
  const matches = api.getCatalogRows('actions').filter((row) => (
    primitive({ mechanics: (row.mechanics ?? {}) as JsonRecord }) === type
  ));
  if (matches.length !== 1 || typeof matches[0].id !== 'string') {
    throw new Error(`Materialized action catalog has ${matches.length} ${type} rows`);
  }
  return matches[0].id;
}

function samePreparedSource(
  left: CertifiedAccessSignature['preparedSources'][number] | undefined,
  right: CertifiedAccessSignature['preparedSources'][number] | undefined,
): boolean {
  return left !== undefined && right !== undefined
    && JSON.stringify(left) === JSON.stringify(right);
}

/**
 * The sheet row uses the raw Spell entity id, while canonical combat executes
 * the source-scoped certified action id. Resolve and validate both identities
 * from the generated certification plus this server's exact materialized row.
 */
function certifiedWizardSpellBinding(
  api: ForgeApiFixture,
  type: string,
): { sheetActionId: string; certifiedActionId: string } {
  const sourceId = 'CLASS-wizard';
  const actions = sheetCombatCertification.actions.filter((action) => (
    primitive(action) === type && action.spell?.sourceClass === sourceId
  ));
  if (actions.length !== 1) {
    throw new Error(`Certified sheet combat catalog has ${actions.length} Wizard ${type} actions`);
  }
  const action = actions[0];
  const root = compiled.roots.wizard;
  if (!action.sourceEntityIds.includes(root.draft.classId)) {
    throw new Error(`Certified ${type} action is not sourced by the fixture Wizard class`);
  }

  const sourceRows = api.getCatalogRows('spells').filter((row) => (
    typeof row.id === 'string'
    && action.sourceEntityIds.includes(row.id)
    && primitive({ mechanics: (row.mechanics ?? {}) as JsonRecord }) === type
  ));
  if (sourceRows.length !== 1 || typeof sourceRows[0].id !== 'string') {
    throw new Error(`Materialized spell catalog has ${sourceRows.length} certified ${type} sources`);
  }
  const sheetActionId = sourceRows[0].id;
  if (!root.draft.spellIds.includes(sheetActionId)) {
    throw new Error(`Fixture Wizard does not grant the certified ${type} source spell`);
  }

  const access = root.actor.spellcastingAccess;
  const rootGrant = access?.grants.find((grant) => (
    grant.actionId === action.id && grant.sourceId === sourceId
  ));
  const rootPrepared = access?.preparedSources[sourceId];
  const signatures = sheetCombatCertification.accessSignaturesByAction[action.id] ?? [];
  const matchingSignatures = signatures.filter((signature) => {
    const certifiedGrant = signature.grants.find((grant) => (
      grant.actionId === action.id && grant.sourceId === sourceId
    ));
    const certifiedPrepared = signature.preparedSources.find((source) => (
      source.sourceId === sourceId
    ));
    return rootGrant !== undefined
      && certifiedGrant !== undefined
      && certifiedGrant.access === rootGrant.access
      && certifiedGrant.level === rootGrant.level
      && certifiedGrant.spellcastingAbility === rootGrant.spellcastingAbility
      && (certifiedGrant.slotResource ?? undefined) === rootGrant.slotResource
      && samePreparedSource(certifiedPrepared, rootPrepared);
  });
  if (matchingSignatures.length !== 1 || !rootPrepared?.preparedActionIds.includes(action.id)) {
    throw new Error(`Fixture Wizard grant/prepared provenance is not certified for ${type}`);
  }
  const selectedByDraft = Object.values(root.draft.resolvedChoices)
    .filter((values) => values.includes(sheetActionId));
  if (selectedByDraft.length < 2) {
    throw new Error(`Fixture Wizard draft does not select ${type} in spellbook and preparation`);
  }
  return { sheetActionId, certifiedActionId: action.id };
}

function certifiedMagicInitiateSpellBinding(
  api: ForgeApiFixture,
  type: string,
): { sheetActionId: string; certifiedActionId: string } {
  const sourceId = 'FEAT-0009';
  const root = compiled.roots.magicInitiateFighter;
  const actions = sheetCombatCertification.actions.filter((action) => (
    primitive(action) === type
    && root.draft.featIds.some((featId) => action.sourceEntityIds.includes(featId))
  ));
  if (actions.length !== 1) {
    throw new Error(`Certified sheet combat catalog has ${actions.length} Magic Initiate ${type} actions`);
  }
  const action = actions[0];
  const sourceRows = api.getCatalogRows('spells').filter((row) => (
    typeof row.id === 'string'
    && action.sourceEntityIds.includes(row.id)
    && primitive({ mechanics: (row.mechanics ?? {}) as JsonRecord }) === type
  ));
  if (sourceRows.length !== 1 || typeof sourceRows[0].id !== 'string') {
    throw new Error(`Materialized spell catalog has ${sourceRows.length} Magic Initiate ${type} sources`);
  }
  const sheetActionId = sourceRows[0].id;
  const grant = root.actor.spellcastingAccess?.grants.find((candidate) => (
    candidate.actionId === action.id && candidate.sourceId === sourceId
  ));
  const signatures = sheetCombatCertification.accessSignaturesByAction[action.id] ?? [];
  const matching = signatures.filter((signature) => signature.grants.some((candidate) => (
    grant !== undefined
    && candidate.actionId === grant.actionId
    && candidate.sourceId === grant.sourceId
    && candidate.access === grant.access
    && candidate.level === grant.level
    && candidate.spellcastingAbility === grant.spellcastingAbility
    && (candidate.slotResource ?? undefined) === grant.slotResource
  )));
  if (!root.draft.spellIds.includes(sheetActionId) || !grant || matching.length !== 1) {
    throw new Error(`Fixture Fighter / Magic Initiate access is not certified for ${type}`);
  }
  return { sheetActionId, certifiedActionId: action.id };
}

function rangedWeaponFixture(api: ForgeApiFixture): {
  weapon: Card;
  ammo: Card;
  longFt: number;
} {
  const cards = api.getCatalogRows('cards') as unknown as Card[];
  for (const weapon of cards) {
    if (weapon.type !== 'weapon') continue;
    const parsed = parseWeaponProfile(weapon);
    if (!parsed.valid || parsed.profile.defaultAttackMode !== 'ranged' || !parsed.profile.ammo) continue;
    const ranged = weaponAttackMode(parsed.profile, 'ranged');
    if (!ranged || ranged.kind !== 'ranged') continue;
    const ammo = cards.find((card) => card.id === parsed.profile.ammo?.cardId);
    if (ammo) return { weapon, ammo, longFt: ranged.longFt };
  }
  throw new Error('Materialized card catalog has no reachable ranged weapon/ammo profile');
}

function character(root: CompiledRoot, id: string, name: string): JsonRecord {
  return {
    id,
    name,
    system_id: root.draft.systemId,
    ruleset_version: root.draft.rulesetVersion,
    character_type: root.draft.characterType,
    character_schema_version: root.draft.characterSchemaVersion,
    race_id: root.draft.raceId,
    lineage_id: root.draft.lineageId,
    class_id: root.draft.classId,
    background_id: root.draft.backgroundId,
    level: root.draft.level,
    feat_ids: root.draft.featIds,
    spell_ids: root.draft.spellIds,
    action_ids: root.draft.actionIds,
    effect_ids: root.draft.effectIds,
    resource_ids: root.draft.resourceIds,
    abilities: root.actor.character.abilityScores,
    skill_proficiencies: root.actor.character.skillProficiencies,
    skill_expertise: root.actor.character.skillExpertise,
    saving_throw_proficiencies: root.actor.character.saveProficiencies,
    resolved_choices: root.draft.resolvedChoices,
    max_hp: root.actor.runtime.hp.max,
    current_hp: root.actor.runtime.hp.current,
    speed: root.actor.character.characterSpeed,
    proficiency_bonus: root.actor.character.profBonus,
    armor_class: root.actor.ac,
    equipment: root.actor.runtime.equipment,
    inventory_items: root.actor.runtime.inventory,
    resources: root.actor.runtime.resources,
    max_resources: root.actor.runtime.maxResources,
    active_effects: root.actor.runtime.activeEffects,
    turn_state: {},
    currency: { gold: 0, silver: 0, copper: 0 },
  };
}

function seedPreviousDeploymentCanonicalCache(value: JsonRecord): void {
  value.turn_state = {
    temp_hp: 0,
    canonical_rules_world_v1: {
      schemaVersion: 1,
      primaryActorId: value.id,
      rulesetContentHash: 'sheet:previous-deployment',
      // A stale envelope is discarded before its release-specific world is
      // decoded. This reproduces a real CharacterV3 sheet left by an older UI.
      world: {},
    },
  };
}

async function dismissMobileSuggestion(page: Page): Promise<void> {
  const suggestion = page.getByRole('complementary', { name: 'Предложение мобильной версии' });
  if (await suggestion.isVisible()) {
    await suggestion.getByRole('button', { name: 'Не сейчас', exact: true }).click();
  }
}

async function declareTarget(
  page: Page,
  targetName: string,
  dartCount?: number,
): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Цели и факты боя' });
  await expect(dialog).toBeVisible();
  const fieldset = dialog.locator('fieldset').filter({ hasText: targetName });
  await fieldset.getByRole('checkbox').check();
  const horizontalLayout = await dialog.evaluate((element) => {
    const dialogBox = element.getBoundingClientRect();
    const controls = [...element.querySelectorAll('input, select')]
      .filter((control) => (control as HTMLElement).offsetParent !== null)
      .map((control) => control.getBoundingClientRect());
    return {
      scrollOverflow: element.scrollWidth - element.clientWidth,
      nestedGenericLists: element.querySelectorAll('fieldset.dice-dialog-list').length,
      controlsWithinDialog: controls.every((box) => (
        box.left >= dialogBox.left - 1 && box.right <= dialogBox.right + 1
      )),
    };
  });
  expect(horizontalLayout).toEqual({
    scrollOverflow: 0,
    nestedGenericLists: 0,
    controlsWithinDialog: true,
  });
  const selects = fieldset.getByRole('combobox');
  await selects.nth(0).selectOption('enemy');
  await selects.nth(1).selectOption('scenario');
  await selects.nth(2).selectOption('yes');
  await selects.nth(3).selectOption('none');
  const numbers = fieldset.locator('input[type="number"]');
  await numbers.nth(0).fill('10');
  await numbers.nth(1).fill('0');
  if (dartCount !== undefined) await numbers.nth(2).fill(String(dartCount));
  await dialog.getByRole('button', { name: 'Подтвердить цели' }).click();
}

async function declareTrainingDummy(page: Page, distanceFt: number): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Цели и факты боя' });
  await expect(dialog).toBeVisible();
  const fieldset = dialog.locator('[data-target-id="scene-target:training-dummy"]');
  await expect(fieldset).toContainText('Пугало');
  await expect(fieldset.getByRole('checkbox')).toBeChecked();
  await expect(fieldset.getByRole('combobox')).toHaveCount(0);
  const distance = fieldset.locator('input[type="number"]');
  await expect(distance).toHaveCount(1);
  await distance.fill(String(distanceFt));
  await dialog.getByRole('button', { name: 'Подтвердить цели' }).click();
}

async function openPendingSpell(
  page: Page,
  api: ForgeApiFixture,
  type: string,
  options: { loseResponse?: boolean; darts?: number } = {},
): Promise<JsonRecord> {
  const binding = certifiedWizardSpellBinding(api, type);
  await page.goto(`/characters-v3/${IDS.source}`);
  await dismissMobileSuggestion(page);
  const button = page.locator(`[data-action-id="${binding.sheetActionId}"]`)
    .getByRole('button')
    .filter({ visible: true })
    .first();
  await expect(button).toBeVisible({ timeout: 30_000 });
  await expect(button).toBeEnabled({ timeout: 30_000 });
  if (options.loseResponse) api.loseNextRuntimeCommandResponse();
  await button.click();
  const cast = page.getByRole('dialog', { name: 'Выбор при действии' });
  await expect(cast).toBeVisible();
  await cast.getByRole('button', { name: 'Применить', exact: true }).click();
  await declareTarget(page, 'Target', options.darts);
  if (options.loseResponse) {
    const retry = page.getByTestId('sheet-combat-retry').first();
    await expect(retry).toBeVisible();
    await retry.getByRole('button', { name: 'Безопасно повторить' }).click();
  }
  await expect.poll(() => Number(api.getCharacter(IDS.source)?.runtime_revision)).toBe(1);
  const request = api.runtimeCommandRequests[0];
  expect(request.ruleset_ref).toEqual({
    system_id: compiled.source.ruleset.systemId,
    release_id: compiled.source.ruleset.releaseId,
    content_hash: compiled.source.ruleset.contentHash,
    errata_version: compiled.source.ruleset.errataVersion,
  });
  expect(JSON.stringify(request)).toContain(binding.certifiedActionId);
  expect((request.participants as JsonRecord[]).map((row) => row.character_id)).toEqual([
    IDS.source,
    IDS.target,
  ]);
  expect((request.participants as JsonRecord[]).every((row) => {
    const patch = row.patch as JsonRecord;
    const turnState = patch.turn_state as JsonRecord;
    return !!turnState.canonical_pending_combat_v1;
  })).toBe(true);
  expect(api.runtimePatchRequests).toHaveLength(0);
  return request;
}

test.describe('real CharacterV3 sheet pending-combat bridge', () => {
  test('Magic Initiate Fighter attacks the scene dummy from a real sheet without catalog poisoning', async ({ page }) => {
    const api = await installForgeApiFixture(page);
    await page.addInitScript(() => {
      Math.random = () => 0.99;
    });
    const { weapon, ammo } = rangedWeaponFixture(api);
    const weaponActionId = fixtureActionId(api, 'weapon_attack');
    const source = character(compiled.roots.magicInitiateFighter, IDS.source, 'Magic Archer');
    seedPreviousDeploymentCanonicalCache(source);
    source.equipment = { main_hand: weapon.id };
    source.inventory_items = [
      { card_id: weapon.id, qty: 1 },
      { card_id: ammo.id, qty: 3 },
    ];
    api.seedCharacter(source);

    await page.goto(`/characters-v3/${IDS.source}`);
    await dismissMobileSuggestion(page);
    const button = page.locator(`[data-action-id="${weaponActionId}"]`).getByRole('button');
    await expect(button).toBeEnabled({ timeout: 30_000 });
    await button.click();
    await declareTrainingDummy(page, 30);

    await expect.poll(() => Number(api.getCharacter(IDS.source)?.runtime_revision)).toBe(1);
    expect(api.runtimeCommandRequests).toHaveLength(1);
    expect((api.runtimeCommandRequests[0].participants as JsonRecord[]).map((row) => (
      row.character_id
    ))).toEqual([IDS.source]);
    expect(api.getCharacter(IDS.source)?.inventory_items).toEqual([
      { card_id: weapon.id, qty: 1 },
      { card_id: ammo.id, qty: 2 },
    ]);
    await expect(page.getByTestId('sheet-action-error')).toHaveCount(0);
    const turnState = api.getCharacter(IDS.source)?.turn_state as JsonRecord;
    const continuation = turnState.canonical_pending_combat_v1 as JsonRecord;
    const world = continuation.world as JsonRecord;
    const actors = world.actors as Record<string, JsonRecord>;
    expect(actors['scene-target:training-dummy']).toMatchObject({ name: 'Пугало', ac: 10 });
    expect(((actors['scene-target:training-dummy'].runtime as JsonRecord).hp as JsonRecord).current)
      .toBeLessThan(100);
  });

  test('Thunderwave selected by a Magic Initiate Fighter is usable against the scene dummy', async ({ page }) => {
    const api = await installForgeApiFixture(page);
    const source = character(compiled.roots.magicInitiateFighter, IDS.source, 'Thunder Fighter');
    seedPreviousDeploymentCanonicalCache(source);
    api.seedCharacter(source);
    const binding = certifiedMagicInitiateSpellBinding(api, 'area_object_push');

    await page.goto(`/characters-v3/${IDS.source}`);
    await dismissMobileSuggestion(page);
    const button = page.locator(`[data-action-id="${binding.sheetActionId}"]`)
      .getByRole('button')
      .filter({ visible: true })
      .first();
    await expect(button).toBeEnabled({ timeout: 30_000 });
    await button.click();
    const cast = page.getByRole('dialog', { name: 'Выбор при действии' });
    await expect(cast).toBeVisible();
    await cast.getByRole('button', { name: 'Применить', exact: true }).click();
    await declareTrainingDummy(page, 10);

    await expect.poll(() => Number(api.getCharacter(IDS.source)?.runtime_revision)).toBe(1);
    expect((api.runtimeCommandRequests[0].participants as JsonRecord[]).map((row) => (
      row.character_id
    ))).toEqual([IDS.source]);
    const save = page.getByTestId('sheet-combat-target-save').first();
    await expect(save).toBeVisible({ timeout: 30_000 });
    await expect(save).toContainText('Пугало');
    await save.getByRole('spinbutton', { name: 'Результат d20 спасброска' }).fill('1');
    await save.getByRole('button', { name: 'Применить d20' }).click();
    await expect.poll(() => Number(api.getCharacter(IDS.source)?.runtime_revision)).toBe(2);
    const turnState = api.getCharacter(IDS.source)?.turn_state as JsonRecord;
    const continuation = turnState.canonical_pending_combat_v1 as JsonRecord;
    const actors = ((continuation.world as JsonRecord).actors) as Record<string, JsonRecord>;
    expect(((actors['scene-target:training-dummy'].runtime as JsonRecord).hp as JsonRecord).current)
      .toBeLessThan(100);
    await expect(page.getByTestId('sheet-action-error')).toHaveCount(0);
  });

  test('unarmed strike uses the same scene-target declaration before its roll', async ({ page }) => {
    const api = await installForgeApiFixture(page);
    api.seedCharacter(character(compiled.roots.fighter, IDS.source, 'Brawler'));
    const unarmed = api.getCatalogRows('actions').find((row) => (
      row.card_number === 'action_basic_unarmed'
    ));
    if (typeof unarmed?.id !== 'string') throw new Error('Unarmed Strike action is missing');

    await page.goto(`/characters-v3/${IDS.source}`);
    await dismissMobileSuggestion(page);
    const button = page.locator(`[data-action-id="${unarmed.id}"]`).getByRole('button');
    await expect(button).toBeEnabled({ timeout: 30_000 });
    await button.click();
    await declareTrainingDummy(page, 5);
    const roll = page.getByRole('dialog', { name: 'Бросок кубов' });
    await expect(roll).toBeVisible();
    await roll.getByRole('button', { name: 'Автобросок' }).click();

    await expect.poll(() => api.runtimePatchRequests.length).toBe(1);
    expect((api.getCharacter(IDS.source)?.resources as JsonRecord).action).toBe(0);
    await expect(page.getByTestId('sheet-action-error')).toHaveCount(0);
  });

  test('Dash, Disengage persistence and Dodge execute from their real basic-action rows', async ({ page }) => {
    const api = await installForgeApiFixture(page);
    for (const [index, cardNumber] of [
      'action_basic_dash',
      'action_basic_disengage',
      'action_basic_dodge',
    ].entries()) {
      const row = api.getCatalogRows('actions').find((candidate) => (
        candidate.card_number === cardNumber
      ));
      if (typeof row?.id !== 'string') throw new Error(`${cardNumber} is missing`);
      const source = character(compiled.roots.fighter, IDS.source, `Basic ${index}`);
      api.seedCharacter(source);
      const requestCount = api.runtimePatchRequests.length;
      await page.goto(`/characters-v3/${IDS.source}`);
      await dismissMobileSuggestion(page);
      const button = page.locator(`[data-action-id="${row.id}"]`).getByRole('button');
      await expect(button).toBeEnabled({ timeout: 30_000 });
      await button.click();
      const confirm = page.getByRole('dialog', { name: 'Подтверждение действия' });
      await expect(confirm).toBeVisible();
      await confirm.getByRole('button', { name: 'Применить', exact: true }).click();
      await expect.poll(() => api.runtimePatchRequests.length).toBe(requestCount + 1);
      expect((api.getCharacter(IDS.source)?.resources as JsonRecord).action).toBe(0);
      await expect(page.getByTestId('sheet-action-error')).toHaveCount(0);
      if (cardNumber === 'action_basic_disengage') {
        expect(api.getCharacter(IDS.source)?.active_effects).toEqual([
          expect.objectContaining({
            name: 'Отход',
            expiry: 'start_of_next_turn',
            mechanics: expect.objectContaining({
              kind: 'modifier',
              op: 'deny',
              applies_to: {
                interaction: 'opportunity_attack',
                trigger: 'self_movement',
              },
            }),
          }),
        ]);
        await page.reload();
        await expect(page.getByText('Отход', { exact: true }).first()).toBeVisible();
        const expiryPatchCount = api.runtimePatchRequests.length;
        await page.getByRole('button', { name: 'Новый ход', exact: true }).click();
        await expect.poll(() => api.runtimePatchRequests.length).toBe(expiryPatchCount + 1);
        expect(api.getCharacter(IDS.source)?.active_effects).toEqual([]);
      }
    }
  });

  test('Help executes from the real sheet row and exposes its certified target limitation', async ({ page }) => {
    const api = await installForgeApiFixture(page);
    api.seedCharacter(character(compiled.roots.fighter, IDS.source, 'Helper'));
    api.seedCharacter(character(compiled.roots.fighter, IDS.target, 'Ally'));
    const help = api.getCatalogRows('actions').find((row) => row.card_number === 'action_help');
    if (typeof help?.id !== 'string') throw new Error('Help action is missing');

    await page.goto(`/characters-v3/${IDS.source}`);
    await dismissMobileSuggestion(page);
    const button = page.locator(`[data-action-id="${help.id}"]`).getByRole('button');
    await expect(button).toBeEnabled({ timeout: 30_000 });
    await button.click();
    const confirm = page.getByRole('dialog', { name: 'Подтверждение действия' });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole('combobox')).toHaveCount(0);
    await confirm.getByRole('button', { name: 'Применить', exact: true }).click();

    await expect.poll(() => api.runtimePatchRequests.length).toBeGreaterThan(0);
    expect((api.getCharacter(IDS.source)?.resources as JsonRecord).action).toBe(0);
    await expect(page.getByTestId('sheet-action-error')).toHaveCount(0);
  });

  test('ranged weapon: dialog facts, atomic Attack, ammo/events and response-loss reload', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 600 });
    const api = await installForgeApiFixture(page);
    await page.addInitScript(() => {
      Math.random = () => 0.99;
    });
    const { weapon, ammo, longFt } = rangedWeaponFixture(api);
    const weaponActionId = fixtureActionId(api, 'weapon_attack');
    const source = character(compiled.roots.fighter, IDS.source, 'Source');
    source.equipment = { main_hand: weapon.id };
    source.inventory_items = [
      { card_id: weapon.id, qty: 1 },
      { card_id: ammo.id, qty: 3 },
    ];
    api.seedCharacter(source);
    api.seedCharacter(character(compiled.roots.fighter, IDS.target, 'Target'));
    const targetHpBefore = Number(api.getCharacter(IDS.target)?.current_hp);

    await page.goto(`/characters-v3/${IDS.source}`);
    await dismissMobileSuggestion(page);
    const line = page.locator(`[data-action-id="${weaponActionId}"]`);
    await expect(line).toBeVisible({ timeout: 30_000 });
    await expect(line.getByText('Дальнобойная атака оружием', { exact: true })).toBeVisible();
    const button = line.getByRole('button');
    await expect(button).toBeEnabled({ timeout: 30_000 });
    api.loseNextRuntimeCommandResponse();
    await button.click();
    const dialog = page.getByRole('dialog', { name: 'Цели и факты боя' });
    await expect(dialog).toContainText(`до ${longFt} фт.`);
    await declareTarget(page, 'Target');

    const retry = page.getByTestId('sheet-combat-retry').first();
    await expect(retry).toBeVisible();
    await expect(page.getByText('Действие не подтверждено сервером', { exact: true }))
      .toBeVisible();
    const committedRequest = api.runtimeCommandRequests[0];
    await retry.getByRole('button', { name: 'Безопасно повторить' }).click();
    await expect.poll(() => Number(api.getCharacter(IDS.source)?.runtime_revision)).toBe(1);
    expect(api.runtimeCommandRequests).toHaveLength(2);
    expect(api.runtimeCommandRequests[1]).toEqual(committedRequest);
    expect(Number(api.getCharacter(IDS.target)?.runtime_revision)).toBe(1);
    expect(Number(api.getCharacter(IDS.target)?.current_hp)).toBeLessThan(targetHpBefore);
    expect((api.getCharacter(IDS.source)?.resources as JsonRecord).action).toBe(0);
    expect(api.getCharacter(IDS.source)?.inventory_items).toEqual([
      { card_id: weapon.id, qty: 1 },
      { card_id: ammo.id, qty: 2 },
    ]);
    const sourceEvents = api.getEvents(IDS.source);
    const targetEvents = api.getEvents(IDS.target);
    expect(sourceEvents.some((row) => (row.payload as JsonRecord).type === 'resource_spent')).toBe(true);
    expect(sourceEvents.some((row) => (
      (row.payload as JsonRecord).type === 'item_consumed'
      && (row.payload as JsonRecord).cardId === ammo.id
    ))).toBe(true);
    expect(targetEvents.some((row) => (row.payload as JsonRecord).type === 'damage')).toBe(true);
    expect(api.runtimePatchRequests).toHaveLength(0);

    const sourceTurnState = api.getCharacter(IDS.source)?.turn_state as JsonRecord;
    const continuation = sourceTurnState.canonical_pending_combat_v1 as JsonRecord;
    const world = continuation.world as JsonRecord;
    const attackActions = world.attackActions as JsonRecord;
    expect(Object.values(attackActions)).toHaveLength(1);
    expect(Object.values(attackActions)[0]).toMatchObject({
      actorId: IDS.source,
      status: 'completed',
      declaredActionId: weaponActionId,
    });

    const sourceEventCount = sourceEvents.length;
    const targetEventCount = targetEvents.length;
    await page.reload();
    await dismissMobileSuggestion(page);
    await expect(page.locator(`[data-action-id="${weaponActionId}"]`).getByRole('button'))
      .toBeDisabled({ timeout: 30_000 });
    expect(Number(api.getCharacter(IDS.source)?.runtime_revision)).toBe(1);
    expect(api.getCharacter(IDS.source)?.inventory_items).toEqual([
      { card_id: weapon.id, qty: 1 },
      { card_id: ammo.id, qty: 2 },
    ]);
    expect(api.getEvents(IDS.source)).toHaveLength(sourceEventCount);
    expect(api.getEvents(IDS.target)).toHaveLength(targetEventCount);
  });

  for (const [label, type] of [
    ['Burning Hands', 'burning_hands_objects'],
    ['Thunderwave', 'area_object_push'],
  ] as const) {
    test(`${label}: atomic open, idempotent replay, target reload and save`, async ({ page }) => {
      const api = await installForgeApiFixture(page);
      api.seedCharacter(character(compiled.roots.wizard, IDS.source, 'Source'));
      api.seedCharacter(character(compiled.roots.fighter, IDS.target, 'Target'));
      const hpBefore = Number(api.getCharacter(IDS.target)?.current_hp);
      const first = await openPendingSpell(page, api, type, { loseResponse: true });
      expect(api.runtimeCommandRequests).toHaveLength(2);
      expect(api.runtimeCommandRequests[1]).toEqual(first);

      await page.goto(`/characters-v3/${IDS.target}`);
      await dismissMobileSuggestion(page);
      const save = page.getByTestId('sheet-combat-target-save').first();
      await expect(save).toBeVisible({ timeout: 30_000 });
      await page.reload();
      await expect(page.getByTestId('sheet-combat-target-save').first()).toBeVisible({ timeout: 30_000 });
      const reloaded = page.getByTestId('sheet-combat-target-save').first();
      await reloaded.getByRole('spinbutton', { name: 'Результат d20 спасброска' }).fill('1');
      await reloaded.getByRole('button', { name: 'Применить d20' }).click();
      await expect.poll(() => Number(api.getCharacter(IDS.target)?.current_hp)).toBeLessThan(hpBefore);
      expect(Number(api.getCharacter(IDS.source)?.runtime_revision)).toBe(2);
      expect(Number(api.getCharacter(IDS.target)?.runtime_revision)).toBe(2);
      expect(api.runtimePatchRequests).toHaveLength(0);
      await page.reload();
      await expect(page.getByTestId('sheet-combat-target-save')).toHaveCount(0);
      await expect(page.getByTestId('sheet-combat-turn-state').first()).toBeVisible();
      if (type === 'burning_hands_objects') {
        await page.goto(`/characters-v3/${IDS.source}`);
        await page.getByTestId('sheet-combat-turn-state').first()
          .getByRole('button', { name: 'Завершить ход' }).click();
        await expect.poll(() => Number(api.getCharacter(IDS.target)?.runtime_revision)).toBe(3);
        await page.goto(`/characters-v3/${IDS.target}`);
        await page.getByTestId('sheet-combat-turn-state').first()
          .getByRole('button', { name: 'Начать ход' }).click();
        await expect.poll(() => Number(api.getCharacter(IDS.source)?.runtime_revision)).toBe(4);
      }
    });
  }

  test('Magic Missile: explicit allocation, target reload and exact Shield grant', async ({ page }) => {
    const api = await installForgeApiFixture(page);
    api.seedCharacter(character(compiled.roots.wizard, IDS.source, 'Source'));
    api.seedCharacter(character(compiled.roots.wizard, IDS.target, 'Target'));
    const hpBefore = Number(api.getCharacter(IDS.target)?.current_hp);
    await openPendingSpell(page, api, 'magic_missile', { darts: 3 });
    expect(api.runtimeCommandRequests).toHaveLength(1);

    await page.goto(`/characters-v3/${IDS.target}`);
    await dismissMobileSuggestion(page);
    const reaction = page.getByTestId('sheet-combat-magic-missile-reaction').first();
    await expect(reaction).toBeVisible({ timeout: 30_000 });
    await page.reload();
    const reloaded = page.getByTestId('sheet-combat-magic-missile-reaction').first();
    await expect(reloaded).toBeVisible({ timeout: 30_000 });
    await reloaded.getByRole('button', { name: /Щит|Shield/ }).click();
    await expect.poll(() => Number(api.getCharacter(IDS.target)?.runtime_revision)).toBe(2);
    expect(Number(api.getCharacter(IDS.target)?.current_hp)).toBe(hpBefore);
    const resources = api.getCharacter(IDS.target)?.resources as JsonRecord;
    expect(resources.reaction).toBe(0);
    expect(resources.spell_slot_1).toBe(1);
    expect(api.runtimePatchRequests).toHaveLength(0);
  });
});
