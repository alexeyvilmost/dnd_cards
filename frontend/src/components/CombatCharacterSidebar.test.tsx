import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ActiveEffectEntry } from '../mvp/contracts';
import { CombatActiveEffects } from './CombatCharacterSidebar';
import CombatCharacterSidebar from './CombatCharacterSidebar';

describe('CombatActiveEffects', () => {
  it('shows an ally how to use Bardic Inspiration at the combat point of inspection', () => {
    const effects: ActiveEffectEntry[] = [{
      id: 'bardic-token',
      name: 'Талон 1к6 (Вдохновение барда)',
      source: 'Вдохновение барда',
      expiry: 'manual',
      mechanics: {
        kind: 'boon', die: '1d6',
        applies_to: ['ability_check', 'attack_roll', 'saving_throw'],
      },
    }];

    const html = renderToStaticMarkup(createElement(CombatActiveEffects, { effects }));
    expect(html).toContain('Талон 1к6 (Вдохновение барда)');
    expect(html).toContain('Добавьте 1к6 к проверке характеристики, броску атаки или спасброску, затем снимите эффект.');
  });

  it('shows Stonecunning scope and limitations in the mounted combat drawer', () => {
    const effects: ActiveEffectEntry[] = [{
      id: 'stonecunning', name: 'Камнечувствие', source: 'Камнечувствие', roundsLeft: 100,
      mechanics: {
        kind: 'grant_sense', sense: 'tremorsense', range: 60,
        senseScope: {
          kind: 'stonework', sameSurfaceOnly: true,
          detectsAirborne: false, grantsSight: false,
        },
      },
    }];

    const html = renderToStaticMarkup(createElement(CombatActiveEffects, { effects }));
    expect(html).toContain('Камнечувствие');
    expect(html).toContain('Чувство вибрации: 60 фт. (100 ходов)');
    expect(html).toContain('только по той же каменной поверхности');
    expect(html).toContain('не обнаруживает существ в воздухе');
    expect(html).toContain('не даёт видеть');
  });
});

describe('CombatCharacterSidebar defenses', () => {
  it('shows a controlled character passive resistance and species trait at inspection time', () => {
    const state = {
      characterId: 'dwarf',
      world: {
        actors: {
          dwarf: {
            name: 'Дворф',
            ac: 11,
            character: {
              abilityScores: { str: 17, dex: 13, con: 15, int: 8, wis: 12, cha: 10 },
              abilityMods: { str: 3, dex: 1, con: 2, int: -1, wis: 1, cha: 0 },
              profBonus: 2,
            },
            passives: [{ kind: 'resistance', damage_type: 'poison', value: 'resistance' }],
            runtime: { activeEffects: [] },
            capabilities: { actionIds: [] },
          },
        },
        grapples: {},
      },
      actorPresentation: {
        dwarf: {
          traits: [{ id: 'dwarven-resilience', name: 'Дварфская стойкость', description: 'Сопротивление урону ядом.', mechanics: [] }],
        },
      },
    } as unknown as Parameters<typeof CombatCharacterSidebar>[0]['state'];
    const character = {
      proficiency_bonus: 2,
      rule_state: {
        abilities: { str: 17, dex: 13, con: 15, int: 8, wis: 12, cha: 10 },
        abilityMods: { str: 3, dex: 1, con: 2, int: -1, wis: 1, cha: 0 },
        proficiencies: { savingThrows: [], skills: [] },
        expertise: { skills: [] },
        savingThrowBonuses: { str: 3, dex: 1, con: 2, int: -1, wis: 1, cha: 0 },
        skillBonuses: {},
        passivePerception: 11,
        senses: [],
      },
    } as unknown as Parameters<typeof CombatCharacterSidebar>[0]['character'];

    const html = renderToStaticMarkup(createElement(CombatCharacterSidebar, { character, state, actorId: 'dwarf' }));
    expect(html).toContain('Защита');
    expect(html).toContain('Сопротивление урону');
    expect(html).toContain('Яд');
    expect(html).toContain('Особенности');
    expect(html).toContain('Дварфская стойкость');
  });
});
