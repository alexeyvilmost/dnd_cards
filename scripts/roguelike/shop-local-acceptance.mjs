// Mutates only a deliberately named local QA clone. Never point this at production.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {randomUUID, createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const apiOrigin = process.env.SHOP_QA_API ?? 'http://127.0.0.1:18081';
const uiOrigin = process.env.SHOP_QA_UI ?? 'http://127.0.0.1:3001';
const dsn = process.env.SHOP_QA_DSN;
const psql = process.env.SHOP_QA_PSQL;
for (const address of [apiOrigin, uiOrigin, dsn]) {
  assert(address && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(address).hostname), 'Only loopback QA targets allowed');
}
assert(/^\/shop_review_249_[a-z0-9_]+$/.test(new URL(dsn).pathname), 'Requires a disposable shop_review_249_* database');
assert(psql, 'Set SHOP_QA_PSQL');
const {entries} = JSON.parse(await readFile(new URL('../../backend/roguelikecontent/shop_items.json', import.meta.url), 'utf8'));
const out = new URL('../../outputs/shop-249/', import.meta.url);
await mkdir(out, {recursive: true});
function sql(query) {
  const result = spawnSync(psql, [dsn, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'],
    {encoding: 'utf8', input: query, env: {...process.env, PGCLIENTENCODING: 'UTF8'}});
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
assert.equal(Number(sql("SELECT count(*) FROM schema_migrations WHERE version='249_roguelike_shop_items'")), 1);
let token;
async function api(method, path, body, status = 200) {
  const response = await fetch(`${apiOrigin}/api${path}`, {method,
    headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
    body: body == null ? undefined : JSON.stringify(body)});
  const payload = await response.json();
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(payload)}`);
  return payload;
}
const username = `shopqa${randomUUID().slice(0, 8)}`;
const password = `ShopQA!${randomUUID()}`;
await api('POST', '/auth/register', {username, email: `${username}@example.invalid`, password, display_name: 'QA магазин 249'}, 201);
const login = await api('POST', '/auth/login', {username, password});
token = login.token;
const sourceId = randomUUID();
sql(`INSERT INTO characters_v3 SELECT (jsonb_populate_record(NULL::characters_v3,
  to_jsonb(c) || jsonb_build_object('id',${quote(sourceId)},'user_id',${quote(login.user.id)},
  'name','QA магазин 249 — источник','group_id',NULL,'created_at',NOW(),'updated_at',NOW()))).*
  FROM characters_v3 c WHERE id='3467070b-eb46-461c-85f9-3211373052db'`);
let run = (await api('POST', '/roguelike/runs', {source_character_id: sourceId}, 201)).run;
const runId = run.id;
async function fresh() { run = (await api('GET', `/roguelike/runs/${runId}`)).run; return run; }
async function command(type, payload = {}) {
  const body = {command_id: randomUUID(), expected_revision: run.revision, type, payload};
  run = (await api('POST', `/roguelike/runs/${runId}/commands`, body)).run;
  return body;
}
sql(`UPDATE roguelike_runs SET gold=100000 WHERE id=${quote(runId)};
 UPDATE characters_v3 SET currency='{"gold":100000}'::jsonb WHERE id=${quote(run.character_id)}`);
await fresh();
for (let level = 1; level <= 5; level++) {
  sql(`UPDATE characters_v3 SET level=${level} WHERE id=${quote(run.character_id)}`);
  sql(`UPDATE roguelike_runs SET experience=${[0, 300, 900, 2700, 6500][level - 1]} WHERE id=${quote(runId)}`);
  await fresh(); await command('refresh_shop');
  assert.equal(run.shop.offers.length, 4 + level);
  assert.equal(new Set(run.shop.offers.map(offer => offer.card_id)).size, 4 + level);
  for (const offer of run.shop.offers) {
    const card = await api('GET', `/cards/${offer.card_id}`);
    assert(card.id || card.card?.id, 'Offer must resolve to a library item');
    const declaration = entries.find(item => item.card_number === offer.card_number);
    if (declaration) { assert(declaration.min_level <= level); assert.equal(offer.price, declaration.price); }
  }
}
// Deterministically find an actual epic roll, without changing the generator's odds.
const generation = run.shop.generation + 1;
let epicSeed;
for (let n = 0; n < 100000; n++) {
  const seed = `shop-qa-epic-${n}`;
  const hash = createHash('sha256').update(`${seed}:shop-v2:${generation}:${run.encounters_won}:0:rarity:0`).digest();
  if (Number(hash.readBigUInt64BE() % 10000n) < 10) {epicSeed = seed; break;}
}
assert(epicSeed);
sql(`UPDATE roguelike_runs SET run_seed=${quote(epicSeed)} WHERE id=${quote(runId)}`);
await fresh(); await command('refresh_shop');
const epic = run.shop.offers[0];
assert.equal(entries.find(item => item.card_number === epic.card_number)?.rarity, 'very_rare');
await command('pin', {offer_id: epic.id}); await command('refresh_shop');
assert.deepEqual(run.shop.offers[0], {...epic, pinned: true});
assert.equal(run.shop.offers.length, 9);
await command('pin', {offer_id: ''});

// Exercise the existing authoritative purchase protocol on every reviewed copy.
// Only this fresh QA run receives a synthetic stock fixture; no real run is changed.
const shelf = entries.map(item => ({id: randomUUID(), card_id: item.id, card_number: item.card_number,
  name: item.name, price: item.price, quantity: 1, pinned: false, sold: false}));
sql(`UPDATE roguelike_runs SET shop=jsonb_set(shop,'{offers}',${quote(JSON.stringify(shelf))}::jsonb) WHERE id=${quote(runId)}`);
await fresh();
for (const offer of shelf) {
  const beforeGold = run.gold;
  const beforeQty = (run.character.inventory_items ?? []).filter(row => row.card_id === offer.card_id).reduce((n, row) => n + row.qty, 0);
  const request = await command('buy', {offer_id: offer.id, price: 0}); // A client cannot forge a free price.
  assert.equal(run.gold, beforeGold - offer.price);
  const afterQty = run.character.inventory_items.filter(row => row.card_id === offer.card_id).reduce((n, row) => n + row.qty, 0);
  assert.equal(afterQty, beforeQty + 1);
  const replay = (await api('POST', `/roguelike/runs/${runId}/commands`, request)).run;
  assert.equal(replay.gold, run.gold); assert.equal(replay.revision, run.revision);
}
await command('refresh_shop');
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const {chromium, expect} = require('@playwright/test');
const browser = await chromium.launch({headless: true, channel: process.env.SHOP_QA_BROWSER_CHANNEL ?? 'chrome'});
const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(({token, user}) => {
  localStorage.setItem('auth_token', token); localStorage.setItem('user', JSON.stringify(user));
  localStorage.setItem('boh:mobile-suggestion-dismissed', '1');
}, {token, user: login.user});
const shopURL = `${uiOrigin}/shop/camp?roguelike=${runId}&character=${run.character_id}`;
try {
  await page.goto(shopURL);
  await expect(page.getByRole('heading', {name: 'Случайный ассортимент'})).toBeVisible({timeout: 30000});
  const section = page.getByRole('heading', {name: 'Случайный ассортимент'}).locator('..');
  await expect(section.getByRole('button', {name: 'Купить', exact: true})).toHaveCount(9);
  await section.getByRole('button', {name: 'Купить', exact: true}).first().click();
  await expect(section.getByRole('button', {name: 'Продано', exact: true})).toHaveCount(1);
  await page.getByRole('button', {name: /Обновить ассортимент/}).click();
  await expect(section.getByRole('button', {name: 'Продано', exact: true})).toHaveCount(0);
  await expect(section.getByRole('button', {name: 'Купить', exact: true})).toHaveCount(9);
  await page.screenshot({path: new URL('merchant.png', out).pathname.replace(/^\/([A-Z]:)/i, '$1'), fullPage: true});
  assert.deepEqual(errors, []);
} finally {await browser.close();}
await writeFile(new URL('review-access.json', out), JSON.stringify({username, password, shopURL, sourceId, runId, characterId: run.character_id}, null, 2));
console.log(JSON.stringify({passed: true, catalogItems: entries.length, levels: [5, 6, 7, 8, 9],
  epicGenerated: epic.card_number, purchases: 22, replay: 'no double charge', browser: 'buy and refresh passed', shopURL}, null, 2));
