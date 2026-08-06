import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  installForgeApiFixture,
  PERSISTED_SHEET_WEAPON_FIXTURE,
  type ForgeApiFixture,
} from './forge-api-fixture';

type JsonRecord = Record<string, unknown>;

interface CompiledDraftRoot {
  stableKey: string;
  draft: JsonRecord & {
    name: string;
    systemId: string;
    rulesetVersion: string;
    characterSchemaVersion: number;
    raceId: string;
    lineageId: string | null;
    classId: string;
    backgroundId: string;
    level: number;
    featIds: string[];
    resolvedChoices: Record<string, string[]>;
  };
  actor: {
    character: {
      abilityScores: JsonRecord;
      skillProficiencies: string[];
      skillExpertise: string[];
      saveProficiencies: string[];
      characterSpeed: number;
      profBonus: number;
    };
    runtime: { hp: { current: number; max: number } };
  };
}

const compiledFixture = JSON.parse(readFileSync(new URL(
  '../src/pages/rulesLabFixture.generated.json',
  import.meta.url,
), 'utf8')) as {
  source: { ruleset: { releaseId: string } };
  roots: { fighter: CompiledDraftRoot; wizard: CompiledDraftRoot };
};

function captureBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function expectRevision(page: Page, revision: number): Promise<void> {
  await expect(page.getByTestId('rules-lab-revision')).toHaveText(String(revision));
}

async function clickCommand(page: Page, testId: string, revision: number): Promise<void> {
  await page.getByTestId(testId).click();
  await expectRevision(page, revision);
  await expect(page.getByTestId('rules-lab-error')).toHaveCount(0);
}

async function openCachedScenario(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByTestId('rules-lab-page')).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.locator('[data-testid^="rules-lab-actor-"]')).toHaveCount(2);
  const horizontalOverflow = await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ));
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
}

async function createCompiledDraftInForge(
  page: Page,
  draft: JsonRecord,
  expectedCharacterId: string,
): Promise<void> {
  await page.goto('/character-forge');
  await page.evaluate((value) => {
    localStorage.setItem('forge-draft', JSON.stringify(value));
  }, draft);
  await page.reload();
  await expect(page.getByRole('dialog')).toContainText(
    'Продолжить создание незавершённого персонажа?',
  );
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  const mobileSuggestion = page.getByRole('complementary', {
    name: 'Предложение мобильной версии',
  });
  if (await mobileSuggestion.isVisible()) {
    await mobileSuggestion.getByRole('button', { name: 'Не сейчас', exact: true }).click();
  }
  const createButton = page.getByRole('button', { name: 'Создать персонажа', exact: true });
  if (await createButton.count() === 0) {
    await page.getByRole('button', { name: 'Общее', exact: true }).click();
  }
  await expect(createButton).toBeEnabled({ timeout: 15_000 });
  const mobileOverview = page.locator('.forge-editor--overview');
  if (await mobileOverview.isVisible()) {
    await mobileOverview.evaluate((element) => {
      element.scrollTo({ top: element.scrollHeight, behavior: 'instant' });
    });
    const bottomNavigation = page.getByRole('navigation', {
      name: 'Этапы создания персонажа',
    });
    await expect.poll(async () => {
      const [buttonBox, navigationBox] = await Promise.all([
        createButton.boundingBox(),
        bottomNavigation.boundingBox(),
      ]);
      return !!buttonBox && !!navigationBox
        && buttonBox.y + buttonBox.height <= navigationBox.y;
    }).toBe(true);
  }
  await createButton.click();
  await expect(page).toHaveURL(new RegExp(`/characters-v3/${expectedCharacterId}$`));
}

function expectForgePayloadMatchesCompiledRoot(
  payload: JsonRecord,
  root: CompiledDraftRoot,
): void {
  const actor = root.actor;
  expect(payload).toMatchObject({
    name: root.draft.name,
    system_id: root.draft.systemId,
    ruleset_version: root.draft.rulesetVersion,
    character_schema_version: root.draft.characterSchemaVersion,
    race_id: root.draft.raceId,
    lineage_id: root.draft.lineageId,
    class_id: root.draft.classId,
    background_id: root.draft.backgroundId,
    level: root.draft.level,
    feat_ids: root.draft.featIds,
    abilities: actor.character.abilityScores,
    skill_proficiencies: actor.character.skillProficiencies,
    skill_expertise: actor.character.skillExpertise,
    saving_throw_proficiencies: actor.character.saveProficiencies,
    max_hp: actor.runtime.hp.max,
    current_hp: actor.runtime.hp.current,
    speed: actor.character.characterSpeed,
    proficiency_bonus: actor.character.profBonus,
  });
  expect(payload.resolved_choices).toMatchObject(root.draft.resolvedChoices);
}

function exactCatalogEntityId(
  api: ForgeApiFixture,
  collection: string,
  cardNumber: string,
): string {
  const matches = api.getCatalogRows(collection).filter((row) => row.card_number === cardNumber);
  if (matches.length !== 1 || typeof matches[0].id !== 'string') {
    throw new Error(`Materialized ${collection} catalog has ${matches.length} ${cardNumber} rows`);
  }
  return matches[0].id;
}

function exactPrimitiveActionId(api: ForgeApiFixture, type: string): string {
  const matches = api.getCatalogRows('actions').filter((row) => {
    const mechanics = row.mechanics;
    if (!mechanics || typeof mechanics !== 'object' || Array.isArray(mechanics)) return false;
    const primitive = (mechanics as JsonRecord).primitive;
    return primitive && typeof primitive === 'object' && !Array.isArray(primitive)
      && (primitive as JsonRecord).type === type;
  });
  if (matches.length !== 1 || typeof matches[0].id !== 'string') {
    throw new Error(`Materialized action catalog has ${matches.length} ${type} rows`);
  }
  return matches[0].id;
}

async function equipFixtureLongsword(
  page: Page,
  characterId: string,
  cardId: string,
): Promise<void> {
  await page.evaluate(async ({ id, cardId }) => {
    const currentResponse = await fetch(`/api/characters-v3/${id}`);
    if (!currentResponse.ok) throw new Error(`fixture character read failed: ${currentResponse.status}`);
    const current = await currentResponse.json() as {
      equipment?: Record<string, string | null>;
      inventory_items?: Array<{ card_id: string; qty: number }>;
    };
    const inventory = [...(current.inventory_items ?? [])];
    if (!inventory.some((item) => item.card_id === cardId)) {
      inventory.push({ card_id: cardId, qty: 1 });
    }
    const response = await fetch(`/api/characters-v3/${id}/runtime`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        equipment: { ...(current.equipment ?? {}), main_hand: cardId },
        inventory_items: inventory,
      }),
    });
    if (!response.ok) throw new Error(`fixture equipment write failed: ${response.status}`);
  }, { id: characterId, cardId });
}

async function declareSheetTarget(page: Page, targetName: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Цели и факты боя' });
  await expect(dialog).toBeVisible();
  const fieldset = dialog.locator('fieldset').filter({ hasText: targetName });
  await fieldset.getByRole('checkbox').check();
  const selects = fieldset.getByRole('combobox');
  await selects.nth(0).selectOption('enemy');
  await selects.nth(1).selectOption('scenario');
  await selects.nth(2).selectOption('yes');
  await selects.nth(3).selectOption('none');
  const numbers = fieldset.locator('input[type="number"]');
  await numbers.nth(0).fill('5');
  await numbers.nth(1).fill('0');
  await dialog.getByRole('button', { name: 'Подтвердить цели' }).click();
}

async function runPersistedSheetWeaponAttack(
  page: Page,
  isolatedApi: ForgeApiFixture,
  targetName: string,
): Promise<void> {
  const sourceId = 'playwright-character-1';
  const targetId = 'playwright-character-2';
  const weaponId = exactCatalogEntityId(
    isolatedApi,
    'cards',
    PERSISTED_SHEET_WEAPON_FIXTURE.card.cardNumber,
  );
  const weaponActionId = exactPrimitiveActionId(isolatedApi, 'weapon_attack');
  await equipFixtureLongsword(page, sourceId, weaponId);
  const hpBefore = Number(isolatedApi.getCharacter(targetId)?.current_hp);
  expect(hpBefore).toBeGreaterThan(0);

  await page.goto(`/characters-v3/${sourceId}`);
  const action = page.locator(`[data-action-id="${weaponActionId}"]`);
  await expect(action).toBeVisible({ timeout: 20_000 });
  const actionButton = action.getByRole('button');
  await expect(actionButton).toBeEnabled();
  await actionButton.click();
  await declareSheetTarget(page, targetName);

  await expect.poll(() => Number(isolatedApi.getCharacter(targetId)?.current_hp)).toBeLessThan(hpBefore);
  await expect.poll(() => {
    const resources = isolatedApi.getCharacter(sourceId)?.resources;
    return resources && typeof resources === 'object'
      ? Number((resources as Record<string, unknown>).action)
      : Number.NaN;
  }).toBe(0);
  const persistedTarget = isolatedApi.getCharacter(targetId);
  const hpAfter = Number(persistedTarget?.current_hp);
  expect(Array.isArray(persistedTarget?.active_effects)
    ? persistedTarget.active_effects.length
    : 0).toBeGreaterThan(0);

  await page.goto(`/characters-v3/${targetId}`);
  await expect(page.locator('.sheet-hp-main strong')).toHaveText(String(hpAfter));
  await expect(page.getByText('Ослабляющее', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.sheet-hp-main strong')).toHaveText(String(hpAfter));
  await expect(page.getByText('Ослабляющее', { exact: true })).toBeVisible();
}

test('creates two exact compiled-root characters before running their canonical two-PC world', async ({ page }) => {
  test.slow();
  const browserErrors = captureBrowserErrors(page);
  const isolatedApi = await installForgeApiFixture(page);

  await createCompiledDraftInForge(
    page,
    compiledFixture.roots.fighter.draft,
    'playwright-character-1',
  );
  await createCompiledDraftInForge(
    page,
    compiledFixture.roots.wizard.draft,
    'playwright-character-2',
  );

  expect(isolatedApi.createdCharacters).toHaveLength(2);
  expectForgePayloadMatchesCompiledRoot(
    isolatedApi.createdCharacters[0],
    compiledFixture.roots.fighter,
  );
  expectForgePayloadMatchesCompiledRoot(
    isolatedApi.createdCharacters[1],
    compiledFixture.roots.wizard,
  );

  await page.goto('/rules-lab');
  await expect(page.getByLabel('Идентификаторы fixture')).toContainText(
    compiledFixture.source.ruleset.releaseId,
  );
  await expect(page.getByRole('article', {
    name: `${compiledFixture.roots.fighter.draft.name}, playerCharacter`,
  })).toBeVisible();
  await expect(page.getByRole('article', {
    name: `${compiledFixture.roots.wizard.draft.name}, playerCharacter`,
  })).toBeVisible();
  await clickCommand(page, 'rules-lab-start-encounter', 1);
  await clickCommand(page, 'rules-lab-start-turn', 2);
  await clickCommand(page, 'rules-lab-check', 3);
  await clickCommand(page, 'rules-lab-save', 4);
  await page.reload();
  await expectRevision(page, 4);
  await expect(page.getByTestId('rules-lab-live-status')).toContainText('восстановлен');
  expect(browserErrors).toEqual([]);
});

test('persists a two-character sheet attack and mastery effect through the isolated API fixture', async ({ page }) => {
  test.slow();
  const browserErrors = captureBrowserErrors(page);
  const isolatedApi = await installForgeApiFixture(page);
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  const fighterDraft = {
    ...compiledFixture.roots.fighter.draft,
    equipmentOption: 'b',
    classEquipmentOption: 'b',
  };
  const targetDraft = {
    ...compiledFixture.roots.fighter.draft,
    name: 'Mastery Target',
    equipmentOption: 'b',
    classEquipmentOption: 'b',
  };

  await createCompiledDraftInForge(page, fighterDraft, 'playwright-character-1');
  await createCompiledDraftInForge(page, targetDraft, 'playwright-character-2');
  await runPersistedSheetWeaponAttack(page, isolatedApi, targetDraft.name);

  expect(browserErrors).toEqual([]);
});

test('fails closed in the browser when an IndexedDB snapshot diverges from canonical replay', async ({ page }) => {
  const browserErrors = captureBrowserErrors(page);
  await page.goto('/rules-lab');
  await clickCommand(page, 'rules-lab-start-encounter', 1);

  await page.evaluate(async () => {
    const databaseInfo = (await indexedDB.databases()).find((entry) => (
      entry.name?.startsWith('dnd-cards-rules-lab-')
    ));
    if (!databaseInfo?.name) throw new Error('Rules Lab IndexedDB was not created');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseInfo.name!);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('worlds', 'readwrite');
    const store = transaction.objectStore('worlds');
    const worlds = await new Promise<Array<JsonRecord>>((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result as Array<JsonRecord>);
      request.onerror = () => reject(request.error);
    });
    const snapshot = worlds[0] as JsonRecord & {
      actors: Record<string, { runtime: { hp: { current: number } } }>;
    };
    snapshot.actors.fighter.runtime.hp.current = 1;
    store.put(snapshot);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  });

  await page.reload();
  await expect(page.getByTestId('rules-lab-live-status')).toHaveText(
    'Лабораторный мир недоступен.',
  );
  await expect(page.getByTestId('rules-lab-error')).toContainText(
    'snapshot diverges from its canonical event replay',
  );
  expect(browserErrors).toEqual([]);
});

test('runs the two-PC flow offline and restores the persisted world after reload', async ({ page, context }) => {
  const browserErrors = captureBrowserErrors(page);
  await page.goto('/rules-lab');

  await expect(page.getByTestId('rules-lab-page')).toBeVisible();
  await expect(page.locator('[data-testid^="rules-lab-actor-"]')).toHaveCount(2);
  await expect(page.getByTestId('rules-lab-scene-mode')).toHaveText('exploration');
  await expect(page.getByTestId('rules-lab-object-state')).toContainText('не сдвинут');

  await context.setOffline(true);
  await clickCommand(page, 'rules-lab-start-encounter', 1);
  await clickCommand(page, 'rules-lab-start-turn', 2);
  await expect(page.getByTestId('rules-lab-action')).toContainText('Attack');
  await clickCommand(page, 'rules-lab-action', 3);
  await expect(page.getByTestId('rules-lab-attack-state')).toHaveText('1/1');
  await expect(page.getByTestId('rules-lab-hp-wizard')).toHaveText('10/10');
  await expect(page.getByTestId('rules-lab-action')).toContainText('Булава');
  await clickCommand(page, 'rules-lab-action', 4);
  await expect(page.getByTestId('rules-lab-hp-wizard')).toHaveText('5/10');
  await expect(page.getByTestId('rules-lab-effects-wizard')).toContainText('Нет активных эффектов');
  await expect(page.getByTestId('rules-lab-pending-state')).toHaveText('нет');

  await context.setOffline(false);
  await page.reload();
  await expectRevision(page, 4);
  await expect(page.getByTestId('rules-lab-live-status')).toContainText('восстановлен');
  await expect(page.getByTestId('rules-lab-hp-wizard')).toHaveText('5/10');
  expect(browserErrors).toEqual([]);
});

test('serializes a real Wizard target save offline, reloads it, and resumes exactly once', async ({ page, context }) => {
  const browserErrors = captureBrowserErrors(page);
  await page.goto('/rules-lab');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await context.setOffline(true);

  await clickCommand(page, 'rules-lab-start-encounter', 1);
  await clickCommand(page, 'rules-lab-start-turn', 2);
  await clickCommand(page, 'rules-lab-end-turn', 3);
  await clickCommand(page, 'rules-lab-start-turn', 4);
  await expect(page.getByTestId('rules-lab-action')).toContainText('Волна грома');
  await clickCommand(page, 'rules-lab-action', 5);
  await expect(page.getByTestId('rules-lab-pending-state')).toHaveText('target_save');
  await expect(page.getByTestId('rules-lab-pending-detail')).toContainText('СЛ 12');
  await expect(page.getByTestId('rules-lab-resources-wizard')).toContainText('1/2');
  await expect(page.getByTestId('rules-lab-object-state')).toContainText('10 фт.');

  await page.reload();
  await expectRevision(page, 5);
  await expect(page.getByTestId('rules-lab-pending-state')).toHaveText('target_save');
  await expect(page.getByTestId('rules-lab-object-state')).toContainText('10 фт.');
  await clickCommand(page, 'rules-lab-resolve-fail', 6);
  await expect(page.getByTestId('rules-lab-pending-state')).toHaveText('нет');
  await expect(page.getByTestId('rules-lab-hp-fighter')).toHaveText('5/14');
  await expect(page.getByTestId('rules-lab-effects-fighter')).toContainText('Нет активных эффектов');
  await expect(page.getByTestId('rules-lab-events')).toContainText('урон 9 (thunder)');
  await expect(page.getByTestId('rules-lab-resources-wizard')).toContainText('1/2');
  expect(browserErrors).toEqual([]);
});

test('Pact Blade replaces its bond and resumes a CHA psychic attack continuation offline', async ({ page, context }) => {
  test.slow();
  const browserErrors = captureBrowserErrors(page);
  await openCachedScenario(page, '/rules-lab/blade');
  await expect(page.getByTestId('rules-lab-scenario-blade')).toHaveAttribute('aria-current', 'page');
  await context.setOffline(true);

  await clickCommand(page, 'rules-lab-start-encounter', 1);
  await clickCommand(page, 'rules-lab-start-turn', 2);
  await clickCommand(page, 'rules-lab-blade-bond', 3);
  const firstBond = await page.getByTestId('rules-lab-blade-state').textContent();
  await clickCommand(page, 'rules-lab-check', 4);
  await clickCommand(page, 'rules-lab-save', 5);
  await clickCommand(page, 'rules-lab-end-turn', 6);
  await clickCommand(page, 'rules-lab-start-turn', 7);
  await clickCommand(page, 'rules-lab-end-turn', 8);
  await clickCommand(page, 'rules-lab-start-turn', 9);
  await clickCommand(page, 'rules-lab-blade-bond', 10);
  await expect(page.getByTestId('rules-lab-blade-state')).not.toHaveText(firstBond ?? '');
  await clickCommand(page, 'rules-lab-pact-begin-attack', 11);
  await clickCommand(page, 'rules-lab-blade-attack', 12);
  await expect(page.getByTestId('rules-lab-pending-state')).toHaveText('attack_reaction');
  await expect(page.getByTestId('rules-lab-events')).toContainText('договорным оружием');

  await page.reload();
  await expectRevision(page, 12);
  await expect(page.getByTestId('rules-lab-pending-state')).toHaveText('attack_reaction');
  await clickCommand(page, 'rules-lab-reaction-decline', 13);
  await expect(page.getByTestId('rules-lab-pending-state')).toHaveText('нет');
  await expect(page.getByTestId('rules-lab-events')).toContainText('psychic');
  expect(browserErrors).toEqual([]);
});

test('Pact Chain restores its summoned actor and replaces one owner attack on strict turns offline', async ({ page, context }) => {
  test.slow();
  const browserErrors = captureBrowserErrors(page);
  await openCachedScenario(page, '/rules-lab/chain');
  await context.setOffline(true);

  await clickCommand(page, 'rules-lab-start-encounter', 1);
  await clickCommand(page, 'rules-lab-start-turn', 2);
  await clickCommand(page, 'rules-lab-check', 3);
  await clickCommand(page, 'rules-lab-save', 4);
  await clickCommand(page, 'rules-lab-chain-summon', 5);
  await expect(page.locator('article[data-testid^="rules-lab-summoned-"]')).toHaveCount(1);
  await expect(page.getByTestId('rules-lab-chain-state')).toContainText('reaction 1');

  await page.reload();
  await expectRevision(page, 5);
  await expect(page.locator('article[data-testid^="rules-lab-summoned-"]')).toHaveCount(1);
  await clickCommand(page, 'rules-lab-end-turn', 6);
  await clickCommand(page, 'rules-lab-start-turn', 7);
  await expect(page.getByTestId('rules-lab-active-actor')).toContainText('Owl');
  await clickCommand(page, 'rules-lab-end-turn', 8);
  await clickCommand(page, 'rules-lab-start-turn', 9);
  await clickCommand(page, 'rules-lab-save', 10);
  await clickCommand(page, 'rules-lab-end-turn', 11);
  await clickCommand(page, 'rules-lab-start-turn', 12);
  await clickCommand(page, 'rules-lab-pact-begin-attack', 13);
  await clickCommand(page, 'rules-lab-chain-attack', 14);
  await expect(page.getByTestId('rules-lab-chain-state')).toContainText('reaction 0');
  await expect(page.getByTestId('rules-lab-attack-state')).toHaveText('нет');
  await expect(page.getByTestId('rules-lab-events')).toContainText('replacement');
  expect(browserErrors).toEqual([]);
});

test('Pact Tome replaces its book on rest and preserves the source-scoped cantrip across offline reloads', async ({ page, context }) => {
  test.slow();
  const browserErrors = captureBrowserErrors(page);
  await openCachedScenario(page, '/rules-lab/tome');
  const initialBook = await page.getByTestId('rules-lab-tome-state').textContent();
  await context.setOffline(true);

  await clickCommand(page, 'rules-lab-tome-rest', 1);
  await expect(page.getByTestId('rules-lab-tome-state')).not.toHaveText(initialBook ?? '');
  await expect(page.getByTestId('rules-lab-tome-state')).toContainText('grants 5');
  await page.reload();
  await expectRevision(page, 1);
  await expect(page.getByTestId('rules-lab-tome-state')).toContainText('rules-lab:pact-tome:book:r1');

  await clickCommand(page, 'rules-lab-start-encounter', 2);
  await clickCommand(page, 'rules-lab-start-turn', 3);
  await clickCommand(page, 'rules-lab-check', 4);
  await clickCommand(page, 'rules-lab-save', 5);
  await clickCommand(page, 'rules-lab-tome-cantrip', 6);
  await expect(page.getByTestId('rules-lab-pending-state')).toHaveText('attack_reaction');
  await page.reload();
  await expectRevision(page, 6);
  await clickCommand(page, 'rules-lab-reaction-use', 7);
  await expect(page.getByTestId('rules-lab-pending-state')).toHaveText('нет');
  await expect(page.getByTestId('rules-lab-resources-tome-defender')).toContainText('1/2');
  expect(browserErrors).toEqual([]);
});

test('Find Familiar ritual restores a separate actor and delivers Touch through Shield offline', async ({ page, context }) => {
  test.slow();
  const browserErrors = captureBrowserErrors(page);
  await openCachedScenario(page, '/rules-lab/familiar');
  await context.setOffline(true);

  await clickCommand(page, 'rules-lab-familiar-ritual', 1);
  await expect(page.locator('article[data-testid^="rules-lab-summoned-"]')).toHaveCount(1);
  await page.reload();
  await expectRevision(page, 1);
  await expect(page.getByTestId('rules-lab-familiar-state')).toContainText('present');

  await clickCommand(page, 'rules-lab-start-encounter', 2);
  await clickCommand(page, 'rules-lab-start-turn', 3);
  await clickCommand(page, 'rules-lab-check', 4);
  await clickCommand(page, 'rules-lab-familiar-deliver', 5);
  await expect(page.getByTestId('rules-lab-pending-state')).toHaveText('attack_reaction');
  await expect(page.getByTestId('rules-lab-familiar-state')).toContainText('reaction 0');
  await page.reload();
  await expectRevision(page, 5);
  await clickCommand(page, 'rules-lab-reaction-use', 6);
  await expect(page.getByTestId('rules-lab-resources-familiar-defender')).toContainText('1/2');
  await clickCommand(page, 'rules-lab-end-turn', 7);
  await clickCommand(page, 'rules-lab-start-turn', 8);
  await clickCommand(page, 'rules-lab-end-turn', 9);
  await clickCommand(page, 'rules-lab-start-turn', 10);
  await clickCommand(page, 'rules-lab-save', 11);
  await expect(page.getByTestId('rules-lab-events')).toContainText('Спасбросок');
  expect(browserErrors).toEqual([]);
});
