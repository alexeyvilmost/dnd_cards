import {expect, type Page} from '@playwright/test';

/** Accept the real opening UI; subsequent legacy combat scenarios use the
 * player's persisted skip option so their own reaction windows stay reachable. */
export async function acceptCombatOpening(page: Page) {
  const dialog = page.getByRole('dialog', {name: 'Инициатива', exact: true});
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.combat-initiative-row').first()).toBeVisible();
  expect(await dialog.locator('.committed-die').count()).toBeGreaterThan(1);
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  await page.addLocatorHandler(page.getByRole('dialog', {name: 'Бросок атаки', exact: true}), async overlay => {
    await overlay.getByRole('combobox', {name: 'Показ атак'}).selectOption('skip');
  });
  await dialog.getByRole('button', {name: 'Начать сражение', exact: true}).click();
  await expect(dialog).not.toBeVisible();
}
