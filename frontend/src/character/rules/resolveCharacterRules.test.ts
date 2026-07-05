/**
 * Корректность сборки персонажа (character build) — сердце «создания персонажей
 * в любых вариациях». Проверяет резолвер правил: гранты владений/экспертизы/
 * заклинаний из механик видов/классов/предысторий, выборы (choice), конфликты
 * дублей и производные значения (бонусы навыков/спасбросков, HP, БМ по уровню).
 *
 * Чистый модуль (без бэкенда): входной `assembled` собирается как минимальный
 * объект и приводится к типу — резолвер читает только используемые поля.
 */
import { describe, expect, it } from 'vitest';
import { resolveCharacterRules } from './resolveCharacterRules';
import { abilityMod, abilityOfSkill } from './foundation';
import { emptyDraft, type AbilityKey, type AbilityScores, type CharacterDraft } from '../types';
import type { AssembledCharacter, OriginAction, OriginEffect } from '../assemble';
import type { ChoiceOrigin } from '../../mechanics/collectChoices';

type Mech = Record<string, unknown>;

/** Обёртка `interactions: auto` — как реальный контент видов/классов. */
const auto = (...result: Mech[]): Mech => ({ effects: [{ resolution: 'auto', result }] });

const RACE_ORIGIN: ChoiceOrigin = { kind: 'race', id: 'elf', name: 'Эльф' };
const FEAT_ORIGIN: ChoiceOrigin = { kind: 'feat', id: 'skilled', name: 'Одарённый' };

function fx(id: string, mechanics: Mech, origin: ChoiceOrigin = RACE_ORIGIN): OriginEffect {
  return { effect: { id, name: id, mechanics } as unknown as OriginEffect['effect'], origin };
}

// 15/14/13/12/10/8 → +2/+2/+1/+1/0/−1
const STD: AbilityScores = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };

function build(opts: {
  klass?: Mech | null;
  background?: Mech | null;
  race?: Mech | null;
  effects?: OriginEffect[];
  actions?: OriginAction[];
  draft?: Partial<CharacterDraft>;
} = {}) {
  const draft: CharacterDraft = { ...emptyDraft(), abilities: { ...STD }, level: 1, ...opts.draft };
  const assembled = {
    race: opts.race === undefined ? { id: 'elf', name: 'Эльф', speed: 30 } : opts.race,
    klass: opts.klass ?? null,
    background: opts.background ?? null,
    feats: [],
    effects: opts.effects ?? [],
    actions: opts.actions ?? [],
    spells: [],
    pendingChoices: [],
    featAbilityIncreases: [],
    derived: {},
  } as unknown as AssembledCharacter;
  return resolveCharacterRules({ draft, assembled });
}

describe('resolveCharacterRules — базовые владения и производные', () => {
  it('спасброски класса добавляют БМ, прочие — только модификатор', () => {
    const rs = build({ klass: { id: 'fighter', name: 'Воин', hit_die: 'd10', saving_throws: ['str', 'con'] } });
    expect(rs.proficiencyBonus).toBe(2);
    expect(rs.proficiencies.savingThrows.sort()).toEqual(['con', 'str']);
    expect(rs.savingThrowBonuses.str).toBe(abilityMod(STD.str) + 2); // +2 СИЛ +2 БМ = 4
    expect(rs.savingThrowBonuses.con).toBe(abilityMod(STD.con) + 2); // +1 +2 = 3
    expect(rs.savingThrowBonuses.dex).toBe(abilityMod(STD.dex)); // без владения = +2
  });

  it('навыки предыстории дают владение и +БМ к бонусу навыка', () => {
    const rs = build({ background: { id: 'sage', name: 'Мудрец', skill_proficiencies: ['perception', 'stealth'] } });
    expect(rs.proficiencies.skills).toHaveLength(2);
    for (const sid of rs.proficiencies.skills) {
      const base = abilityMod(STD[abilityOfSkill(sid) as AbilityKey]);
      expect(rs.skillBonuses[sid]).toBe(base + rs.proficiencyBonus);
    }
  });

  it('выбор навыков класса (classSkillChoices) применяется', () => {
    const rs = build({
      klass: { id: 'rogue', name: 'Плут', hit_die: 'd8' },
      draft: { classSkillChoices: ['acrobatics', 'stealth'] },
    });
    expect(rs.proficiencies.skills.sort()).toEqual(['acrobatics', 'stealth'].sort());
  });

  it('инструмент предыстории попадает во владения', () => {
    const rs = build({ background: { id: 'crim', name: 'Преступник', tool_proficiency: 'thieves_tools' } });
    expect(rs.proficiencies.tools).toContain('thieves_tools');
  });

  it('скорость берётся от вида, инициатива/КЗ — от ЛВК', () => {
    const rs = build({ race: { id: 'dwarf', name: 'Дварф', speed: 25 } });
    expect(rs.speed).toBe(25);
    expect(rs.initiativeBonus).toBe(abilityMod(STD.dex));
    expect(rs.armorClass).toBe(10 + abilityMod(STD.dex));
    expect(rs.passivePerception).toBe(10 + rs.skillBonuses.perception);
  });
});

describe('resolveCharacterRules — уровень (level-up) масштабирует производные', () => {
  it('HP растёт с уровнем по формуле кости хитов', () => {
    const l1 = build({ klass: { id: 'fighter', name: 'Воин', hit_die: 'd10' }, draft: { level: 1 } });
    const l5 = build({ klass: { id: 'fighter', name: 'Воин', hit_die: 'd10' }, draft: { level: 5 } });
    expect(l1.maxHP).toBe(11); // d10 max(10) + ТЕЛ(1)
    expect(l5.maxHP).toBe(39); // 11 + 4*(среднее 6 + ТЕЛ 1)
  });

  it('бонус мастерства: +2 (1–4), +3 (5–8), +4 (9–12)', () => {
    expect(build({ draft: { level: 4 } }).proficiencyBonus).toBe(2);
    expect(build({ draft: { level: 5 } }).proficiencyBonus).toBe(3);
    expect(build({ draft: { level: 9 } }).proficiencyBonus).toBe(4);
  });

  it('владение навыком масштабирует бонус вместе с БМ уровня', () => {
    const rs = build({
      background: { id: 'sage', name: 'Мудрец', skill_proficiencies: ['perception'] },
      draft: { level: 5 },
    });
    const base = abilityMod(STD.wis);
    expect(rs.skillBonuses.perception).toBe(base + 3); // +3 БМ на 5 уровне
  });
});

describe('resolveCharacterRules — grant_spell и заговоры', () => {
  it('grant_spell от эффекта вида появляется в spells.known, label:cantrip → в cantrips', () => {
    const rs = build({
      effects: [fx('elf-magic', auto(
        { kind: 'grant_spell', value: 'light', label: 'cantrip' },
        { kind: 'grant_spell', value: 'cure_wounds' },
      ))],
    });
    expect(rs.spells.known.sort()).toEqual(['cure_wounds', 'light']);
    expect(rs.spells.cantrips).toEqual(['light']);
    expect(rs.spells.leveled).toEqual(['cure_wounds']);
  });

  it('дубль одного заклинания из другого источника даёт конфликт и не дублируется', () => {
    const rs = build({
      effects: [
        fx('a', auto({ kind: 'grant_spell', value: 'light' }), { kind: 'race', id: 'elf', name: 'Эльф' }),
        fx('b', auto({ kind: 'grant_spell', value: 'light' }), { kind: 'feat', id: 'mi', name: 'Магия' }),
      ],
    });
    expect(rs.spells.known).toEqual(['light']);
    expect(rs.conflicts.some((c) => c.code === 'duplicate_spell')).toBe(true);
  });
});

describe('resolveCharacterRules — level_gate распределяет заклинания по уровням', () => {
  const highElf = (level: number) => build({
    effects: [fx('high-elf', auto(
      { kind: 'grant_spell', value: 'prestidigitation', label: 'cantrip', level_gate: 1 },
      { kind: 'grant_spell', value: 'detect_magic', level_gate: 3 },
      { kind: 'grant_spell', value: 'misty_step', level_gate: 5 },
    ))],
    draft: { level },
  });

  it('L1: только заклинание с level_gate 1 (Фокус)', () => {
    expect(highElf(1).spells.known).toEqual(['prestidigitation']);
  });
  it('L3: добавляется level_gate 3 (Обнаружение магии)', () => {
    expect(highElf(3).spells.known.sort()).toEqual(['detect_magic', 'prestidigitation']);
  });
  it('L5: все три (в т.ч. Туманный шаг)', () => {
    expect(highElf(5).spells.known.sort()).toEqual(['detect_magic', 'misty_step', 'prestidigitation']);
  });
});

describe('resolveCharacterRules — choice (выбор до разрешения)', () => {
  it('subfeature-выбор (эльфийское наследие) применяет пакет грантов выбранного варианта', () => {
    const choice: Mech = {
      kind: 'choice', id: 'elf_lineage',
      options: {
        source: 'subfeature',
        items: [
          { id: 'high_elf', grants: [{ kind: 'grant_spell', value: 'prestidigitation', label: 'cantrip' }] },
          { id: 'wood_elf', grants: [{ kind: 'grant_proficiency', prof: 'skill', value: 'perception' }] },
        ],
      },
    };
    const rs = build({
      effects: [fx('elf-lineage', { effects: [choice] })],
      draft: { resolvedChoices: { elf_lineage: ['high_elf'] } },
    });
    expect(rs.spells.cantrips).toEqual(['prestidigitation']);
  });

  it('плоский выбор навыка (Одарённый) через grant-шаблон', () => {
    const choice: Mech = {
      kind: 'choice', id: 'skilled_choice',
      grant: { kind: 'grant_proficiency', prof: 'skill' },
      options: { source: 'skill' },
    };
    const rs = build({
      effects: [fx('skilled', { effects: [choice] }, FEAT_ORIGIN)],
      draft: { resolvedChoices: { skilled_choice: ['stealth'] } },
    });
    expect(rs.proficiencies.skills).toContain('stealth');
  });

  it('незакрытый выбор ничего не гранит (нет конфликтов, нет владений)', () => {
    const choice: Mech = {
      kind: 'choice', id: 'skilled_choice',
      grant: { kind: 'grant_proficiency', prof: 'skill' },
      options: { source: 'skill' },
    };
    const rs = build({ effects: [fx('skilled', { effects: [choice] }, FEAT_ORIGIN)] });
    expect(rs.proficiencies.skills).toHaveLength(0);
    expect(rs.conflicts).toHaveLength(0);
  });
});

describe('resolveCharacterRules — экспертиза и конфликты дублей', () => {
  it('экспертиза поверх владения удваивает БМ в бонусе навыка', () => {
    const rs = build({
      effects: [fx('expert', auto(
        { kind: 'grant_proficiency', prof: 'skill', value: 'stealth' },
        { kind: 'grant_expertise', prof: 'skill', value: 'stealth' },
      ))],
    });
    expect(rs.expertise.skills).toContain('stealth');
    const base = abilityMod(STD[abilityOfSkill('stealth') as AbilityKey]);
    expect(rs.skillBonuses.stealth).toBe(base + 2 * rs.proficiencyBonus);
  });

  it('choice-грант с expert:true (Экспертиза Плута/Барда) — экспертиза, а не дубль владения', () => {
    // Прод-формат: {"grant":{"expert":true,"kind":"grant_proficiency","prof":"skill"},"options":{"filter":"proficient",...}}
    const expertiseChoice: Mech = {
      kind: 'choice', id: 'rogue_expertise_l1',
      grant: { kind: 'grant_proficiency', prof: 'skill', expert: true },
      options: { source: 'skill', filter: 'proficient' },
    };
    const rs = build({
      effects: [
        fx('class-skill', auto({ kind: 'grant_proficiency', prof: 'skill', value: 'deception' })),
        fx('rogue-expertise', { effects: [expertiseChoice] }),
      ],
      draft: { resolvedChoices: { rogue_expertise_l1: ['deception'] } },
    });
    expect(rs.expertise.skills).toContain('deception');
    expect(rs.conflicts.filter((c) => c.code === 'duplicate_proficiency')).toHaveLength(0);
    expect(rs.skillBonuses.deception).toBe(
      abilityMod(STD[abilityOfSkill('deception') as AbilityKey]) + 2 * rs.proficiencyBonus,
    );
  });

  it('экспертиза без владения — ошибка missing_proficiency_for_expertise', () => {
    const rs = build({
      effects: [fx('expert', auto({ kind: 'grant_expertise', prof: 'skill', value: 'stealth' }))],
    });
    expect(rs.conflicts.some((c) => c.code === 'missing_proficiency_for_expertise' && c.severity === 'error')).toBe(true);
  });

  it('дубль владения из двух источников: конфликт + применяется один раз', () => {
    const rs = build({
      background: { id: 'sage', name: 'Мудрец', skill_proficiencies: ['perception'] },
      effects: [fx('race-perc', auto({ kind: 'grant_proficiency', prof: 'skill', value: 'perception' }))],
    });
    expect(rs.proficiencies.skills.filter((s) => s === 'perception')).toHaveLength(1);
    expect(rs.conflicts.some((c) => c.code === 'duplicate_proficiency')).toBe(true);
  });
});

describe('resolveCharacterRules — grant_language и НЕреализованные гранты (карта пробелов)', () => {
  it('grant_language добавляет язык', () => {
    const rs = build({ effects: [fx('tongues', auto({ kind: 'grant_language', value: 'elvish' }))] });
    expect(rs.proficiencies.languages).toContain('elvish');
  });

  it('grant_feat / grant_ability_score / grant_sense / grant_speed пока молча игнорируются (пробел MVP, но не падают)', () => {
    const rs = build({
      effects: [fx('gaps', auto(
        { kind: 'grant_feat', value: 'lucky' },
        { kind: 'grant_ability_score', ability: 'con', amount: 1 },
        { kind: 'grant_sense', sense: 'darkvision', range: 60 },
        { kind: 'grant_speed', mode: 'fly', value: 'walk_speed' },
      ))],
    });
    // Ни одно из этих приобретений сейчас не влияет на состояние правил:
    expect(rs.abilities.con).toBe(STD.con); // прирост характеристики НЕ применён
    expect(rs.proficiencies.skills).toHaveLength(0);
    expect(rs.spells.known).toHaveLength(0);
    // и это не роняет резолвер (важно для устойчивости к контенту):
    expect(rs.conflicts).toHaveLength(0);
  });
});
