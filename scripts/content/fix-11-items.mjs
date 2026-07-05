#!/usr/bin/env node
/**
 * Ручная разметка механики для 11 предметов, где AI стабильно выходит за схему
 * (криты-в-обычные, «любой к20», реакция-помеха врагу). Исполнимое ядро —
 * payload-ами движка, остальное — narrative.
 * Запуск: node scripts/content/fix-11-items.mjs --apply
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { apiRequest, fetchAll, login } from './api.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Ajv = require(join(__dirname, '../../frontend/node_modules/ajv/dist/ajv.js')).default;
const addFormats = require(join(__dirname, '../../frontend/node_modules/ajv-formats/dist/index.js')).default;
const schema = JSON.parse(readFileSync(join(__dirname, '../../frontend/src/schemas/mechanics.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

const APPLY = process.argv.includes('--apply');

const stealthDis = { kind: 'modifier', applies_to: { roll: 'ability_check', filter: { skill: 'stealth' } }, op: 'disadvantage', value: 0, source: 'Доспех' };
const narrative = (d) => ({ kind: 'narrative', description: d });
const passive = (...result) => ({ activation: { mode: 'passive' }, effects: [{ resolution: 'auto', result }] });

const MECHANICS = {
  'Верный  талисман': {
    activation: { mode: 'active', cost: [] },
    uses: { count: 1, per: 'day' },
    effects: [{ resolution: 'auto', result: [narrative('Совершите один бросок к20 с преимуществом.')] }],
  },
  'Малая эгида': {
    activation: { mode: 'active', cost: [{ resource: 'reaction' }] },
    uses: { count: 1, per: 'short_rest' },
    effects: [{ resolution: 'auto', result: [narrative('Наложите помеху на бросок атаки против вас (1 раз в бой).')] }],
  },
  'Отличные сапоги': passive(
    { kind: 'modifier', applies_to: { roll: 'speed' }, op: 'add', value: '+5', source: 'Отличные сапоги' },
    narrative('+5 фт к дальности прыжков.'),
  ),
  'Наборный доспех воина': passive(
    stealthDis,
    narrative('Атакующие вас в ближнем бою получают 1 рубящего урона в ответ.'),
  ),
  'Цепь соблазна': {
    activation: { mode: 'active', cost: [] },
    effects: [{ resolution: 'auto', result: [narrative('Любой бросок к20 — с преимуществом. При провале проверки с этим эффектом до конца дня все ваши броски к20 — с помехой.')] }],
  },
  'Свет Латандера +3': passive(
    { kind: 'modifier', applies_to: { roll: 'attack' }, op: 'add', value: '+3', source: 'Свет Латандера' },
    { kind: 'modifier', applies_to: { roll: 'damage' }, op: 'add', value: '+3', source: 'Свет Латандера' },
    narrative('При падении до 0 хитов вы не теряете сознание и исцеляете себя и союзников в 60 фт на 2к6+3 (1 раз до долгого отдыха). 1 раз в день — «Солнечный луч» без ячейки. Вокруг вас всегда дневной свет (15 фт яркий).'),
  ),
  'Латы +1': passive(
    { kind: 'modifier', applies_to: { roll: 'ac' }, op: 'add', value: '+1', source: 'Латы +1' },
    stealthDis,
  ),
  'Адамантиевая кольчуга': passive(stealthDis, narrative('Критические попадания по вам считаются обычными.')),
  'Адамантиевые латы': passive(stealthDis, narrative('Критические попадания по вам считаются обычными.')),
  'Адамантиевый доспех': passive(stealthDis, narrative('Критические попадания по вам считаются обычными.')),
  'Клинок тени': passive(
    { kind: 'modifier', applies_to: { roll: 'attack' }, op: 'advantage', value: 0, source: 'Клинок тени' },
    narrative('Достав клинок: восстановите все ячейки 1-го круга и половину максимума хитов. Убив существо клинком — восстановите 1к10 хитов; убитых воскресит только «Исполнение желаний». После боя вы навсегда получаете −1 к броскам проверок.'),
  ),
};

async function main() {
  const cards = await fetchAll('/api/cards', 'cards');
  const token = APPLY ? await login() : null;
  let ok = 0;
  for (const [name, mech] of Object.entries(MECHANICS)) {
    const card = cards.find((c) => c.name === name);
    if (!card) { console.log('NOT FOUND:', name); continue; }
    const doc = {
      schema_version: '1.0',
      id: 'manual-item', name,
      kind: 'passive_effect',
      activation: mech.activation,
      interactions: mech.effects,
      ...(mech.uses ? { uses: mech.uses } : {}),
    };
    if (!validate(doc)) {
      console.log('SCHEMA FAIL:', name, JSON.stringify(validate.errors?.[0]));
      continue;
    }
    if (APPLY) await apiRequest(token, 'PUT', `/api/cards/${card.id}`, { mechanics: mech });
    ok++;
  }
  console.log(`${APPLY ? 'Применено' : 'Валидно'}: ${ok}/${Object.keys(MECHANICS).length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
