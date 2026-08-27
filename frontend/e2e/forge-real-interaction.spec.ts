import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import { installForgeApiFixture, type ForgeApiFixture } from './forge-api-fixture';
import {
  assertVisibleForgeImagesLoaded,
  completeVisibleForgeChoices,
  openForgeOverviewIfNeeded,
  openForgeSection,
  selectForgeEntity,
  weaponActionIdsByAttackKind,
} from './forge-interaction-driver';

type CatalogRow = {
  id: string;
  card_number: string;
  name: string;
  mechanics?: Record<string, unknown> | null;
};

const REAL_INTERACTION_ROOT = {
  race: 'RACE-0011',
  lineage: 'RACE-0011-stone',
  klass: 'CLASS-ranger',
  background: 'BG-0007',
} as const;

const BROWSER_MONSTER = {
  id: 'c2000000-0000-4000-8000-000000000001',
  slug: 'browser-spine-training-dummy',
  name: 'Тренировочный манекен',
  description: '', size: 'medium', creature_type: 'construct', alignment: '',
  challenge_rating: '0', armor_class: 10, max_hp: 20, speed: 0,
  initiative_bonus: -100, proficiency_bonus: 2,
  abilities: { str: 10, dex: 1, con: 10, int: 1, wis: 1, cha: 1 },
  action_ids: [], effect_ids: [], ai: { strategy: 'hold' }, token_url: '',
  source: 'isolated browser fixture', support: { status: 'verified_partial' },
  created_at: '', updated_at: '',
};

function rowByCardNumber(
  fixture: ForgeApiFixture,
  collection: string,
  cardNumber: string,
): CatalogRow {
  const row = fixture.getCatalogRows(collection).find((candidate) => (
    candidate.card_number === cardNumber
  )) as CatalogRow | undefined;
  if (!row) throw new Error(`Browser fixture misses ${collection}:${cardNumber}`);
  return row;
}

function inventoryQuantity(character: Record<string, unknown> | undefined, cardId: string): number {
  const inventory = Array.isArray(character?.inventory_items) ? character.inventory_items : [];
  return inventory.reduce((sum, item) => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return row.card_id === cardId ? sum + Number(row.qty ?? 0) : sum;
  }, 0);
}

function trackDuplicateApiReads(page: Page): { duplicates: string[]; stop: () => void } {
  const active = new Map<string, number>();
  const duplicates: string[] = [];
  const keyOf = (request: Request) => {
    const url = new URL(request.url());
    return request.method() === 'GET' && url.pathname.startsWith('/api/')
      ? `${url.pathname}${url.search}`
      : null;
  };
  const started = (request: Request) => {
    const key = keyOf(request);
    if (!key) return;
    const count = active.get(key) ?? 0;
    if (count > 0) duplicates.push(key);
    active.set(key, count + 1);
  };
  const finished = (request: Request) => {
    const key = keyOf(request);
    if (!key) return;
    const count = active.get(key) ?? 0;
    if (count <= 1) active.delete(key);
    else active.set(key, count - 1);
  };
  page.on('request', started);
  page.on('requestfinished', finished);
  page.on('requestfailed', finished);
  return {
    duplicates,
    stop: () => {
      page.off('request', started);
      page.off('requestfinished', finished);
      page.off('requestfailed', finished);
    },
  };
}

async function completeSectionIfPresent(page: Page, label: string): Promise<void> {
  const navigation = page.getByRole('navigation', { name: 'Этапы создания персонажа' });
  if (await navigation.getByRole('button', { name: new RegExp(`^${label}(?:\\s|$)`) }).count() === 0) return;
  await openForgeSection(page, label);
  await completeVisibleForgeChoices(page);
}

test('required real-interaction spine: empty Forge reaches sheet and dedicated combat', async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = await installForgeApiFixture(page);
  fixture.seedMonster(BROWSER_MONSTER);
  const race = rowByCardNumber(fixture, 'races', REAL_INTERACTION_ROOT.race);
  const lineage = rowByCardNumber(fixture, 'races', REAL_INTERACTION_ROOT.lineage);
  const klass = rowByCardNumber(fixture, 'classes', REAL_INTERACTION_ROOT.klass);
  const background = rowByCardNumber(fixture, 'backgrounds', REAL_INTERACTION_ROOT.background);
  const rangedWeapon = rowByCardNumber(fixture, 'cards', 'CARD-0327');
  const weaponProfile = rangedWeapon.mechanics?.weapon_profile as
    | { ammo?: { card_id?: string } }
    | undefined;
  const ammunitionCardId = weaponProfile?.ammo?.card_id;
  if (!ammunitionCardId) throw new Error('Projected Ranger longbow has no stable ammunition binding');
  const duplicateReads = trackDuplicateApiReads(page);
  const supportConfirmations: string[] = [];
  const unexpectedDialogs: string[] = [];
  page.on('dialog', async (dialog) => {
    if (dialog.type() === 'confirm'
      && dialog.message().includes('не входит в проверенный каталог')) {
      supportConfirmations.push(dialog.message());
      await dialog.accept();
      return;
    }
    unexpectedDialogs.push(`${dialog.type()}: ${dialog.message()}`);
    await dialog.dismiss();
  });

  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('forge-draft'));
  await page.goto('/character-forge');
  // Enter through the shared navigation driver before touching Forge cards.
  // On mobile this proves that its late-mounted suggestion is dismissed by
  // the real accessible control instead of bypassed with a forced click.
  await openForgeSection(page, 'Вид');
  await expect(page.getByRole('complementary', { name: 'Предложение мобильной версии' })).toBeHidden();
  const showAllContent = page.getByRole('checkbox', { name: /Показать все сущности/ });
  await showAllContent.check();
  await expect(showAllContent).toBeChecked();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('offline-rules-authority'),
    'the isolated server must expose the certified database condition release').toHaveCount(0);

  await selectForgeEntity(page, race.name);
  const confirmationsBeforeLineage = supportConfirmations.length;
  await selectForgeEntity(page, lineage.name);
  expect(supportConfirmations.length,
    'the raw post-migration fixture must expose Stone through the real unverified-content warning')
    .toBeGreaterThan(confirmationsBeforeLineage);
  await completeVisibleForgeChoices(page);

  // Select the fixed background first. This order forces the later class-skill
  // resolver to account for already-owned proficiencies instead of certifying
  // only the convenient class-before-background permutation.
  await openForgeSection(page, 'Предыстория');
  await selectForgeEntity(page, background.name);
  await openForgeSection(page, 'Класс');
  await selectForgeEntity(page, klass.name);

  for (const section of ['Вид', 'Класс', 'Заклинания', 'Черта']) {
    await completeSectionIfPresent(page, section);
  }
  await completeSectionIfPresent(page, 'Характеристики');
  await openForgeSection(page, 'Вид');
  await assertVisibleForgeImagesLoaded(page);

  await openForgeOverviewIfNeeded(page);
  await page.getByPlaceholder('Фарадей фон Грасс').fill('Playwright Real Forge Spine');
  const create = page.getByRole('button', { name: 'Создать персонажа', exact: true });
  await expect(create).toBeEnabled();
  await expect(page.locator('.forge-overview .issues')).toHaveCount(0);
  await create.click();
  await expect(page).toHaveURL(/\/characters-v3\/playwright-character-1$/);
  await expect(page.getByTestId('open-solo-combat')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Открыть ошибки и незавершённые выборы' }))
    .toHaveCount(0);
  expect(inventoryQuantity(fixture.getCharacter('playwright-character-1'), rangedWeapon.id),
    'the selected Ranger kit must contain its declared longbow').toBe(1);
  expect(inventoryQuantity(fixture.getCharacter('playwright-character-1'), ammunitionCardId),
    'the selected Ranger kit must contain its declared ammunition').toBe(20);
  const ownedCardIds = new Set((
    fixture.getCharacter('playwright-character-1')?.inventory_items as
      | Array<Record<string, unknown>>
      | undefined
    ?? []
  ).map((item) => String(item.card_id ?? '')));
  const meleeWeapon = (fixture.getCatalogRows('cards') as CatalogRow[]).find((card) => {
    const profile = card.mechanics?.weapon_profile as
      | { attack_modes?: Array<{ kind?: string }> }
      | undefined;
    return ownedCardIds.has(card.id)
      && profile?.attack_modes?.some((mode) => mode.kind === 'melee');
  });
  expect(meleeWeapon,
    'the repaired Ranger kit must expose an owned mechanics-declared melee weapon').toBeTruthy();

  const sheetNavigation = page.getByRole('navigation', { name: 'Разделы листа' });
  if (await sheetNavigation.count()) {
    await sheetNavigation.getByRole('button', { name: 'Способности', exact: true }).click();
  }
  const stone = page.getByText('Каменная стойкость', { exact: true });
  await expect(stone, 'one lineage ability must have one user-facing authority').toHaveCount(1);

  if (await sheetNavigation.count()) {
    await sheetNavigation.getByRole('button', { name: 'Инвентарь', exact: true }).click();
  }
  await page.getByRole('button', { name: new RegExp(`^${meleeWeapon!.name}(?:\\s|$)`) }).first().click();
  await page.locator('.sheet-equip-overlay').getByRole('button', { name: 'Надеть', exact: true }).click();
  await expect.poll(() => {
    const equipment = fixture.getCharacter('playwright-character-1')?.equipment as
      | Record<string, string>
      | undefined;
    return Object.values(equipment ?? {}).includes(meleeWeapon!.id);
  }).toBe(true);
  const inventoryBeforeAttack = structuredClone(
    fixture.getCharacter('playwright-character-1')?.inventory_items ?? [],
  );
  const ammunitionBeforeAttack = inventoryQuantity(
    fixture.getCharacter('playwright-character-1'),
    ammunitionCardId,
  );

  await page.getByTestId('open-solo-combat').click();
  const setup = page.getByRole('dialog', { name: /Противники для/ });
  await expect(setup).toBeVisible();
  const firstMonster = setup.locator('article').first();
  await firstMonster.locator('button').last().click();
  await setup.getByRole('button', { name: /Начать бой/ }).click();
  await expect(page).toHaveURL(/\/characters-v3\/playwright-character-1\/combat(?:\?.*)?$/);
  await expect(page.getByRole('region', { name: 'Панель действий' })).toBeVisible();
  await expect(page.getByTestId('offline-rules-authority')).toHaveCount(0);

  const splitWeaponActions = weaponActionIdsByAttackKind(
    fixture.getCatalogRows('actions') as Array<CatalogRow & { mechanics?: unknown }>,
  );
  expect(splitWeaponActions.melee, 'one declarative melee basic attack').toHaveLength(1);
  expect(splitWeaponActions.ranged, 'one declarative ranged basic attack').toHaveLength(1);
  const weaponActionIds = [...splitWeaponActions.melee, ...splitWeaponActions.ranged];
  await expect.poll(async () => {
    let visible = 0;
    for (const id of weaponActionIds) {
      visible += await page.locator(`[data-action-id="${id}"]`).count();
    }
    return visible;
  }).toBeGreaterThan(0);

  const writesBeforeMove = fixture.runtimePatchRequests.length;
  await page.getByRole('button', { name: /^Движение \d+ фт\./ }).click();
  await page.getByRole('button', { name: 'Клетка 4, 3', exact: true }).click();
  await expect.poll(() => fixture.runtimePatchRequests.length).toBeGreaterThan(writesBeforeMove);

  let executableWeaponAction: CatalogRow | undefined;
  let executableWeaponButton: Locator | undefined;
  for (const actionId of splitWeaponActions.melee) {
    const wrapper = page.locator(`[data-action-id="${actionId}"]:visible`).first();
    if (!await wrapper.isVisible()) continue;
    const candidate = wrapper.getByRole('button').first();
    if (!await candidate.isEnabled()) continue;
    executableWeaponAction = (fixture.getCatalogRows('actions') as CatalogRow[])
      .find((action) => action.id === actionId);
    executableWeaponButton = candidate;
    break;
  }
  expect(executableWeaponAction, 'a hydrated equipped weapon attack must be executable').toBeTruthy();
  const writesBeforeAttack = fixture.runtimePatchRequests.length;
  await executableWeaponButton!.click();
  await page.locator(`.tactical-cell[data-actor-id^="${BROWSER_MONSTER.id}:"]`).click();
  await expect.poll(() => fixture.runtimePatchRequests.length).toBeGreaterThan(writesBeforeAttack);
  await expect(page.locator('.combat-log')).toContainText(executableWeaponAction!.name);
  await expect.poll(() => {
    const resources = fixture.getCharacter('playwright-character-1')?.resources as
      | Record<string, number>
      | undefined;
    return Number(resources?.action ?? -1);
  }).toBe(0);
  expect(fixture.getCharacter('playwright-character-1')?.inventory_items,
    'a melee attack must not consume ammunition or any inventory row').toEqual(inventoryBeforeAttack);
  expect(inventoryQuantity(fixture.getCharacter('playwright-character-1'), ammunitionCardId),
    'the melee action leaves every declared Ranger arrow untouched').toBe(ammunitionBeforeAttack);
  await expect(page.locator('.combat-error')).toHaveCount(0);

  duplicateReads.stop();
  expect(duplicateReads.duplicates, 'concurrent duplicate API GET requests').toEqual([]);
  expect(unexpectedDialogs, 'unexpected browser dialogs').toEqual([]);
});
