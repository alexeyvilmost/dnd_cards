/**
 * Искусность оружия (Weapon Mastery, PHB 2024) — МЕХАНИКА восьми свойств.
 *
 * Эффекты EFFECT-0248..0255 уже существовали с корректным переводом PHB, но с mechanics: null.
 * Здесь досеваем машинную механику, СОХРАНЯЯ description (перевод) и id (на них ссылаются карты
 * оружия текстовыми ссылками [[…|effect:UUID]] — менять id нельзя).
 *
 * Модель: движок (engine/mastery.ts) берёт мастерство из оружия в руке (card.mastery), проверяет,
 * что вид оружия ВЫБРАН персонажем (weaponMasteries), и исполняет эту механику на исходе броска.
 * activation.trigger.event = 'hit' | 'miss' — когда срабатывает.
 * activation.mode = 'passive' — правило, которое движок не исполняет (только описывает).
 *
 * Канон RU (PHB 2024, стр. 214–215): Быстрое, Задевающее, Замедляющее, Опрокидывающее,
 * Ослабляющее, Отвлекающее, Отталкивающее, Рассекающее. Два эффекта в базе названы неканонично
 * («Прорубающее»→Рассекающее, «Секущее»→Задевающее) — переименовываем.
 *
 * Запуск: node scripts/content/weapon-mastery-effects.mjs
 */
const BASE = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';

const onHit = (result) => ({
  activation: { mode: 'triggered', trigger: { event: 'hit' } },
  effects: [{ resolution: 'auto', who: 'target', result }],
});
const narrativeRule = (description) => ({
  activation: { mode: 'passive' },
  effects: [{ resolution: 'auto', result: [{ kind: 'narrative', description }] }],
});

// id → { name?, mechanics }. name задаём только там, где приводим к канону PHB.
const MASTERY = {
  // ── Опрокидывающее (Topple) — спасбросок ТЕЛ против СЛ 8+БМ+мод.атаки → Сбит с ног ──
  '1464fb09-59c1-4bc5-8143-92abae8657b1': {
    mechanics: {
      activation: { mode: 'triggered', trigger: { event: 'hit' } },
      effects: [{
        resolution: 'save', who: 'target', ability: 'con',
        // weapon_mod — модификатор характеристики, использованной для броска атаки (движок).
        dc: '8+prof+weapon_mod',
        on_fail: [{ kind: 'condition', value: 'prone' }],
        on_success: [{ kind: 'narrative', description: 'Опрокидывающее: цель устояла.' }],
      }],
    },
  },

  // ── Ослабляющее (Sap) — цель с помехой на следующий бросок атаки ──
  '4cfe0660-ba1c-415b-b1ed-15e3c708a8e3': {
    mechanics: onHit([
      {
        kind: 'modifier', applies_to: { roll: 'attack' }, op: 'disadvantage',
        duration: { type: 'until_start_of_next_turn' },
        stack_id: 'mastery-sap', stack_type: 'overwrite',
      },
      { kind: 'narrative', description: 'Ослабляющее: цель совершает с помехой следующий бросок атаки до начала вашего следующего хода.' },
    ]),
  },

  // ── Замедляющее (Slow) — Скорость цели −10 футов (не более 10 футов от этого свойства) ──
  // stack_id+overwrite = «снижение не превышает 10 футов» при нескольких попаданиях.
  'c7d07a67-374c-49f6-b34b-40e85c26674e': {
    mechanics: onHit([
      {
        kind: 'modifier', applies_to: { roll: 'speed' }, op: 'add', value: '-10',
        duration: { type: 'until_start_of_next_turn' },
        stack_id: 'mastery-slow', stack_type: 'overwrite',
      },
      { kind: 'narrative', description: 'Замедляющее: Скорость цели снижена на 10 футов до начала вашего следующего хода (несколько попаданий не складываются).' },
    ]),
  },

  // ── Отвлекающее (Vex) — ВЫ с преимуществом на следующий бросок атаки по этой цели ──
  // rounds:2 = «до конца вашего следующего хода» (тик на начале вашего хода: 2→1 жив, 1→0 истёк).
  // who не задан → эффект на СЕБЕ.
  '2877d5fd-f912-4186-867d-53d353570ded': {
    mechanics: {
      activation: { mode: 'triggered', trigger: { event: 'hit' } },
      effects: [{ resolution: 'auto', result: [
        {
          kind: 'modifier', applies_to: { roll: 'attack' }, op: 'advantage',
          duration: { type: 'rounds', amount: 2 },
          stack_id: 'mastery-vex', stack_type: 'overwrite',
        },
        { kind: 'narrative', description: 'Отвлекающее: вы совершаете с преимуществом следующий бросок атаки по этой цели до конца вашего следующего хода.' },
      ] }],
    },
  },

  // ── Отталкивающее (Push) — оттолкнуть на 10 футов, если цель Большого размера или меньше ──
  '82ec5a23-18f9-4c68-9119-470c1ef120d9': {
    mechanics: onHit([
      { kind: 'movement', value: 'push', distance: '10' },
      { kind: 'narrative', description: 'Отталкивающее: вы отталкиваете цель по прямой на 10 футов, если она Большого размера или меньше.' },
    ]),
  },

  // ── Задевающее (Graze) — на ПРОМАХЕ урон = модификатор характеристики атаки ──
  // type:'weapon' → тип урона оружия в руке; amount:'weapon_mod' → мод. характеристики атаки.
  '651f4b6a-74c1-4ecf-a787-d98580bc9495': {
    name: 'Задевающее',
    mechanics: {
      activation: { mode: 'triggered', trigger: { event: 'miss' } },
      effects: [{ resolution: 'auto', who: 'target', result: [
        { kind: 'damage', amount: 'weapon_mod', type: 'weapon' },
        { kind: 'narrative', description: 'Задевающее: даже при промахе вы наносите урон, равный модификатору характеристики броска атаки.' },
      ] }],
    },
  },

  // ── Рассекающее (Cleave) — доп. атака по второму существу в 5 футах ──
  // Позиционирование (второе существо рядом) движок не моделирует → правило-описание.
  '3ad18858-a1a9-44fc-a412-4748d8daaeaa': {
    name: 'Рассекающее',
    mechanics: narrativeRule('Рассекающее: попав рукопашной атакой, вы можете совершить бросок атаки этим же оружием по второму существу в пределах 5 футов от первого и в вашей досягаемости. При попадании оно получает урон оружия БЕЗ модификатора характеристики (если он положительный). Один раз за ход. Второй бросок совершается вручную — выберите вторую цель и атакуйте ещё раз.'),
  },

  // ── Быстрое (Nick) — доп. атака Лёгкого частью действия Атака ──
  // Изменение экономики действий; движок не перестраивает стоимость доп. атаки → правило-описание.
  'c00b501c-2e9a-4f32-89e7-1c5ed898d7b2': {
    mechanics: narrativeRule('Быстрое: дополнительную атаку от свойства Лёгкое вы совершаете частью действия Атака, а не Бонусным действием (один раз за ход). Бонусное действие остаётся свободным.'),
  },
};

async function main() {
  const list = (await (await fetch(`${BASE}/api/effects?limit=2000`)).json()).effects || [];
  let ok = 0;
  for (const [id, patch] of Object.entries(MASTERY)) {
    const e = list.find((x) => x.id === id);
    if (!e) { console.log(`SKIP ${id}: эффект не найден`); continue; }
    const name = patch.name ?? e.name;
    const body = {
      name,
      effect_type: e.effect_type,
      rarity: e.rarity || 'common',
      image_url: e.image_url || '',
      description: e.description, // перевод PHB — сохраняем как есть
      type: e.type,               // 'Эффект мастерства' — ключ выборки
      mechanics: patch.mechanics,
    };
    const res = await fetch(`${BASE}/api/effects/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.ok) {
      ok++;
      const ev = patch.mechanics.activation.trigger?.event ?? 'passive';
      console.log(`UPD ${e.card_number} «${e.name}»${patch.name && patch.name !== e.name ? ` → «${patch.name}»` : ''} — ${ev}`);
    } else {
      console.log(`FAIL ${e.card_number}: ${res.status} ${await res.text()}`);
    }
  }
  console.log(`DONE: ${ok}/8`);
}
main().catch((e) => { console.error(e); process.exit(1); });
