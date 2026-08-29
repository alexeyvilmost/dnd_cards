import { expect, test } from '@playwright/test';
import { installForgeApiFixture } from './forge-api-fixture';

const MONSTER_ID = 'c1000000-0000-4000-8000-000000000001';

test('monster constructor preserves the durable token until a selected file upload succeeds', async ({ page }) => {
  const api = await installForgeApiFixture(page);
  api.seedMonster({
    id: MONSTER_ID,
    slug: 'goblin-warrior',
    name: 'Гоблин-воин',
    name_en: 'Goblin Warrior',
    description: 'Гоблин.',
    size: 'small',
    creature_type: 'goblinoid',
    alignment: 'neutral evil',
    challenge_rating: '1/4',
    armor_class: 15,
    max_hp: 10,
    speed: 30,
    initiative_bonus: 2,
    proficiency_bonus: 2,
    abilities: { str: 8, dex: 15, con: 10, int: 10, wis: 8, cha: 8 },
    action_ids: [],
    effect_ids: [],
    ai: { strategy: 'melee_chase', preferred_range_ft: 5 },
    token_url: 'https://storage.example/old-goblin.png',
    source: 'Test',
    support: null,
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:00:00Z',
  });

  await page.goto(`/monster-forge/${MONSTER_ID}`);
  await expect(page.getByRole('heading', { name: 'Гоблин-воин' })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: 'goblin.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X2NDNwAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await expect(page.locator('.monster-forge__aside img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.locator('.monster-forge__aside img')).toHaveAttribute('src', '/fixture-images/monster-token.png');

  expect(api.monsterUpdateRequests).toHaveLength(1);
  expect(api.monsterUpdateRequests[0].token_url).toBe('https://storage.example/old-goblin.png');
  expect(String(api.monsterUpdateRequests[0].token_url)).not.toContain('data:image');
  expect(api.imageUploadRequests).toHaveLength(1);
});
