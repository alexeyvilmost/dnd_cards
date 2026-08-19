import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { installForgeApiFixture } from './forge-api-fixture';

type JsonRecord = Record<string, unknown>;

const compiled = JSON.parse(readFileSync(new URL(
  '../src/pages/rulesLabFixture.generated.json', import.meta.url,
), 'utf8')) as { roots: { magicInitiateFighter: { draft: JsonRecord; actor: JsonRecord } } };

const CHARACTER_ID = '11111111-1111-4111-8111-111111111111';
const MONSTER_ID = 'c1000000-0000-4000-8000-000000000001';
const MONSTER_ACTION_ID = 'b1000000-0000-4000-8000-000000000001';

function character(): JsonRecord {
  const root = compiled.roots.magicInitiateFighter;
  const draft = root.draft;
  const actor = root.actor as JsonRecord;
  const stats = actor.character as JsonRecord;
  const runtime = actor.runtime as JsonRecord;
  const hp = runtime.hp as JsonRecord;
  return {
    id: CHARACTER_ID, name: 'Лучник-дварф',
    system_id: draft.systemId, ruleset_version: draft.rulesetVersion,
    character_type: draft.characterType, character_schema_version: draft.characterSchemaVersion,
    race_id: draft.raceId, lineage_id: draft.lineageId, class_id: draft.classId,
    background_id: draft.backgroundId, level: draft.level, feat_ids: draft.featIds,
    spell_ids: draft.spellIds, action_ids: draft.actionIds, effect_ids: draft.effectIds,
    resource_ids: draft.resourceIds, resolved_choices: draft.resolvedChoices,
    abilities: stats.abilityScores, skill_proficiencies: stats.skillProficiencies,
    skill_expertise: stats.skillExpertise, saving_throw_proficiencies: stats.saveProficiencies,
    max_hp: hp.max, current_hp: hp.current, speed: stats.characterSpeed,
    proficiency_bonus: stats.profBonus, armor_class: actor.ac,
    equipment: runtime.equipment, inventory_items: runtime.inventory,
    resources: runtime.resources, max_resources: runtime.maxResources,
    active_effects: runtime.activeEffects, turn_state: {}, runtime_revision: 0,
    initiative_bonus: 7, currency: { gold: 0, silver: 0, copper: 0 },
  };
}

const monsterAction = {
  id: MONSTER_ACTION_ID, name: 'Скимитар', description: 'Рукопашная атака.',
  rarity: 'common', card_number: 'MONSTER-ACTION-GOBLIN-SCIMITAR', resource: 'action',
  action_type: 'base_action', type: 'monster', created_at: '', updated_at: '',
  mechanics: {
    interaction: { intent: 'harmful' },
    activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }] },
    targeting: { domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1, range_ft: 5, requires_line_of_sight: true, allowed_relations: ['enemy'] },
    effects: [{ resolution: 'attack_roll', ability: 'dex', attack_kind: 'weapon_melee', vs: 'ac', on_hit: [{ kind: 'damage', dice: '1d6', ability: 'dex', type: 'slashing' }] }],
  },
};

const monster = {
  id: MONSTER_ID, slug: 'goblin-warrior', name: 'Гоблин-воин', description: '',
  size: 'small', creature_type: 'fey', alignment: '', challenge_rating: '1/4',
  armor_class: 15, max_hp: 10, speed: 30, initiative_bonus: 2, proficiency_bonus: 2,
  abilities: { str: 8, dex: 15, con: 10, int: 10, wis: 8, cha: 8 },
  action_ids: [MONSTER_ACTION_ID], effect_ids: [], ai: { strategy: 'melee_chase' },
  token_url: '', source: 'SRD 5.2.1', support: { status: 'verified_partial' },
  created_at: '', updated_at: '',
};

async function dismissMobileSuggestion(page: Page): Promise<void> {
  const suggestion = page.getByRole('complementary', { name: 'Предложение мобильной версии' });
  if (await suggestion.isVisible()) await suggestion.getByRole('button', { name: 'Не сейчас', exact: true }).click();
}

test('real character sheet: selects a monster and executes Thunderwave on the tactical board', async ({ page }) => {
  const api = await installForgeApiFixture(page);
  api.seedCharacter(character());
  api.seedCatalogRow('actions', monsterAction);
  api.seedMonster(monster);

  await page.goto(`/characters-v3/${CHARACTER_ID}`);
  await dismissMobileSuggestion(page);
  const open = page.getByTestId('open-solo-combat');
  await expect(open).toBeVisible({ timeout: 30_000 });
  await open.click();

  const setup = page.getByRole('dialog', { name: `Противники для Лучник-дварф` });
  await expect(setup).toContainText('Гоблин-воин');
  await setup.locator('.lucide-plus').click();
  await setup.getByRole('button', { name: 'Начать бой' }).click();

  await expect(page).toHaveURL(new RegExp(`/characters-v3/${CHARACTER_ID}/combat`));
  await expect(page.getByTestId('tactical-map')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel('Панель действий')).toContainText('Лучник-дварф');
  await expect(page.getByLabel('Порядок инициативы')).toContainText('Гоблин-воин');

  const endTurn = page.getByRole('button', { name: 'Завершить ход' });
  await expect(endTurn).toBeEnabled({ timeout: 30_000 });
  const distance = await page.getByTestId('tactical-map').evaluate((map, ids) => {
    const cells = [...map.querySelectorAll<HTMLButtonElement>('.tactical-cell')];
    const at = (id: string) => {
      const index = cells.findIndex((cell) => cell.dataset.actorId?.startsWith(id));
      return { x: index % 12, y: Math.floor(index / 12) };
    };
    const player = at(ids.player);
    const enemy = at(ids.enemy);
    return Math.max(Math.abs(player.x - enemy.x), Math.abs(player.y - enemy.y)) * 5;
  }, { player: CHARACTER_ID, enemy: MONSTER_ID });
  if (distance > 15) {
    await endTurn.click();
    await expect(endTurn).toBeEnabled({ timeout: 30_000 });
  }

  const thunderwave = page.getByRole('button', { name: /Волна грома/ }).last();
  await expect(thunderwave).toBeEnabled({ timeout: 30_000 });
  await thunderwave.click();
  await page.locator(`.tactical-cell[data-actor-id^="${MONSTER_ID}:"]`).click();
  await expect(page.locator('.combat-log')).toContainText('Волна грома', { timeout: 30_000 });
  await expect(page.locator('.combat-error')).toHaveCount(0);
  expect(api.runtimePatchRequests.length).toBeGreaterThan(0);
});
