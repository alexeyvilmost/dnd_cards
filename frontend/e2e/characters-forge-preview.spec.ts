import { expect, test } from '@playwright/test';
import { installForgeApiFixture } from './forge-api-fixture';

test('character library requests a bounded preview instead of the full runtime world', async ({ page }) => {
  const api = await installForgeApiFixture(page);
  api.seedCharacter({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Большой лист, маленькое превью',
    avatar_url: '',
    system_id: 'dnd5e-2024',
    ruleset_version: '2024',
    character_type: 'free',
    race_id: null,
    class_id: null,
    level: 1,
    max_hp: 10,
    current_hp: 10,
    turn_state: { canonical_world: 'x'.repeat(2_000_000) },
  });

  await page.goto('/characters-forge');
  await expect(page.getByText('Большой лист, маленькое превью')).toBeVisible();

  const metrics = api.getCharacterListMetrics();
  expect(metrics?.fields).toBe('preview');
  expect(metrics?.bytes).toBeLessThan(2_000);
  expect(metrics?.rows[0]).not.toHaveProperty('turn_state');
  expect(metrics?.rows[0]).not.toHaveProperty('canonical_world');
});
