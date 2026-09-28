import {describe, expect, it} from 'vitest';
import {emptyDraft, type AbilityKey, type CharacterDraft} from '../types';
import type {AssembledCharacter, OriginEffect} from '../assemble';
import {resolveCharacterRules} from './resolveCharacterRules';
import {auditedRow, featAudit, featEffects, auditPayloads, type AuditDict} from '../../testing/featAuditFixtures';

const abilities: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
function projection(n: number, resolvedChoices: Record<string, string[]> = {}, base = 10, extra: Partial<CharacterDraft> = {}, baseSkills: string[] = []) {
  const feat = auditedRow(`FEAT-${String(n).padStart(4, '0')}`);
  const draft = {...emptyDraft(), level: 19, abilities: Object.fromEntries(abilities.map(a => [a, base])), resolvedChoices, ...extra} as CharacterDraft;
  const effects = featEffects(n).map(effect => ({effect, origin: {kind: 'feat', id: feat.id, name: feat.name}})) as unknown as OriginEffect[];
  if (baseSkills.length) effects.unshift({effect: {id:'previous-training', name:'Previous training', mechanics:{activation:{mode:'passive'},effects:[{resolution:'auto',result:baseSkills.map(value=>({kind:'grant_proficiency',prof:'skill',value}))}]}},origin:{kind:'feat',id:'previous-feat',name:'Previous training'}} as unknown as OriginEffect);
  const assembled = {race: {id: 'species', name: 'Species', speed: 30}, klass: {id: 'class', name: 'Class', hit_die: 'd10', saving_throws: []}, effects,
    feats: [], actions: [], spells: [], pendingChoices: [], featAbilityIncreases: [], derived: {}} as unknown as AssembledCharacter;
  return resolveCharacterRules({draft, assembled});
}
function abilityChoice(n: number): {choice: AuditDict; options: AbilityKey[]} {
  for (const payload of auditPayloads(featEffects(n))) {
    if (payload.kind !== 'choice') continue;
    if (payload.grant?.kind === 'grant_ability_score') {
      return {choice: payload, options: payload.options?.source === 'ability' ? abilities : payload.options.items.map((item: AuditDict) => item.id)};
    }
    const options = payload.options?.items?.filter((item: AuditDict) => item.grants?.some((grant: AuditDict) => grant.kind === 'grant_ability_score')).map((item: AuditDict) => item.id);
    if (options?.length) return {choice: payload, options};
  }
  throw new Error(`No ability choice for ${n}`);
}

describe('fresh catalog feat declarations, independently of certification evidence', () => {
  it('audits every active feat and names specific limitations without assigning full verification', () => {
    const entries = featAudit.entities.filter(e => e.entity_type === 'feat');
    expect(entries).toHaveLength(77);
    expect(new Set(entries.map(e => e.id)).size).toBe(77);
    for (const entry of entries) {
      expect(['verified', 'partial_narrative_verified']).not.toContain(entry.review?.status);
      expect(entry.review?.limitations.length).toBeGreaterThan(0);
      const row = auditedRow(entry.id);
      for (const id of [...row.related_effects ?? [], ...row.related_actions ?? []]) expect(auditedRow(id)).toBeDefined();
    }
  });
  const scores = [...Array.from({length:43}, (_, i) => i + 11).filter(n => n !== 49), ...Array.from({length:12}, (_, i) => i + 64)];
  it.each(scores)('FEAT-%i projects every offered ASI, obeys its cap and leaves an unselected choice untouched', n => {
    const {choice, options} = abilityChoice(n);
    expect(options.length).toBeGreaterThan(0);
    const cap = n >= 64 ? 30 : 20;
    for (const ability of options) {
      const result = projection(n, {[choice.id]: [ability]}, cap - 1);
      expect(result.abilities[ability]).toBe(cap);
      expect(result.abilityMods[ability]).toBe(Math.floor((cap - 10) / 2));
      expect(projection(n, {[choice.id]: [ability]}, cap).abilities[ability]).toBe(cap);
      expect(result.abilitySources?.[ability]?.reduce((sum, part) => sum + part.value, 0)).toBe(cap);
      for (const other of abilities.filter(a => a !== ability)) expect(result.abilities[other]).toBe(cap - 1);
    }
    expect(projection(n).abilities).toEqual(Object.fromEntries(abilities.map(a => [a,10])));
  });
  it('preserves both ordinary ASI modes and caps their totals at 20', () => {
    expect(projection(49, {asi_mode: ['plus2'], asi_one: ['str']}, 19).abilities.str).toBe(20);
    const split = projection(49, {asi_mode: ['plus1x2'], asi_two: ['wis','cha']}, 19);
    expect(split.abilities).toMatchObject({wis:20, cha:20, str:19});
  });
  it.each([1,4,19])('Alert and Tough scale at level %i', level => {
    const proficiency = Math.floor((level - 1)/4) + 2;
    expect(projection(1, {}, 10, {level}).initiativeBonus).toBe(proficiency);
    const baseline = projection(64, {}, 10, {level});
    expect(projection(5, {}, 10, {level}).maxHP - baseline.maxHP).toBe(2 * level);
  });
  it('projects the modest origin grants without promoting all their combat behaviors', () => {
    expect(projection(3).proficiencies.weapons).toContain('improvised');
    const skilled = projection(8, {feat_skilled: ['skill:athletics', 'tool:cook', 'tool:flute']});
    expect(skilled.proficiencies.skills).toContain('athletics');
    expect(skilled.proficiencies.tools).toEqual(expect.arrayContaining(['cook','flute']));
    const crafted = projection(10, {crafter_tools: ['smith','weaver','woodcarver']});
    expect(crafted.proficiencies.tools).toEqual(expect.arrayContaining(['smith','weaver','woodcarver']));
    const choice = [...auditPayloads(featEffects(10))].find(p => p.id === 'crafter_tools')!;
    expect(choice.options.items.map((p: AuditDict) => p.id).sort()).toEqual(['carpenter','leatherworker','mason','potter','smith','tinker','weaver','woodcarver'].sort());
  });
  it.each([9,77,78])('Magic Initiate %i keeps a selectable casting ability and its two-plus-one spell grants', n => {
    const choices = [...auditPayloads(featEffects(n))].filter(p => p.kind === 'choice');
    const ability = choices.find(p => p.grant?.kind === 'spellcasting_ability')!;
    const cantrips = choices.find(p => p.grant?.label === 'cantrip')!;
    const spell = choices.find(p => p.grant?.label === 'always_prepared')!;
    expect(cantrips.count).toBe(2);
    expect(spell.count).toBe(1);
    const result = projection(n, {[ability.id]: ['cha'], [cantrips.id]: ['audit-cantrip-a','audit-cantrip-b'], [spell.id]: ['audit-level-one']});
    expect(result.appliedGrants.filter(g => g.kind === 'spell').map(g => g.value).sort()).toEqual(['audit-cantrip-a','audit-cantrip-b','audit-level-one']);
    expect(result.appliedGrants.find(g => g.value === 'audit-level-one')?.freeuse).toMatchObject({count:1, recharge:'long_rest'});
  });
  it('projects actual movement and senses from four separate feat declarations', () => {
    expect(projection(13).speeds.climb).toBe(30);
    expect(projection(16).speed).toBe(40);
    expect(projection(71).speed).toBe(60);
    expect(projection(40).senses).toContainEqual({sense:'blindsight',range:10});
    expect(projection(60).senses).toContainEqual({sense:'blindsight',range:10});
    expect(projection(67).senses).toContainEqual({sense:'truesight',range:60});
  });
  it('projects martial, armor and canonical tool proficiencies', () => {
    expect(projection(19).proficiencies.weapons).toContain('martial');
    expect(projection(23).proficiencies.armor).toEqual(expect.arrayContaining(['light','shield']));
    expect(projection(24).proficiencies.armor).toContain('medium');
    expect(projection(25).proficiencies.armor).toContain('heavy');
    expect(projection(38).proficiencies.tools).toContain('poisoner_kit');
    expect(projection(51).proficiencies.tools).toContain('cook');
  });
  it.each([[18,'observant_skill','perception'], [37,'keen_mind_skill','arcana']])('feat %i gives proficiency or expertise according to existing skill ownership', (n,key,skill) => {
    const novice = projection(Number(n), {[key]: [String(skill)]});
    expect(novice.proficiencies.skills).toContain(skill);
    const trained = projection(Number(n), {[key]: [String(skill)]}, 10, {}, [String(skill)]);
    expect(trained.expertise.skills).toContain(skill);
  });
  it('Resilient couples a saving throw to the selected ability', () => {
    for (const ability of abilities) {
      const result = projection(50, {general_feat_ability_increase:[ability]}, 19);
      expect(result.proficiencies.savingThrows).toEqual([ability]);
      expect(result.savingThrowBonuses[ability]).toBe(11);
    }
  });
  it('Skill Expert and Skill boon project declared proficiencies and expertise', () => {
    const expert = projection(53, {skill_expert_proficiencies:['arcana','history'], skill_expert_expertise:['history']});
    expect(expert.proficiencies.skills).toEqual(expect.arrayContaining(['arcana','history']));
    expect(expert.expertise.skills).toContain('history');
    const boon = projection(75, {epic_boon_skill_expertise:['stealth']});
    expect(boon.proficiencies.skills).toHaveLength(18);
    expect(boon.expertise.skills).toEqual(['stealth']);
    expect(boon.skillBonuses.stealth).toBe(12);
  });
  it('Fortitude adds exactly forty maximum hit points', () => {
    expect(projection(73).maxHP - projection(64).maxHP).toBe(40);
  });
  it('Spell Sniper no longer grants a cantrip absent from its description', () => {
    expect([...auditPayloads(featEffects(33))].filter(p => p.kind === 'grant_spell')).toEqual([]);
    expect([...auditPayloads(featEffects(33))].filter(p => p.kind === 'modifier')).toHaveLength(4);
  });
});
