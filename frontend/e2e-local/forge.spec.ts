import { randomUUID } from 'node:crypto';
import { test, expect, signIn, hash, watchPageErrors } from './fixtures';
import { openForgeSection, selectForgeEntity, completeVisibleForgeChoices, openForgeOverviewIfNeeded } from '../e2e/forge-interaction-driver';

test('S06 empty Forge uses real race/class/background/choice data and saves an owned sheet', async ({ page, api }) => {
  const checkErrors = watchPageErrors(page); await signIn(page, api);
  await page.addInitScript(() => localStorage.removeItem('forge-draft'));
  // Selecting these ordinary public entities is a scenario, never a runtime
  // branch. All choices, calculations and equipment come from canonical UI.
  await page.goto('/character-forge');
  await openForgeSection(page, 'Вид');
  const showAll = page.getByRole('checkbox', { name: /Показать все сущности/ });
  if (await showAll.count()) await showAll.check();
  await expect(page.getByTestId('offline-rules-authority')).toHaveCount(0);
  await selectForgeEntity(page, 'Орк'); await completeVisibleForgeChoices(page);
  await openForgeSection(page, 'Предыстория'); await selectForgeEntity(page, 'Фермер');
  await openForgeSection(page, 'Класс'); await selectForgeEntity(page, 'Воин');
  // The selection border changes before its dependent bundle arrives. Wait
  // for the ordinary class choices instead of interpreting zero counters as
  // a completed section while loading.
  await expect(page.locator('.forge-editor .choice-count').first()).toBeVisible();
  await completeVisibleForgeChoices(page);
  for (const label of ['Вид', 'Класс', 'Заклинания', 'Черта', 'Характеристики']) {
    const section = page.getByRole('navigation', { name: 'Этапы создания персонажа' }).getByRole('button', { name: new RegExp(`^${label}`) });
    if (await section.count()) {
      await openForgeSection(page, label); await completeVisibleForgeChoices(page);
      if (label === 'Характеристики') {
        await page.getByRole('button', { name: 'Оптимально для класса', exact: true }).click();
        const bonuses = page.locator('.choice-box').filter({ hasText: 'Бонусы предыстории' });
        for (const name of ['Сила', 'Телосложение']) {
          const bonus = bonuses.getByRole('button', { name: new RegExp(`^${name}(?: \\+\\d)?$`) });
          if (!(await bonus.getAttribute('class'))?.split(/\s+/).includes('on')) await bonus.click();
        }
      }
    }
  }
  await openForgeOverviewIfNeeded(page);
  const name = `Forge ${randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder('Фарадей фон Грасс').fill(name);
  expect(await page.locator('.forge-overview-issues li').allTextContents(), 'Visible Forge requirements must be fulfilled').toEqual([]);
  await expect(page.getByRole('button', { name: 'Создать персонажа', exact: true })).toBeEnabled();
  page.on('dialog', async dialog => {
    // Explicit UI confirmation for content that has no manual certificate.
    // Fixture support remains not_tested and the scenario does not certify it.
    if (dialog.type() === 'confirm' && dialog.message().includes('не входит в проверенный каталог')) await dialog.accept();
    else { await dialog.dismiss(); throw new Error('Unexpected dialog during ordinary Forge creation'); }
  });
  // The ordinary sheet reconciles its canonical resource graph on first
  // mount. Observe that real commit before taking the durable baseline.
  const initialResourceSync = page.waitForResponse(response => response.request().method() === 'PATCH'
    && /^\/api\/characters-v3\/[^/]+\/runtime$/.test(new URL(response.url()).pathname));
  await page.getByRole('button', { name: 'Создать персонажа', exact: true }).click();
  await expect(page).toHaveURL(/\/characters-v3\/[a-f0-9-]+$/);
  await expect(page.getByTestId('open-solo-combat')).toBeVisible();
  expect((await initialResourceSync).status()).toBe(200);
  const id = new URL(page.url()).pathname.split('/').at(-1);
  const saved = await api.request('GET', `/characters-v3/${id}`);
  expect(saved.name).toBe(name); expect(saved.user_id).toBe(api.auth.user.id);
  expect(Boolean(saved.race_id && saved.class_id && saved.background_id)).toBe(true);
  expect(saved.inventory_items.length).toBeGreaterThan(0);
  await page.reload(); await expect(page.getByTestId('open-solo-combat')).toBeVisible();
  const reloaded = await api.request('GET', `/characters-v3/${id}`);
  const changedFields = Object.keys(saved).filter(key => hash(saved[key]) !== hash(reloaded[key]));
  expect(changedFields, 'Reload changed persisted character fields').toEqual([]); checkErrors();
});
