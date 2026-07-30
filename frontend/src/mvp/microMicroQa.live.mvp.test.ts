import { beforeAll, describe, expect, it } from 'vitest';
import type { CharacterClass, Feat, PassiveEffect, Race, Spell } from '../types';

const RUN = !!process.env.MVP_CONTENT;
const BASE = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';
type Dict = Record<string, unknown>;

let effects: PassiveEffect[] = [];
let spells: Spell[] = [];
let races: Race[] = [];
let feats: Feat[] = [];
let classes: CharacterClass[] = [];

async function fetchAll<T>(path: string, key: string): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page += 1) {
    const response = await fetch(`${BASE}${path}?page=${page}&limit=100`);
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    const data = await response.json();
    const batch = (data[key] || []) as T[];
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

function payloads(mechanics: Dict | null | undefined): Dict[] {
  const result: Dict[] = [];
  for (const effect of (mechanics?.effects as Dict[] | undefined) || []) {
    if (effect.kind) result.push(effect);
    for (const key of ['result', 'on_fail', 'on_success']) {
      result.push(...(((effect[key] as Dict[] | undefined) || [])));
    }
  }
  return result;
}

function supported(entity: { support?: { status?: string } | null }) {
  return ['verified_mechanical', 'verified_partial', 'verified_narrative']
    .includes(entity.support?.status || '');
}

describe.skipIf(!RUN)('регрессии ручной приёмки micro-micro-MVP 2026-07-30', () => {
  beforeAll(async () => {
    [effects, spells, races, feats, classes] = await Promise.all([
      fetchAll<PassiveEffect>('/api/effects', 'effects'),
      fetchAll<Spell>('/api/spells', 'spells'),
      fetchAll<Race>('/api/races', 'races'),
      fetchAll<Feat>('/api/feats', 'feats'),
      fetchAll<CharacterClass>('/api/classes', 'classes'),
    ]);
  }, 120_000);

  it('Оборона требует надетый доспех, а Бдительный раскрывает Бонус мастерства', () => {
    const defense = effects.find((entity) => entity.card_number === 'fs_defense')!;
    const defenseModifier = payloads(defense.mechanics as Dict).find((payload) => payload.kind === 'modifier')!;
    expect(defenseModifier.when).toEqual([{ kind: 'wearing_armor' }]);

    const alert = effects.find((entity) => entity.card_number === 'EFF-alert')!;
    expect(payloads(alert.mechanics as Dict)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'modifier',
        applies_to: { roll: 'initiative' },
        value: 'prof_bonus',
        source: 'Бонус мастерства',
      }),
    ]));
  });

  it('Огненные ладони и Волна грома наносят половину урона при успехе', () => {
    for (const card of ['SPELL-0242', 'SPELL-0171']) {
      const spell = spells.find((entity) => entity.card_number === card)!;
      const save = ((spell.mechanics as Dict).effects as Dict[]).find((effect) => effect.resolution === 'save')!;
      expect(save.on_success).toEqual([
        expect.objectContaining({ kind: 'damage', on_success: 'half' }),
      ]);
    }
  });

  it('Наставление, Благословение и Усыпление больше не являются narrative-only', () => {
    const guidance = spells.find((entity) => entity.card_number === 'SPELL-0230')!;
    const guidanceChoice = payloads(guidance.mechanics as Dict).find((payload) => payload.id === 'guidance_skill')!;
    const firstGuidance = ((((guidanceChoice.options as Dict).items as Dict[])[0].grants) as Dict[])[0];
    expect(firstGuidance).toMatchObject({ kind: 'modifier', op: 'bonus_die', faces: 4 });

    const bless = spells.find((entity) => entity.card_number === 'SPELL-0163')!;
    expect(payloads(bless.mechanics as Dict).filter((payload) => payload.op === 'bonus_die')).toHaveLength(2);

    const sleep = spells.find((entity) => entity.card_number === 'SPELL-0311')!;
    const sleepSave = ((sleep.mechanics as Dict).effects as Dict[])[0];
    expect(sleepSave).toMatchObject({ resolution: 'save', ability: 'wis' });
    expect(sleepSave.on_fail).toEqual([
      expect.objectContaining({ kind: 'condition', value: 'unconscious' }),
    ]);
  });

  it('Божественный порядок даёт реальные гранты обоим вариантам', () => {
    const order = effects.find((entity) => entity.card_number === 'EFF-divine-order')!;
    const choice = payloads(order.mechanics as Dict).find((payload) => payload.id === 'cleric_divine_order')!;
    const items = ((choice.options as Dict).items as Dict[]);
    const protector = items.find((item) => item.id === 'protector')!;
    expect(protector.grants).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grant_proficiency', prof: 'armor', value: 'heavy' }),
      expect.objectContaining({ kind: 'grant_proficiency', prof: 'weapon', value: 'martial' }),
    ]));
    const thaumaturge = items.find((item) => item.id === 'thaumaturge')!;
    expect((thaumaturge.grants as Dict[]).some((grant) => grant.kind === 'choice')).toBe(true);
    expect((thaumaturge.grants as Dict[]).filter((grant) => grant.kind === 'modifier')).toHaveLength(2);
  });

  it('все наследия драконорождённого и эльфа видимы, а Полёт появляется на 5 уровне', () => {
    const dragonborn = races.find((entity) => entity.card_number === 'RACE-0008')!;
    const dragonSubs = races.filter((entity) => entity.parent_race_id === dragonborn.id);
    expect(dragonSubs).toHaveLength(10);
    expect(dragonSubs.every(supported)).toBe(true);
    expect(dragonSubs.every((subrace) => subrace.related_actions?.length === 1 && subrace.related_effects?.length === 1)).toBe(true);
    const flight = effects.find((entity) => entity.card_number === 'RE-dragonborn-4')!;
    expect(dragonborn.related_effects || []).not.toContain(flight.id);
    expect(dragonborn.level_progression?.['5']?.effects || []).toContain(flight.id);

    const elf = races.find((entity) => entity.card_number === 'RACE-0004')!;
    const elfSubs = races.filter((entity) => entity.parent_race_id === elf.id);
    expect(elfSubs).toHaveLength(3);
    expect(elfSubs.every(supported)).toBe(true);
    expect(elfSubs.every((subrace) => subrace.related_effects?.length === 1)).toBe(true);
  });

  it('родительские сущности, класс Жреца и Бдительный пересертифицированы', () => {
    const cards = [
      races.find((entity) => entity.card_number === 'RACE-0008'),
      races.find((entity) => entity.card_number === 'RACE-0004'),
      classes.find((entity) => entity.card_number === 'CLASS-cleric'),
      feats.find((entity) => entity.card_number === 'FEAT-0001'),
    ];
    expect(cards.every((entity) => entity && supported(entity))).toBe(true);
  });
});
