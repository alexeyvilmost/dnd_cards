import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const {chromium, expect} = require('@playwright/test');
const {openForgeSection, selectForgeEntity} = await import('../../frontend/e2e/forge-interaction-driver.ts');
const base = 'http://127.0.0.1:3001';
const access = JSON.parse(await readFile(new URL('../../outputs/shop-249/review-access.json', import.meta.url), 'utf8'));
const loginResponse = await fetch(`${base}/api/auth/login`, {method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({username: access.username, password: access.password})});
assert.equal(loginResponse.status, 200);
const login = await loginResponse.json();
const output = new URL('../../outputs/presets-250/', import.meta.url); await mkdir(output, {recursive: true});
const kind = process.argv[2] ?? 'swordsman';
const browser = await chromium.launch({channel: 'chrome', headless: true});
const page = await browser.newPage({viewport: {width: 1600, height: 1100}});
await page.addInitScript(({token, user}) => {
  localStorage.setItem('auth_token', token); localStorage.setItem('user', JSON.stringify(user));
  localStorage.setItem('boh:mobile-suggestion-dismissed', '1');
}, login);
try {
  if (!process.argv[3]) {
  await page.goto(`${base}/character-forge`);
  await expect(page.getByRole('navigation', {name: 'Этапы создания персонажа'})).toBeVisible({timeout: 30000});
  await selectForgeEntity(page, kind === 'archer' ? 'Человек' : kind === 'line' ? 'Орк' : 'Драконорождённый');
  if (kind === 'swordsman') await selectForgeEntity(page, 'Красный');
  await openForgeSection(page, 'Класс'); await selectForgeEntity(page, 'Воин');
  await expect(page.locator('.forge-editor').getByText('Искусность:', {exact: false}).first()).toBeVisible({timeout: 30000});
  await page.locator('.forge-editor').getByRole('button', {name: kind === 'archer' ? /Стрельба/ : kind === 'line' ? /Оборона/ : /Сражение большим оружием/}).click();
  if (kind !== 'swordsman') await page.locator('.forge-editor .bgeq-variant--btn').filter({has: page.locator('.bgeq-letter', {hasText: kind === 'archer' ? 'Б' : 'В'})}).click();
  await page.locator('.forge-editor').getByRole('button', {name: 'Выбрать', exact: true}).click();
  const mastery = page.getByRole('dialog', {name: 'Искусность оружия'});
  if (await mastery.getByRole('button', {name: /Выбрать из всех видов/}).isVisible()) await mastery.getByRole('button', {name: /Выбрать из всех видов/}).click();
  for (const weapon of kind === 'archer' ? ['Длинный лук', 'Короткий меч', 'Скимитар'] : kind === 'line' ? ['Длинный меч', 'Боевой молот', 'Копьё'] : ['Двуручный меч', 'Цеп', 'Копьё']) await mastery.locator('button.sheet-item-row').filter({hasText: weapon}).first().click();
  await mastery.getByRole('button', {name: 'Готово', exact: true}).click();
  await openForgeSection(page, 'Предыстория'); await selectForgeEntity(page, kind === 'archer' ? 'Преступник' : 'Фермер');
  if (kind === 'archer') {
    await openForgeSection(page, 'Вид');
    await page.locator('.forge-editor').getByRole('button', {name: /Посвящённый в магию/}).click();
    await expect(page.locator('.forge-editor').getByText(/Характеристика|характеристику/).first()).toBeVisible();
    await page.locator('.forge-editor').getByRole('button', {name: 'WIS', exact: true}).click();
    await openForgeSection(page, 'Заклинания');
    for (const spell of ['Брызги кислоты', 'Леденящее прикосновение', 'Щит']) {
      await page.locator('.forge-editor').getByRole('button', {name: new RegExp(`^${spell}(?:\\s|$)`)}).first().click();
    }
  }
  await openForgeSection(page, 'Характеристики');
  await page.getByRole('button', {name: 'Сбросить (все 8)', exact: true}).click();
  for (const [ability, value] of Object.entries(kind === 'archer'
    ? {'Сила':8, 'Ловкость':15, 'Телосложение':15, 'Интеллект':8, 'Мудрость':14, 'Харизма':10}
    : {'Сила':15, 'Ловкость':10, 'Телосложение':15, 'Интеллект':8, 'Мудрость':13, 'Харизма':10})) {
    const row = page.locator('.forge-editor .ab-row').filter({has: page.locator('.name').getByText(ability, {exact: true})});
    for (let n = 8; n < value; n++) await row.getByRole('button', {name: '+', exact: true}).click();
  }
  if (kind === 'archer') {
    const bonuses = page.locator('.forge-editor .choice-box').filter({hasText: 'Бонусы предыстории'});
    // Clear auto-recommended bonuses, then explicitly assign DEX +2 / CON +1.
    for (const ability of ['Ловкость', 'Телосложение', 'Интеллект']) {
      const button = bonuses.getByRole('button', {name: new RegExp(`^${ability}`)});
      for (let n = 0; n < 3 && /\+/.test(await button.innerText()); n++) await button.click();
    }
    await bonuses.getByRole('button', {name: 'Ловкость', exact: true}).click();
    await bonuses.getByRole('button', {name: 'Телосложение', exact: true}).click();
  }
  await page.getByPlaceholder('Фарадей фон Грасс').fill(kind === 'line' ? 'Линейный боец' : kind === 'archer' ? 'Лучник' : 'Мечник');
  await expect(page.getByRole('button', {name: 'Создать персонажа', exact: true})).toBeEnabled({timeout: 30000});
  await writeFile(new URL('draft-inspection.json', output), await page.evaluate(() => localStorage.getItem('forge-draft')) ?? '{}');
  await page.getByRole('button', {name: 'Создать персонажа', exact: true}).click();
  await page.waitForURL(/\/characters-v3\/[0-9a-f-]+$/, {timeout: 30000});
  }
  const id = process.argv[3] ?? new URL(page.url()).pathname.split('/').pop();
  if (process.argv[3]) await page.goto(`${base}/characters-v3/${id}`);
  console.log('CREATED', id);
  let current = await (await fetch(`${base}/api/characters-v3/${id}`, {headers: {Authorization: `Bearer ${login.token}`}})).json();
  const ownedIds = new Set([...current.inventory_items.map(i => i.card_id), ...Object.values(current.equipment ?? {})]);
  if (kind === 'line' && !ownedIds.has('e68a30ff-b0e5-41cf-b007-ddc5eb319750')) {
    const purchases = ['3d4a5854-ac9f-4fc4-b545-8d5c32a08e58', 'e68a30ff-b0e5-41cf-b007-ddc5eb319750', 'b0a5fd06-4b35-480a-8a99-02aa2a60fd6b'];
    assert(purchases.every(id => !ownedIds.has(id)), 'Refuse duplicate/partial purchase');
    let cost = 0;
    for (const cardId of purchases) {
      const result = await (await fetch(`${base}/api/cards/${cardId}`)).json(); cost += (result.card ?? result).price;
    }
    assert.equal(cost, 100); assert(current.currency.gold >= cost);
    const purchase = await fetch(`${base}/api/characters-v3/${id}/runtime`, {method:'PATCH', headers:{Authorization:`Bearer ${login.token}`, 'Content-Type':'application/json'}, body:JSON.stringify({
      inventory_items:[...current.inventory_items, ...purchases.map(card_id => ({card_id, qty:1}))], currency:{...current.currency,gold:current.currency.gold-cost}})});
    assert.equal(purchase.status,200,await purchase.clone().text()); current = await purchase.json(); await page.reload();
  }
  const cards = [];
  for (const cardId of new Set([...current.inventory_items.map(i => i.card_id), ...Object.values(current.equipment ?? {}).filter(Boolean)])) {
    const response = await (await fetch(`${base}/api/cards/${cardId}`)).json();
    cards.push(response.card ?? response);
  }
  for (const item of kind === 'line' ? ['Кольчуга', 'Длинный меч', 'Щит'] : kind === 'archer' ? ['Длинный лук', 'Проклёпанный кожаный доспех'] : ['Двуручный меч','Кольчуга']) {
    const cardId = cards.find(c => c.name === item)?.id; assert(cardId, `Missing ${item}`);
    if (Object.values(current.equipment ?? {}).includes(cardId)) continue;
    console.log('EQUIP', item);
    await page.locator('.sheet-inv-icon-grid').getByRole('button', {name: item, exact: true}).click();
    const equip = page.locator('.sheet-equip-dialog').getByRole('button', {name: /^Надеть/});
    if (await equip.isVisible()) await equip.click();
    else await page.locator('.sheet-equip-dialog').getByRole('button', {name: /Закрыть|Отмена/}).first().click();
    await expect(page.locator('.sheet-equip-dialog')).toHaveCount(0);
  }
  const character = await (await fetch(`${base}/api/characters-v3/${id}`, {headers: {Authorization: `Bearer ${login.token}`}})).json();
  await writeFile(new URL(`${kind}.json`, output), JSON.stringify(character, null, 2));
} finally {
  await page.screenshot({path: fileURLToPath(new URL('forge.png', output)), fullPage: true});
  await browser.close();
}
