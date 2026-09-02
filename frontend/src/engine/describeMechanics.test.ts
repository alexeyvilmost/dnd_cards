import { describe, expect, it } from 'vitest';
import { describeMechanics, describeMechanicsLine, parseMechanicsStats, abilityFullRu } from './describeMechanics';

const smite = {
  activation: { mode: 'triggered', cost: [{ resource: 'spell_slot', level: 1 }] },
  effects: [{ resolution: 'auto', result: [{ kind: 'damage', dice: '2d8', type: 'radiant' }] }],
};
const fireball = {
  activation: { mode: 'active', cost: [{ resource: 'action' }] },
  effects: [{ resolution: 'save', ability: 'dex', dc: 'spell_dc', on_fail: [{ kind: 'damage', dice: '8d6', type: 'fire' }], on_success: [{ kind: 'damage', dice: '8d6', type: 'fire', on_success: 'half' }] }],
  duration: { type: 'instantaneous' },
};
const stunningStrike = {
  activation: { mode: 'triggered', cost: [{ resource: 'focus', amount: 1 }] },
  effects: [{ resolution: 'save', who: 'target', ability: 'con', dc: '8+prof+wis', on_fail: [{ kind: 'condition', value: 'stunned', op: 'apply' }] }],
  uses: { count: 'prof_bonus', per: 'long_rest' },
};
const rage = {
  activation: { mode: 'active', cost: [{ resource: 'bonus_action' }, { resource: 'rage', amount: 1 }] },
  effects: [{ resolution: 'auto', result: [
    { kind: 'modifier', applies_to: { roll: 'damage' }, op: 'add', value: '+2' },
    { kind: 'resistance', damage_type: 'bludgeoning', value: 'resistance' },
  ] }],
  duration: { type: 'minutes', amount: 10, concentration: false },
};
const proneEffect = {
  effects: [{ resolution: 'auto', result: [
    { kind: 'modifier', applies_to: { roll: 'attack' }, op: 'disadvantage' },
    { kind: 'modifier', applies_to: { roll: 'attack' }, op: 'advantage', scope: 'target' },
  ] }],
};

describe('describeMechanics (фаза F)', () => {
  it('урон + стоимость слота', () => {
    const d = describeMechanics(smite);
    expect(d.summary).toContain('[radiant]2к8');
    expect(d.details).toContain('Стоит: слот 1 круга');
  });

  it('спасбросок с полуроном и цветным уроном', () => {
    const d = describeMechanics(fireball);
    expect(d.summary).toContain('спасбросок ЛВК');
    expect(d.summary).toContain('[fire]8к6 огонь[/fire]');
    expect(d.summary).toContain('полурон при успехе');
  });

  it('состояние + фокус + использования', () => {
    const d = describeMechanics(stunningStrike);
    expect(d.summary).toContain('накладывает **Ошеломлён**');
    expect(d.details).toContain('Стоит: 1 фокус');
    expect(d.details.some((s) => s.includes('Использования'))).toBe(true);
  });

  it('модификатор + сопротивление + длительность + иконка ресурса', () => {
    const d = describeMechanics(rage);
    expect(d.summary).toContain('к урон');
    expect(d.summary).toContain('сопротивление');
    expect(d.details.some((s) => s.includes('10 мин'))).toBe(true);
    expect(d.details.some((s) => s.includes(':bonus_action:'))).toBe(true);
  });

  it('scope:target — «атакующим по вам»', () => {
    expect(describeMechanics(proneEffect).summary).toContain('атакующим по вам — преимущество на атаку');
  });

  it('пустая механика и однострочник', () => {
    expect(describeMechanics(null)).toEqual({ summary: '', details: [] });
    expect(describeMechanicsLine(smite)).toContain('·');
  });

  it('Second Wind не показывает внутренние self_* идентификаторы без контекста персонажа', () => {
    const d = describeMechanics({
      activation: { mode: 'active', cost: [{ resource: 'bonus_action' }, { resource: 'self_uses' }] },
      uses: { count: 2, per: 'short_rest' },
      effects: [{ resolution: 'auto', result: [{ kind: 'healing', amount: '1d10 + self_level' }] }],
    });
    expect(d.summary).toBe('лечение 1к10 + уровень');
    expect(d.details).toContain('Стоит: :bonus_action:, заряд способности');
    expect(d.details).toContain('Использования: 2/короткий отдых');
    expect([d.summary, ...d.details].join(' ')).not.toMatch(/self_(?:uses|level)/);
  });

  it('не показывает runtime-ключ уже привязанного пула использований', () => {
    const d = describeMechanics({
      activation: { cost: [{ resource: 'bonus_action' }, { resource: 'uses_ACT-second-wind' }] },
    });
    expect(d.details).toContain('Стоит: :bonus_action:, заряд способности');
    expect(d.details.join(' ')).not.toContain('uses_ACT-second-wind');
  });

  it('humanizes a data-driven weapon profile for the item card', () => {
    const d = describeMechanics({
      weapon_profile: {
        proficiency_category: 'martial',
        damage_lines: [{ dice: '1d8', type: 'slashing' }],
        attack_modes: [{ kind: 'melee', reach_ft: 5 }, { kind: 'ranged', normal_ft: 20, long_ft: 60 }],
        properties: ['finesse', 'thrown'],
      },
    });
    expect(d.details).toContain('Оружие: воинское · урон [slashing]1к8 рубящий[/slashing]');
    expect(d.details).toContain('Режимы: досягаемость 5 фт; дальность 20 / 60 фт');
    expect(d.details).toContain('Свойства: фехтовальное, метательное');
  });
});

describe('parseMechanicsStats (превью из механики, не из легаси-флагов)', () => {
  it('Брызги кислоты: спасбросок ЛВК берётся из механики', () => {
    const acidSplash = { effects: [{ resolution: 'save', ability: 'dex', dc: '8+prof+spellcasting', on_fail: [{ kind: 'damage', dice: '1d6', type: 'acid' }] }] };
    const s = parseMechanicsStats(acidSplash);
    expect(s.save).toBe(true);
    expect(s.saveAbility).toBe('dex');
    expect(abilityFullRu(s.saveAbility)).toBe('Ловкость');
    expect(s.damage).toEqual([{ value: '1d6', type: 'acid' }]);
    expect(s.attack).toBe(false);
  });

  it('Огненный снаряд: атака + урон из механики', () => {
    const fireBolt = { effects: [{ resolution: 'attack_roll', ability: 'spellcasting', on_hit: [{ kind: 'damage', dice: '1d10', type: 'fire' }] }] };
    const s = parseMechanicsStats(fireBolt);
    expect(s.attack).toBe(true);
    expect(s.save).toBe(false);
    expect(s.damage).toEqual([{ value: '1d10', type: 'fire' }]);
  });

  it('пустая механика', () => {
    expect(parseMechanicsStats(null)).toEqual({ attack: false, save: false, saveAbility: null, damage: [], heal: [] });
  });
});
