import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import CombatActorInspector, { collectCombatDefenses } from './CombatActorInspector';
import { combatGrappleStatusRows } from '../solo-combat/grapplePresentation';

describe('combat actor inspector defenses', () => {
  it('derives defenses recursively from mechanics primitives and deduplicates them', () => {
    expect(collectCombatDefenses([{
      effects: [
        { kind: 'resistance', damage_type: 'fire', value: 'resistance' },
        { kind: 'resistance', damage_type: 'cold', value: 'immunity' },
        { kind: 'condition_immunity', condition: 'poisoned' },
        { nested: { kind: 'resistance', damage_type: 'fire', value: 'resistance' } },
      ],
    }])).toEqual([
      { kind: 'resistance', value: 'fire' },
      { kind: 'immunity', value: 'cold' },
      { kind: 'condition_immunity', value: 'poisoned' },
    ]);
  });

  it('does not infer defenses from descriptive prose', () => {
    expect(collectCombatDefenses([{ description: 'Иммунитет к огню' }])).toEqual([]);
  });

  it('renders Ray of Sickness condition rules, source, and duration on the mounted monster inspector', () => {
    const state = {
      world: {
        actors: {
          goblin: {
            name: 'Гоблин-воин', ac: 15, passives: [],
            character: {
              baseSpeed: 30, characterSpeed: 30, creatureType: 'Гуманоид',
              abilityScores: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
              abilityMods: { str: -1, dex: 2, con: 0, int: 0, wis: -1, cha: -1 },
            },
            capabilities: { actionIds: [] },
            runtime: {
              hp: { current: 2, max: 10, temp: 0 }, resources: {}, maxResources: {},
              equipment: {}, inventory: [],
              activeEffects: [{
                id: 'ray-poison', name: 'poisoned', source: 'Луч болезни', expiry: 'source_turn',
                sourceTurnExpiry: {
                  sourceActorId: 'drow', ownerActorId: 'goblin', boundary: 'end',
                },
                mechanics: { kind: 'condition', value: 'poisoned' },
              }, {
                id: 'chill-touch', name: 'Леденящее прикосновение',
                source: 'Леденящее прикосновение', expiry: 'source_turn',
                sourceTurnExpiry: {
                  sourceActorId: 'wizard', ownerActorId: 'goblin', boundary: 'end',
                },
                mechanics: { kind: 'modifier', applies_to: { roll: 'healing' }, op: 'deny' },
              }],
            },
          },
        },
        grapples: {},
      },
      actorPresentation: {}, tokens: {}, catalogActions: [], actionPresentation: {},
    } as unknown as Parameters<typeof CombatActorInspector>[0]['state'];
    const html = renderToStaticMarkup(createElement(CombatActorInspector, {
      state, actorId: 'goblin', onClose: () => {},
    }));
    expect(html).toContain('Отравлен');
    expect(html).toContain('Источник: Луч болезни');
    expect(html).toContain('Длительность: до конца следующего хода источника');
    expect(html).toContain('Помеха на броски атак.');
    expect(html).toContain('Помеха на проверки характеристик.');
    expect(html).toContain('Леденящее прикосновение');
    expect(html).toContain('Не может восстанавливать Хиты.');
    expect(html).not.toContain('<strong>poisoned</strong>');
  });

  it('explains a persisted grapple to both participants', () => {
    const world = {
      actors: {
        fighter: { name: 'Дворф' },
        goblin: { name: 'Гоблин' },
      },
      grapples: {
        hold: {
          id: 'hold', grapplerActorId: 'fighter', targetActorId: 'goblin',
          sourcePart: 'off_hand', escapeDc: 13, reachFt: 5,
          sourceEntityIds: ['system:unarmed'], startedAtRevision: 1,
        },
      },
    } as unknown as Parameters<typeof combatGrappleStatusRows>[0];
    expect(combatGrappleStatusRows(world, 'goblin')).toEqual([{
      key: 'grappled:hold', name: 'Схвачен',
      instructions: ['Захватил: Дворф.', 'Скорость — 0; освобождение — действием против Сл 13.'],
    }]);
    expect(combatGrappleStatusRows(world, 'fighter')).toEqual([{
      key: 'grappling:hold', name: 'Удерживает захват',
      instructions: ['Цель: Гоблин.', 'Занята: свободная рука.'],
    }]);
  });
});
