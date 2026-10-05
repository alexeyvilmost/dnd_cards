import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect, signIn, copyPreset, connectAPI, hash, watchPageErrors, watchConcurrentReads } from './fixtures';

test('library review counts are complete while the browser reads only requested pages', async ({ page, api }) => {
  const checkErrors=watchPageErrors(page); await signIn(page,api);
  await page.goto('/settings');
  await page.getByRole('button', {name:'Превью и названия',exact:true}).click();
  await page.getByRole('checkbox', {name:/^Статус проверки/}).check();
  const expected=await api.request('GET','/spells?fields=list&page=1&limit=1&review_summary=true');
  expect(expected.total).toBeGreaterThan(50);
  const pages:string[]=[];
  page.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/api/spells'&&url.searchParams.get('review_summary')==='true')pages.push(url.searchParams.get('page')??'1');});
  await page.goto('/library?type=spells');
  const summary=page.getByRole('region',{name:'Распределение статусов проверки'});
  await expect(summary).toContainText(`${expected.total} сущностей`);
  for(const [status,count] of Object.entries(expected.review_summary.counts)) await expect(summary.locator(`li[data-status="${status}"] strong`)).toHaveText(String(count));
  expect(pages).toEqual(['1']);
  await page.getByRole('button',{name:'Фильтры',exact:true}).click();
  const selected=page.locator('.library-review-filter input[type=checkbox]').first();
  const response=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/spells'&&new URL(response.url()).searchParams.get('review_status')==='verified');
  await selected.check();
  const filtered=await (await response).json();
  expect(filtered.total).toBe(expected.review_summary.counts.verified);
  await expect(summary).toContainText(`${expected.total} сущностей`);
  expect(pages).toEqual(['1','1']);
  checkErrors();
});

test('S01 login and library search/list/grid use the real backend', async ({ page, local, api }) => {
  const checkErrors = watchPageErrors(page), checkReads = watchConcurrentReads(page);
  await page.goto('/login');
  await page.getByLabel('Имя пользователя', { exact: true }).fill(local.player.username);
  await page.getByLabel('Пароль', { exact: true }).fill(local.player.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto('/library?type=spells');
  await expect(page.locator('.card-library')).toHaveAttribute('data-content-type', 'spells');
  await page.getByRole('button', { name: 'Список', exact: true }).click();
  await expect(page.locator('.card-library')).toHaveAttribute('data-view-mode', 'list');
  await page.getByPlaceholder(/Поиск/).fill('Волшебная стрела');
  await expect(page.locator('.card-library')).toContainText('Волшебная стрела');
  await page.locator('.library-review-row').filter({ hasText: 'Волшебная стрела' }).hover();
  await expect(page.locator('.entity-preview-enter .sp-tip')).toBeVisible();
  await page.mouse.move(5, 5);
  await page.getByRole('button', { name: 'Фильтры', exact: true }).click();
  await page.getByLabel('Уровень заклинания', { exact: true }).selectOption('1');
  await expect(page.locator('.card-library')).toContainText('Волшебная стрела');
  await page.getByRole('button', { name: 'Сетка', exact: true }).click();
  await expect(page.locator('.card-library')).toHaveAttribute('data-view-mode', 'grid');
  expect((await api.request('GET', '/character-templates')).can_manage).toBe(false);
  checkErrors(); checkReads();
});

test('S09 cold run naming is usable and template editing follows real admin rights', async ({ page, api, local, browser }) => {
  const checkErrors = watchPageErrors(page); await signIn(page, api);
  await page.goto('/roguelike');
  await page.locator('.run-preset-row').filter({ hasText: 'Лучник' }).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Начать забег · 1', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Имена участников группы' });
  await dialog.getByLabel('Лучник', { exact: true }).fill('Local visible party');
  const start = dialog.getByRole('button', { name: 'Создать и начать забег', exact: true });
  await expect(start).toBeVisible(); await expect(start).toBeEnabled();
  // Verify usable contrast, not one obsolete exact theme palette.
  const contrast = await start.evaluate(element => {
    const luminance = (color: string) => {
      const values = color.match(/[\d.]+/g)!.slice(0, 3).map(value => Number(value) / 255)
        .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
    };
    const style = getComputedStyle(element), foreground = luminance(style.color), background = luminance(style.backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.goto('/characters-forge'); await page.getByRole('button', { name: 'Создать из шаблона', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Редактировать шаблон', exact: true })).toHaveCount(0);
  const admin = await connectAPI(local, 'admin');
  const context = await browser.newContext({ baseURL: local.uiOrigin, serviceWorkers: 'block' });
  try {
    await local.isolateBrowser(context);
    const adminPage = await context.newPage(); await signIn(adminPage, admin);
    await adminPage.goto('/characters-forge'); await adminPage.getByRole('button', { name: 'Создать из шаблона', exact: true }).click();
    const templates = (await admin.request('GET', '/character-templates')).templates;
    await expect(adminPage.getByRole('button', { name: 'Редактировать шаблон', exact: true })).toHaveCount(templates.length);
    await adminPage.getByRole('button', { name: 'Редактировать шаблон', exact: true }).first().click();
    await expect(adminPage.getByRole('dialog').getByLabel('Лист-источник')).toBeVisible();
  } finally { await context.close(); }
  checkErrors();
});

test('S02 template creation is owned and persists after reload', async ({ page, api }) => {
  const checkErrors = watchPageErrors(page); await signIn(page, api);
  const before = await api.request('GET', '/character-templates');
  await page.goto('/characters-forge');
  await page.getByRole('button', { name: 'Создать из шаблона', exact: true }).click();
  const template = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Линейный боец', exact: true }) });
  await template.getByRole('button', { name: 'Создать копию', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Создание из шаблона' });
  const name = `Browser template ${randomUUID().slice(0, 8)}`;
  await dialog.getByLabel('Имя', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Создать персонажа', exact: true }).click();
  await expect(page).toHaveURL(/\/characters-v3\/[a-f0-9-]+$/);
  await expect(page.getByTestId('open-solo-combat')).toBeVisible({ timeout: 30_000 });
  const id = new URL(page.url()).pathname.split('/').at(-1);
  const saved = await api.request('GET', `/characters-v3/${id}`);
  expect(saved.user_id).toBe(api.auth.user.id); expect(saved.name).toBe(name);
  await page.reload(); await expect(page.getByTestId('open-solo-combat')).toBeVisible();
  expect(hash(await api.request('GET', `/characters-v3/${id}`))).toBe(hash(saved));
  expect(hash(await api.request('GET', '/character-templates'))).toBe(hash(before)); checkErrors();
});

test('S03 paper sheet saves notes, hides/restores blocks and exports real persisted data', async ({ page, api, local }) => {
  const checkErrors = watchPageErrors(page); await signIn(page, api);
  await page.goto('/paper-sheet');
  await page.getByRole('button', { name: 'Создать лист', exact: true }).click();
  await expect(page).toHaveURL(/\/paper-sheet\/[a-f0-9-]+$/);
  const id = new URL(page.url()).pathname.split('/').at(-1);
  const name = `Paper ${randomUUID().slice(0, 8)}`;
  await page.getByLabel('Имя персонажа', { exact: true }).fill(name);
  await page.locator('.ps-page-tabs').getByRole('button', { name: /Заметки/ }).click();
  await page.locator('[data-note-section="notes1"] .ps-note-line').first().click();
  await page.getByRole('textbox', { name: 'Текст: Заметки', exact: true }).fill('Первая строка\nВторая строка');
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await page.getByRole('button', { name: 'Убрать блок: Заметки 1', exact: true }).click();
  await expect.poll(async () => (await api.request('GET', `/paper-sheets/${id}`)).document.hiddenBlocks.length).toBe(1);
  await page.reload();
  await page.getByRole('button', { name: 'Скрытые блоки: 1', exact: true }).click();
  await page.getByRole('button', { name: 'Вернуть', exact: true }).click();
  await page.getByRole('button', { name: 'Закрыть окно', exact: true }).click();
  await expect.poll(async () => (await api.request('GET', `/paper-sheets/${id}`)).document.hiddenBlocks.length).toBe(0);
  await page.getByRole('button', { name: 'Настройки листа', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать лист JSON', exact: true }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  const saved = await api.request('GET', `/paper-sheets/${id}`);
  expect(exported.fields.name).toBe(name); expect(hash(exported)).toBe(hash(saved.document));
  // A stale revision is rejected; it must not overwrite the persisted notes.
  await api.request('PUT', `/paper-sheets/${id}`, { document: saved.document, revision: saved.revision - 1 }, 409);
  expect(hash((await api.request('GET', `/paper-sheets/${id}`)).document)).toBe(hash(saved.document));
  await page.getByRole('button', { name: 'Закрыть окно', exact: true }).click();
  await page.emulateMedia({ media: 'print' });
  const printed = await page.pdf({ path: path.join(local.output, `paper-${id}.pdf`), format: 'A4', printBackground: true });
  expect(printed.subarray(0, 5).toString()).toBe('%PDF-');
  expect(printed.length).toBeGreaterThan(1000);
  checkErrors();
});

test('S04 equipment changes through the sheet and survives reload without changing inventory quantities', async ({ page, api }) => {
  const checkErrors = watchPageErrors(page); await signIn(page, api);
  const source = await copyPreset(api, 'swordsman');
  const before = await api.request('GET', `/characters-v3/${source.id}`);
  const equipped = Object.values(before.equipment ?? {}).find(value => typeof value === 'string') as string;
  expect(Boolean(equipped), 'Preset must have equipped canonical items').toBe(true);
  const card = await api.request('GET', `/cards/${equipped}`);
  await page.goto(`/characters-v3/${source.id}`);
  const displayedAC = page.locator('.cs-ac-v');
  await expect(displayedAC).toBeVisible();
  const armoredAC = Number(await displayedAC.innerText());
  const navigation = page.getByRole('navigation', { name: 'Разделы листа' });
  if (await navigation.count()) await navigation.getByRole('button', { name: 'Инвентарь', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`: ${card.name}$`) }).first().click();
  await page.locator('.sheet-equip-overlay').getByRole('button', { name: 'Снять в сумку', exact: true }).click();
  await expect.poll(async () => Object.values((await api.request('GET', `/characters-v3/${source.id}`)).equipment ?? {}).includes(equipped)).toBe(false);
  await expect.poll(async () => Number(await displayedAC.innerText())).toBeLessThan(armoredAC);
  await page.reload();
  if (await navigation.count()) await navigation.getByRole('button', { name: 'Инвентарь', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`^${card.name}(?:\\s|$)`) }).first().click();
  await page.locator('.sheet-equip-overlay').getByRole('button', { name: 'Надеть', exact: true }).click();
  await expect.poll(async () => Object.values((await api.request('GET', `/characters-v3/${source.id}`)).equipment ?? {}).includes(equipped)).toBe(true);
  await expect(displayedAC).toHaveText(String(armoredAC));
  const after = await api.request('GET', `/characters-v3/${source.id}`);
  expect(hash(after.inventory_items)).toBe(hash(before.inventory_items));
  expect(hash(after.resources)).toBe(hash(before.resources)); checkErrors();
});
