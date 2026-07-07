/**
 * Свип механик прод-контента: прогоняет КАЖДУЮ механику (заклинания/эффекты/
 * действия) через тот же движок, что и лист персонажа, и ищет проблемы:
 *   1) схема-валидация (validateMechanics) — соответствие унифицированной схеме;
 *   2) исполнение активных механик через executeAction — не должно падать;
 *   3) NOT_IMPLEMENTED — payload-ы, заявленные в данных, но не исполняемые движком.
 *
 * Запуск: MVP_CONTENT=1 npx vitest run src/mvp/mechanics.sweep.mvp.test.ts
 * (без флага — пропускается, чтобы не бить сеть в обычном прогоне).
 */
import { describe, expect, it } from 'vitest';
import { executeAction, type RuntimeState } from './contracts';
import { seededRng } from './fixtures';
import { validateMechanics, type MechanicKind } from '../engine/validateMechanics';

const RUN = !!process.env.MVP_CONTENT;
const BASE = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';

type Dict = Record<string, unknown>;
type Entity = { id: string; name: string; card_number?: string; level?: number; mechanics?: Dict | null };

async function fetchAll(path: string, key: string): Promise<Entity[]> {
  const items: Entity[] = [];
  for (let page = 1; page < 30; page++) {
    const res = await fetch(`${BASE}${path}?page=${page}&limit=100`);
    if (!res.ok) break;
    const data = await res.json();
    const batch = (data[key] || []) as Entity[];
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
}

// Богатое состояние: всех ресурсов вдоволь, HP занижен (чтобы лечение проявилось).
function richState(): RuntimeState {
  const res: Record<string, number> = {
    action: 9, bonus_action: 9, reaction: 9, free_action: 9,
    ki_points: 99, rage: 9, sorcery_points: 99, superiority_die: 9,
    bardic_inspiration: 9, channel_divinity: 9, wild_shape: 9, second_wind: 9,
    warlock_spell_slot: 9, heroic_inspiration: 9, luck_points: 9,
  };
  for (let l = 1; l <= 9; l++) res[`spell_slot_${l}`] = 9;
  return {
    hp: { current: 5, max: 60, temp: 0 },
    resources: { ...res },
    maxResources: { ...res },
    equipment: {},
    inventory: [],
    activeEffects: [],
  } as unknown as RuntimeState;
}

// Персонаж высокого уровня — раскрывает scaling заговоров/апкаст.
const CTX = {
  abilityMods: { str: 3, dex: 3, con: 3, int: 5, wis: 5, cha: 5 },
  profBonus: 6, level: 17, classLevels: { wizard: 17 }, characterSpeed: 30,
  spellcastingMod: 5,
} as unknown as Parameters<typeof executeAction>[2]['character'];

const TARGET = { ac: 1, saveMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } };

function isActive(mech: Dict): boolean {
  // Только активируемые: пассивные эффекты/черты исполняются через
  // resolveCharacterRules (их покрывает forge.sweep), а не executeAction.
  const act = mech.activation as Dict | undefined;
  return !!act && act.mode === 'active';
}

// Снимаем стоимость, чтобы не ловить InsufficientResources — тестируем ЭФФЕКТЫ.
function stripCost(mech: Dict): Dict {
  const act = (mech.activation as Dict) || {};
  return { ...mech, activation: { ...act, mode: 'active', cost: [] } };
}

interface SweepResult {
  total: number;
  withMechanics: number;
  schemaInvalid: Array<{ name: string; id: string; errors: string[] }>;
  execThrows: Array<{ name: string; id: string; error: string }>;
  notImplemented: Map<string, { count: number; examples: string[] }>;
  inertLevel02: string[]; // заклинания 0-2, не давшие НИ ОДНОГО события
}

function runSweep(entities: Entity[], kind: MechanicKind, checkInert: boolean): SweepResult {
  const r: SweepResult = {
    total: entities.length, withMechanics: 0,
    schemaInvalid: [], execThrows: [], notImplemented: new Map(), inertLevel02: [],
  };
  for (const e of entities) {
    const mech = e.mechanics as Dict | null | undefined;
    if (!mech || Object.keys(mech).length === 0) continue;
    r.withMechanics++;
    const id = e.card_number || e.id;

    const v = validateMechanics(mech, { id, name: e.name, kind });
    if (!v.valid) r.schemaInvalid.push({ name: e.name, id, errors: v.errors.slice(0, 3) });

    if (!isActive(mech)) continue;
    try {
      const spellCtx = kind === 'spell' ? { baseLevel: e.level ?? 1, castLevel: Math.max(e.level ?? 1, 1) } : undefined;
      const { events } = executeAction(richState(), stripCost(mech), {
        character: CTX, target: TARGET, rng: seededRng(7), ...(spellCtx ? { spell: spellCtx } : {}),
      } as Parameters<typeof executeAction>[2]);

      for (const ev of events) {
        if (ev.type === 'narrative' && /NOT_IMPLEMENTED/.test(ev.text)) {
          const m = /NOT_IMPLEMENTED[:\s]*([\w.]+)?/.exec(ev.text);
          const kkey = (m && m[1]) || ev.text.slice(0, 60);
          const cur = r.notImplemented.get(kkey) || { count: 0, examples: [] };
          cur.count++;
          if (cur.examples.length < 5) cur.examples.push(e.name);
          r.notImplemented.set(kkey, cur);
        }
      }
      if (checkInert && (e.level ?? 0) <= 2 && events.length === 0) r.inertLevel02.push(e.name);
    } catch (err) {
      r.execThrows.push({ name: e.name, id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return r;
}

function printReport(label: string, r: SweepResult) {
  console.log(`\n═══ ${label} ═══`);
  console.log(`всего: ${r.total} | с механикой: ${r.withMechanics}`);
  console.log(`схема-невалидных: ${r.schemaInvalid.length} | падений исполнения: ${r.execThrows.length}`);
  if (r.execThrows.length) {
    console.log('  ПАДЕНИЯ (реальные баги):');
    for (const t of r.execThrows.slice(0, 25)) console.log(`   ✗ ${t.name} [${t.id}]: ${t.error}`);
  }
  if (r.notImplemented.size) {
    console.log('  NOT_IMPLEMENTED payload-ы (заявлены, но движок не исполняет):');
    for (const [k, v] of [...r.notImplemented.entries()].sort((a, b) => b[1].count - a[1].count)) {
      console.log(`   • ${k}: ${v.count} шт (напр.: ${v.examples.join(', ')})`);
    }
  }
  if (r.schemaInvalid.length) {
    console.log('  схема-невалидные (первые 15):');
    for (const s of r.schemaInvalid.slice(0, 15)) console.log(`   ~ ${s.name} [${s.id}]: ${s.errors.join(' | ')}`);
  }
  if (r.inertLevel02.length) {
    console.log(`  заклинания 0-2 БЕЗ событий (${r.inertLevel02.length}): ${r.inertLevel02.slice(0, 40).join(', ')}`);
  }
}

describe.runIf(RUN)('Свип механик прод-контента через движок', () => {
  it('заклинания / эффекты / действия исполняются без падений', async () => {
    const [spells, effects, actions] = await Promise.all([
      fetchAll('/api/spells', 'spells'),
      fetchAll('/api/effects', 'effects'),
      fetchAll('/api/actions', 'actions'),
    ]);

    const rs = runSweep(spells, 'spell', true);
    const re = runSweep(effects, 'passive_effect', false);
    const ra = runSweep(actions, 'action', false);

    printReport('ЗАКЛИНАНИЯ', rs);
    printReport('ЭФФЕКТЫ', re);
    printReport('ДЕЙСТВИЯ', ra);

    const allThrows = [...rs.execThrows, ...re.execThrows, ...ra.execThrows];
    console.log(`\n>>> ИТОГО падений исполнения: ${allThrows.length} <<<`);

    // Известные сломанные формулы (баг данных/пробел движка), задокументированы
    // и ждут фикса. Гейт ловит ТОЛЬКО новые регрессии — известные не роняют набор,
    // но когда починим — удалить из baseline (тогда список станет строго уменьшаться).
    const KNOWN_BROKEN = new Set([
      'SPELL-0483', // Воплощение силы: DC "10 + G" — мусорная переменная G
      'SPELL-0225', // Мистическая бодрость: amount "sum(dice) + spellcasting" — нет переменной dice
      'EFFECT-0158', // Стихийный выброс: dice "3 × Кость боевых искусств" — нет токена монаха
      'EFFECT-0153', // Здоровое тело: проза вместо формулы
      'EFFECT-0147', // Исцеляющая рука: проза вместо формулы
      'RE-aasimar-3', // Целебные руки: amount "self_level d4" — пробел вместо кубика
    ]);
    const unexpected = allThrows.filter((t) => !KNOWN_BROKEN.has(t.id));
    if (unexpected.length) {
      console.log('  !!! НОВЫЕ (не в baseline) падения:');
      for (const t of unexpected) console.log(`   ✗ ${t.name} [${t.id}]: ${t.error}`);
    }
    // Новых падений быть не должно.
    expect(unexpected).toEqual([]);
    // Сколько всего механик реально прогнали (страховка от «вхолостую»).
    expect(rs.withMechanics + re.withMechanics + ra.withMechanics).toBeGreaterThan(700);
  }, 120000);
});
