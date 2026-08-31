import { describe, expect, it } from 'vitest';
import { activeEffectDurationLabel, activeEffectInstruction, expiryLabel, groupActiveEffectsForDisplay, removeActiveEffectGroup } from './effects';

describe('подпись длительности активного эффекта', () => {
  it('показывает оставшиеся ходы вместо «без срока»', () => {
    expect(expiryLabel(undefined, 10)).toBe('10 ходов');
    expect(expiryLabel(undefined, 2)).toBe('2 хода');
    expect(expiryLabel(undefined, 1)).toBe('1 ход');
  });
});

describe('группировка активных эффектов для игрока', () => {
  const largeForm = [
    {
      id: 'large:size', name: 'Большая форма', source: 'Большая форма', roundsLeft: 8,
      mechanics: { kind: 'modifier', applies_to: { roll: 'size' }, op: 'add', value: 1 },
    },
    {
      id: 'large:speed', name: 'Большая форма', source: 'Большая форма', roundsLeft: 8,
      mechanics: { kind: 'modifier', applies_to: { roll: 'speed' }, op: 'add', value: 10 },
    },
  ];

  it('показывает payload-строки одной способности один раз с обеими механиками', () => {
    const groups = groupActiveEffectsForDisplay(largeForm);
    expect(groups).toHaveLength(1);
    expect(groups[0].instructions).toEqual(['Размер: на одну категорию больше.', 'Скорость: +10 фт.']);
  });

  it('снимает всю показанную группу, не оставляя скрытых payload-строк', () => {
    const state = {
      hp: { current: 10, max: 10, temp: 0 }, resources: {}, maxResources: {},
      equipment: {}, inventory: [], activeEffects: largeForm,
    } as never;
    const result = removeActiveEffectGroup(state, largeForm.map((effect) => effect.id));
    expect(result.state.activeEffects).toEqual([]);
    expect(result.events).toHaveLength(2);
  });

  it('локализует состояние и объясняет механику, источник и срок действия', () => {
    const groups = groupActiveEffectsForDisplay([{
      id: 'ray-poison', name: 'poisoned', source: 'Луч болезни', expiry: 'source_turn',
      sourceTurnExpiry: {
        sourceActorId: 'drow', ownerActorId: 'goblin', boundary: 'end',
      },
      mechanics: { kind: 'condition', value: 'poisoned' },
    }]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      name: 'Отравлен',
      source: 'Луч болезни',
      duration: 'до конца следующего хода источника',
      instructions: [
        'Помеха на броски атак.',
        'Помеха на проверки характеристик.',
      ],
    });
  });
});

describe('инструкция активного талона', () => {
  it('объясняет получателю Вдохновения барда кость, допустимые броски и расход', () => {
    expect(activeEffectInstruction({
      id: 'boon-1',
      name: 'Талон 1к6 (Вдохновение барда)',
      source: 'Вдохновение барда',
      expiry: 'manual',
      mechanics: {
        kind: 'boon', die: '1d6',
        applies_to: ['ability_check', 'attack_roll', 'saving_throw'],
      },
    })).toBe(
      'Чтобы использовать: бросьте отдельный 1к6, вручную добавьте результат к проверке характеристики, броску атаки или спасброску, затем нажмите × «Снять вручную».',
    );
  });

  it('объясняет дистанцию, срок и ограничения Камнечувствия', () => {
    expect(activeEffectInstruction({
      id: 'stonecunning-1', name: 'Камнечувствие', source: 'Камнечувствие', roundsLeft: 100,
      mechanics: {
        kind: 'grant_sense', sense: 'tremorsense', range: 60,
        senseScope: {
          kind: 'stonework', sameSurfaceOnly: true,
          detectsAirborne: false, grantsSight: false,
        },
      },
    })).toBe(
      'Чувство вибрации: 60 фт. (100 ходов); только по той же каменной поверхности; не обнаруживает существ в воздухе; не даёт видеть.',
    );
  });

  it('объясняет получателю метод КД, восьмичасовой срок и окончание Доспехов мага', () => {
    expect(activeEffectInstruction({
      id: 'mage-armor', name: 'Доспехи мага', source: 'Доспехи мага', roundsLeft: 4_800,
      mechanics: {
        duration: { type: 'rounds', amount: 4_800 },
        end_triggers: ['wearer_dons_armor'],
        effects: [{
          resolution: 'auto',
          result: [{ kind: 'set_value', target: 'ac_base', formula: '13 + dex' }],
        }],
      },
    })).toBe(
      'КД: 13 + модификатор Ловкости. Срок: 8 часов. Эффект закончится, если вы наденете доспех.',
    );
  });

  it('не придумывает инструкцию для автоматического эффекта', () => {
    expect(activeEffectInstruction({
      id: 'light-1', name: 'Свет', source: 'Свет', expiry: 'manual',
      mechanics: { kind: 'narrative' },
    })).toBeNull();
  });

  it('уточняет текущий source-turn после наступления хода источника', () => {
    expect(activeEffectDurationLabel({
      id: 'ray-poison', name: 'poisoned', source: 'Луч болезни', expiry: 'source_turn',
      sourceTurnExpiry: {
        sourceActorId: 'drow', ownerActorId: 'goblin', boundary: 'end', armed: true,
      },
      mechanics: { kind: 'condition', value: 'poisoned' },
    })).toBe('до конца текущего хода источника');
  });
});
