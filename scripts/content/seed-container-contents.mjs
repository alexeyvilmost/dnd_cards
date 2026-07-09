#!/usr/bin/env node
/**
 * Контейнеры S2/#31: структурный состав гир-паков PHB 2024 (container_mode='all' + contents),
 * чтобы контейнеры можно было РАСПАКОВАТЬ на листе (add_item ×N + consumes_self).
 *
 * Сейчас состав паков живёт лишь ПРОЗОЙ в описании — здесь переносим его в поле contents:
 * резолвим имена предметов в card_id по существующим картам (нечёткое сопоставление имён/алиасов),
 * затем PUT /api/cards/:id {container_mode:'all', contents:[{card_id,quantity}]} (частичный апдейт).
 *
 * Запуск: node scripts/content/seed-container-contents.mjs           (dry-run: только отчёт маппинга)
 *         node scripts/content/seed-container-contents.mjs --apply    (патч прод-карт паков)
 *
 * Состав по PHB 2024 (глава 6). Каждый пункт: [[имя, ...алиасы], количество].
 */
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');

const norm = (s) => String(s).toLowerCase().replace(/ё/g, 'е').replace(/[,.()]/g, ' ')
  .replace(/\d+\s*шт\.?/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');

// Пак → содержимое. [[основное имя, ...алиасы/варианты], количество]
const PACKS = [
  ['Набор артиста', [
    [['Рюкзак'], 1],
    [['Спальник', 'Спальный мешок'], 1],
    [['Костюм', 'Наряд артиста', 'Отличная одежда'], 2],
    [['Свеча'], 5],
    [['Рационы', 'Рацион'], 5],
    [['Бурдюк', 'Мех для воды'], 1],
    [['Набор для грима', 'Набор для маскировки', 'Грим'], 1],
  ]],
  ['Набор взломщика', [
    [['Рюкзак'], 1],
    [['Металлические шарики', 'Шарики'], 1],
    [['Леска'], 1],
    [['Колокольчик'], 1],
    [['Свеча'], 5],
    [['Ломик', 'Фомка'], 1],
    [['Трутница'], 1],
    [['Факел'], 2],
    [['Кандалы', 'Наручники'], 1],
  ]],
  ['Набор дипломата', [
    [['Сундук'], 1],
    [['Тубус для карт и свитков', 'Тубус'], 2],
    [['Отличная одежда', 'Изысканная одежда'], 1],
    [['Чернила', 'Флакон чернил'], 1],
    [['Писчее перо', 'Чернильная ручка', 'Перо'], 1],
    [['Лампа'], 1],
    [['Масло', 'Фляга масла'], 2],
    [['Бумага', 'Лист бумаги'], 5],
    [['Духи', 'Флакон духов'], 1],
    [['Воск', 'Запечатывающий воск', 'Сургуч'], 1],
    [['Мыло'], 1],
  ]],
  ['Набор исследователя подземелий', [
    [['Рюкзак'], 1],
    [['Ломик', 'Фомка'], 1],
    [['Молоток'], 1],
    [['Шип', 'Железный шип', 'Костыль'], 10],
    [['Факел'], 2],
    [['Трутница'], 1],
    [['Рационы', 'Рацион'], 10],
    [['Бурдюк', 'Мех для воды'], 1],
    [['Верёвка пеньковая', 'Пеньковая верёвка', 'Верёвка'], 1],
  ]],
  ['Набор путешественника', [
    [['Рюкзак'], 1],
    [['Спальник', 'Спальный мешок'], 1],
    [['Столовый набор', 'Котелок'], 1],
    [['Трутница'], 1],
    [['Факел'], 2],
    [['Рационы', 'Рацион'], 10],
    [['Бурдюк', 'Мех для воды'], 1],
    [['Верёвка пеньковая', 'Пеньковая верёвка', 'Верёвка'], 1],
  ]],
  ['Набор учёного', [
    [['Рюкзак'], 1],
    [['Книга', 'Книга знаний'], 1],
    [['Чернила', 'Флакон чернил'], 1],
    [['Писчее перо', 'Чернильная ручка', 'Перо'], 1],
    [['Пергамент', 'Лист пергамента'], 10],
    [['Мешочек с песком', 'Мешочек песка'], 1],
    [['Нож', 'Маленький нож', 'Складной нож'], 1],
  ]],
];

// Недостающие базовые предметы паков PHB 2024 (создаём, если нет в БД). [имя, цена, валюта, вес, тип, описание]
const MISSING_ITEMS = [
  ['Отличная одежда', 15, 'gold', 6, null, 'Изысканный наряд из дорогих тканей.'],
  ['Запечатывающий воск', 5, 'silver', null, null, 'Воск для запечатывания писем печатью.'],
  ['Мыло', 2, 'copper', null, null, 'Брусок мыла.'],
  ['Молоток', 1, 'gold', 3, 'tool', 'Молоток для забивания шипов и мелких работ.'],
  ['Столовый набор', 2, 'silver', 1, 'container', 'Жестяная коробка с чашкой и столовыми приборами; складывается в котелок.'],
  ['Книга знаний', 25, 'gold', 5, null, 'Книга с записями знаний по некоторой теме.'],
  ['Мешочек с песком', 1, 'copper', 1, null, 'Небольшой мешочек мелкого песка (для просушки чернил и т.п.).'],
];

async function main() {
  console.log(`Режим: ${APPLY ? 'APPLY (патч прод)' : 'dry-run (только отчёт)'}\n`);
  let cards = await fetchAll('/api/cards', 'cards');
  let byName = new Map();
  const rebuild = () => { byName = new Map(); for (const c of cards) { const k = norm(c.name); if (!byName.has(k)) byName.set(k, c); } };
  rebuild();
  const resolveItem = (variants) => {
    for (const v of variants) { const hit = byName.get(norm(v)); if (hit) return hit; }
    return null;
  };

  const token = APPLY ? await login() : null;

  // 1) Создать недостающие базовые предметы паков (если их нет в БД), затем перечитать индекс.
  const toCreate = MISSING_ITEMS.filter(([name]) => !byName.has(norm(name)));
  if (toCreate.length) {
    console.log(`Недостающих базовых предметов: ${toCreate.length}`);
    for (const [name, price, currency, weight, type, description] of toCreate) {
      console.log(`  ${APPLY ? '+ создаю' : '(будет создан)'}: ${name} — ${price} ${currency}`);
      if (APPLY) {
        try {
          await apiRequest(token, 'POST', '/api/cards', {
            name, description, rarity: 'common', price, price_currency: currency,
            ...(weight != null ? { weight } : {}), ...(type ? { type } : {}), source: 'PHB 2024',
          });
        } catch (e) { console.log(`    ошибка создания: ${String(e).slice(0, 140)}`); }
      }
    }
    if (APPLY) { cards = await fetchAll('/api/cards', 'cards'); rebuild(); }
  }

  let totalMissing = 0;
  const patches = [];

  for (const [packName, items] of PACKS) {
    const pack = byName.get(norm(packName));
    console.log(`\n=== ${packName} ${pack ? '' : '(❌ КАРТА ПАКА НЕ НАЙДЕНА)'}`);
    if (!pack) { totalMissing++; continue; }
    const contents = [];
    for (const [variants, qty] of items) {
      const card = resolveItem(variants);
      if (card) { contents.push({ card_id: card.id, quantity: qty }); console.log(`  ✓ ×${qty}  ${card.name}`); }
      else { totalMissing++; console.log(`  ✗ ×${qty}  ${variants[0]}  — НЕ НАЙДЕНО (варианты: ${variants.join(' / ')})`); }
    }
    patches.push({ id: pack.id, name: pack.name, body: { container_mode: 'all', contents } });
  }

  console.log(`\nИтого паков: ${PACKS.length}; ненайденных позиций/паков: ${totalMissing}`);
  if (!APPLY) { console.log('\nDRY-RUN — прод не изменён. Для применения: --apply (после проверки маппинга).'); return; }

  const failed = [];
  for (const p of patches) {
    try { await apiRequest(token, 'PUT', `/api/cards/${p.id}`, p.body); console.log(`APPLIED: ${p.name} (${p.body.contents.length} поз.)`); }
    catch (e) { failed.push(`${p.name}: ${String(e).slice(0, 160)}`); }
  }
  if (failed.length) { console.log('\nОшибки:'); failed.forEach((f) => console.log(' -', f)); }
}

main().catch((e) => { console.error(e); process.exit(1); });
