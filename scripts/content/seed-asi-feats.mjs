#!/usr/bin/env node
/**
 * D2 / унификация выборов, слайс 3: ASI и универсальный механизм «Получение черты».
 *
 * Модель (по решению владельца):
 *  • На ASI-уровнях класс получает эффект «Получение черты» — выбор ЛЮБОЙ черты
 *    типа origin (Черта происхождения) или general (Универсальная черта).
 *  • «Увеличение характеристик» (FEAT-0049, general, repeatable) — обычная универсальная
 *    черта в этом пуле. Её эффект даёт вложенный выбор: «+2 к одной ИЛИ +1 к двум» →
 *    выбор характеристик (RAW 2024, потолок 20 — клампит резолвер).
 *  • Неповторяемые уже-активные черты кузня подсветит серым (правило «два эффекта с одним
 *    названием не складываются»); повторяемые (ASI, Одарённый) остаются доступны.
 *
 * Ключи выборов включают id класса и id эффекта-слота, поэтому пикеры на РАЗНЫХ уровнях
 * не конфликтуют (эффекты-слоты pf_1..pf_7 различны). NB: повторяемая черта, взятая на
 * ДВУХ уровнях, пока делит вложенный ключ (слайс 3b — ключи-на-экземпляр).
 *
 * Уровни ASI (PHB 2024): большинство 4/8/12/16/19; Воин +6/+14; Плут +10.
 *
 * Запуск: node scripts/content/seed-asi-feats.mjs          (dry-run)
 *         node scripts/content/seed-asi-feats.mjs --apply   (запись в прод)
 */
import { apiRequest, fetchAll, login } from './api.mjs';

const APPLY = process.argv.includes('--apply');
const dryRun = !APPLY;

const ASI_FEAT_CARD = 'FEAT-0049'; // «Увеличение характеристик» (general, repeatable) — уже в БД

const ABILITY_ITEMS = [
  { id: 'str', name: 'Сила' },
  { id: 'dex', name: 'Ловкость' },
  { id: 'con', name: 'Телосложение' },
  { id: 'int', name: 'Интеллект' },
  { id: 'wis', name: 'Мудрость' },
  { id: 'cha', name: 'Харизма' },
];

// Эффект ASI: внешний выбор режима (explicit) → вложенный выбор характеристик (ability).
// grant-шаблон grant_ability_score: выбранная характеристика приходит как value.
const ASI_MECH = {
  activation: { mode: 'passive' },
  effects: [
    {
      kind: 'choice',
      id: 'asi_mode',
      prompt: 'Улучшение характеристик',
      options: {
        source: 'explicit',
        items: [
          {
            id: 'plus2',
            name: '+2 к одной характеристике',
            grants: [
              {
                kind: 'choice',
                id: 'asi_one',
                prompt: 'Характеристика (+2)',
                count: 1,
                grant: { kind: 'grant_ability_score', amount: 2 },
                options: { source: 'ability' },
              },
            ],
          },
          {
            id: 'plus1x2',
            name: '+1 к двум характеристикам',
            grants: [
              {
                kind: 'choice',
                id: 'asi_two',
                prompt: 'Две характеристики (+1)',
                count: 2,
                grant: { kind: 'grant_ability_score', amount: 1 },
                options: { source: 'ability' },
              },
            ],
          },
        ],
      },
    },
  ],
};

// Пикер «Получение черты»: выбор одной черты из origin+general.
const pickerMech = () => ({
  activation: { mode: 'passive' },
  effects: [
    {
      kind: 'choice',
      id: 'gain_feat',
      prompt: 'Получение черты',
      grant: { kind: 'grant_feat' },
      options: { source: 'feat', categories: ['origin', 'general'] },
    },
  ],
});

// Слоты-эффекты пикера. Различны, чтобы ключи выбора не совпадали между уровнями ОДНОГО
// класса. Один слот может использоваться разными классами на разных уровнях (ключ несёт id
// класса → коллизии нет). Максимум слотов на класс = 7 (Воин: 4/6/8/12/14/16/19).
const PICKER_SLOTS = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
  card: `pf_${n}`,
  name: `Получение черты · слот ${n}`,
}));

// Уровень → индекс слота (1-based в card pf_N). Разные раскладки для Воина/Плута.
const STANDARD = { 4: 1, 8: 2, 12: 3, 16: 4, 19: 5 };
const FIGHTER = { 4: 1, 6: 6, 8: 2, 12: 3, 14: 7, 16: 4, 19: 5 };
const ROGUE = { 4: 1, 8: 2, 10: 6, 12: 3, 16: 4, 19: 5 };

// Класс (RU-имя как в прод-БД) → раскладка ASI-уровней.
const CLASS_LEVELS = {
  Бард: STANDARD, Варвар: STANDARD, Волшебник: STANDARD, Друид: STANDARD,
  Жрец: STANDARD, Колдун: STANDARD, Монах: STANDARD, Паладин: STANDARD,
  Следопыт: STANDARD, Чародей: STANDARD,
  Воин: FIGHTER, Плут: ROGUE,
};

const canon = (v) => JSON.stringify(v);
const eq = (a, b) => canon(a) === canon(b);

async function upsertEffect(token, card, name, mech, effectsByCard) {
  const existing = effectsByCard.get(card);
  if (!existing) {
    console.log(`[effect] создаю ${card} «${name}»`);
    const created = await apiRequest(token, 'POST', '/api/effects', {
      name, description: name, rarity: 'common', card_number: card,
      effect_type: 'passive', mechanics: mech, author: 'Admin', source: 'PHB 2024',
    }, { dryRun });
    return created?.id ?? `dry-${card}`;
  }
  const patch = {};
  if (existing.name !== name) patch.name = name;
  if (!eq(existing.mechanics, mech)) patch.mechanics = mech;
  if (Object.keys(patch).length) {
    console.log(`[effect] обновляю ${card}: ${Object.keys(patch).join(', ')}`);
    await apiRequest(token, 'PUT', `/api/effects/${existing.id}`, patch, { dryRun });
  } else {
    console.log(`[effect] ${card} актуален`);
  }
  return existing.id;
}

async function main() {
  const token = APPLY ? await login() : null;
  const [effects, feats, classes] = await Promise.all([
    fetchAll('/api/effects', 'effects'),
    fetchAll('/api/feats', 'feats'),
    fetchAll('/api/classes', 'classes'),
  ]);
  const effectsByCard = new Map(effects.filter((e) => e.card_number).map((e) => [e.card_number, e]));
  const featsByCard = new Map(feats.filter((f) => f.card_number).map((f) => [f.card_number, f]));

  console.log(`\n=== D2: ASI + «Получение черты» (${APPLY ? 'APPLY' : 'dry-run'}) ===\n`);

  // 1. Эффект ASI + привязка к FEAT-0049.
  const asiEffectId = await upsertEffect(token, 'asi_ability_choice', 'Увеличение характеристик — выбор', ASI_MECH, effectsByCard);
  const asiFeat = featsByCard.get(ASI_FEAT_CARD);
  if (!asiFeat) {
    console.log(`  ⚠ НЕ найдена черта ${ASI_FEAT_CARD} — пропуск привязки`);
  } else {
    const rel = asiFeat.related_effects || [];
    if (!rel.includes(asiEffectId)) {
      console.log(`[feat] привязываю эффект к «${asiFeat.name}» (${ASI_FEAT_CARD})`);
      await apiRequest(token, 'PUT', `/api/feats/${asiFeat.id}`, { related_effects: [...rel, asiEffectId] }, { dryRun });
    } else {
      console.log(`[feat] «${asiFeat.name}» уже привязана`);
    }
  }

  // 2. Пикер-эффекты по слотам.
  const slotEffectId = {};
  for (const slot of PICKER_SLOTS) {
    slotEffectId[slot.card] = await upsertEffect(token, slot.card, slot.name, pickerMech(), effectsByCard);
  }

  // 3. Привязка пикеров к классам по уровням.
  console.log('\n--- level_progression ---');
  let touched = 0;
  for (const [name, levels] of Object.entries(CLASS_LEVELS)) {
    const c = classes.find((x) => x.name === name && !x.is_subclass);
    if (!c) { console.log(`  ⚠ НЕ найден класс «${name}»`); continue; }
    const prog = { ...(c.level_progression || {}) };
    const added = [];
    for (const [lvl, slotN] of Object.entries(levels)) {
      const effId = slotEffectId[`pf_${slotN}`];
      const prev = prog[lvl] || {};
      const prevEffects = prev.effects || [];
      if (prevEffects.includes(effId)) continue;
      prog[lvl] = { effects: [...prevEffects, effId], actions: prev.actions || [] };
      added.push(`${lvl}→pf_${slotN}`);
    }
    if (added.length) {
      console.log(`  ${name}: +${added.join(', ')}`);
      await apiRequest(token, 'PUT', `/api/classes/${c.id}`, { level_progression: prog }, { dryRun });
      touched++;
    } else {
      console.log(`  ${name}: без изменений`);
    }
  }

  console.log(APPLY ? `\n✓ Готово. Классов затронуто: ${touched}` : '\n(dry-run — записи не было; добавь --apply)');
}

main().catch((e) => { console.error(e); process.exit(1); });
