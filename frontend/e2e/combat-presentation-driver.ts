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
  await page.addLocatorHandler(page.getByRole('dialog', {name: 'Бросок атаки', exact: true}), async () => {
    // Set the inactive side first, otherwise the active selector closes the overlay.
    await page.evaluate(() => {
      const settings = JSON.parse(localStorage.getItem('site-settings') ?? '{}');
      localStorage.setItem('site-settings', JSON.stringify({...settings, combatRollMode: 'skip', enemyCombatRollMode: 'skip'}));
      window.dispatchEvent(new CustomEvent('site-settings-changed'));
    });
  });
  await dialog.getByRole('button', {name: 'Начать сражение', exact: true}).click();
  await expect(dialog).not.toBeVisible();
  // Read-only polling does not invoke Playwright's locator handlers. Choose
  // the preference explicitly before a scenario waits for the next turn.
  await page.getByRole('button', {name: 'Настройки боя', exact: true}).click();
  const settings = page.getByRole('dialog', {name: 'Настройки', exact: true});
  await settings.getByRole('button', {name: 'Бой и броски'}).click();
  await settings.getByRole('button', {name: 'Показ бросков в бою'}).click();
  await settings.getByRole('combobox', {name: 'Свои действия и союзники'}).selectOption('skip');
  await settings.getByRole('combobox', {name: 'Действия противников'}).selectOption('skip');
  await settings.getByRole('button', {name: 'Закрыть настройки', exact: true}).click();
}
