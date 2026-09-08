import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { initResources, buildResourceRecharge } from '../engine/resources';
import { longRest, shortRest } from '../engine/turn';
import { collectChoices } from '../mechanics/collectChoices';
import { selectedChoicePayloads } from '../mechanics/expandChoices';
import { optionsForChoiceSource } from '../mechanics/registries';
import { validateMechanics } from '../engine/validateMechanics';
import type { CharacterContext, RuntimeState } from '../mvp/contracts';

const migration = readFileSync(new URL('../../../backend/migrations/battle_master_foundations_209.go', import.meta.url), 'utf8');
const resources = JSON.parse(migration.match(/const battleMasterResources209 = `([^`]+)`/)![1]);
const student = JSON.parse(migration.match(/const studentOfWar209 = `([^`]+)`/)![1]);
const ctx: CharacterContext = { level: 5, classLevels: { warrior: 5 }, profBonus: 3,
  abilityMods: { str: 3, dex: 2, con: 2, int: 0, wis: 0, cha: 0 } };

describe('Battle Master catalog foundations', () => {
  it('owns four dice through level five and restores them on either rest', () => {
    for (const level of [3, 4, 5]) {
      const context = { ...ctx, level, classLevels: { warrior: level }, resourceRecharge: buildResourceRecharge(resources) };
      const initialized = initResources(context, resources, []);
      expect(initialized.maxResources.superiority_die).toBe(4);
      const spent = { hp: { current: 10, max: 10, temp: 0 }, ...initialized,
        resources: { ...initialized.resources, superiority_die: 0 }, equipment: {}, inventory: [], activeEffects: [], turn: {} } as RuntimeState;
      expect(shortRest(spent, context).state.resources.superiority_die).toBe(4);
      expect(longRest(spent, context).state.resources.superiority_die).toBe(4);
    }
    expect(initResources({ ...ctx, level: 10, classLevels: { warrior: 3, wizard: 7 } }, resources, []).maxResources.superiority_die).toBe(4);
    expect(initResources({ ...ctx, classLevels: { warrior: 2 } }, resources, []).maxResources.superiority_die).toBeUndefined();
    expect(initResources(ctx, null, []).maxResources.superiority_die).toBeUndefined();
  });

  it('uses existing Forge choices and grants concrete tool and skill proficiencies', () => {
    const validation = validateMechanics(student, { id: 'EFFECT-0042', name: 'Ученик войны', kind: 'passive_effect' });
    expect(validation.valid, validation.errors.join('; ')).toBe(true);
    const choices = collectChoices(student, { kind: 'class', id: 'battle-master', name: 'Мастер боя', featureId: 'student-of-war' }, {});
    expect(choices.map(choice => [choice.source, choice.count])).toEqual([['artisan_tool', 1], ['explicit', 1]]);
    expect(optionsForChoiceSource(choices[0].source)).toHaveLength(17);
    expect(choices[1].items?.map(item => item.id)).toEqual(['acrobatics', 'animal_handling', 'athletics', 'history', 'insight', 'intimidation', 'perception', 'survival']);
    expect(selectedChoicePayloads(student.effects[0], ['smith'])).toEqual([{ kind: 'grant_proficiency', prof: 'tool', value: 'smith' }]);
    expect(selectedChoicePayloads(student.effects[1], ['perception'])).toEqual([{ kind: 'grant_proficiency', prof: 'skill', value: 'perception' }]);
  });
});
