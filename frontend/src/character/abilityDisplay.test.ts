import { describe, expect, it } from 'vitest';
import { effectAbilityPresentation, stripFightingStylePrefix } from './abilityDisplay';
import type { ChoiceOrigin } from '../mechanics/collectChoices';
import type { Feat, PassiveEffect } from '../types';

const feat = (over: Partial<Feat> = {}): Feat => ({
  id: 'feat-1',
  name: 'Оборона',
  description: '',
  rarity: 'common',
  card_number: 'FEAT-0056',
  category: 'fighting_style',
  related_effects: [],
  related_actions: [],
  repeatable: false,
  created_at: '',
  updated_at: '',
  ...over,
});

const effect = (over: Partial<PassiveEffect> = {}): PassiveEffect => ({
  id: 'eff-1',
  name: 'Боевой стиль: Оборона',
  description: '',
  rarity: 'common',
  card_number: 'fs_defense',
  effect_type: 'class_ability',
  created_at: '',
  updated_at: '',
  ...over,
} as PassiveEffect);

const origin: ChoiceOrigin = { kind: 'feat', id: 'feat-1', name: 'Оборона' };

describe('abilityDisplay — боевые стили', () => {
  it('stripFightingStylePrefix убирает префикс сида', () => {
    expect(stripFightingStylePrefix('Боевой стиль: Оборона')).toBe('Оборона');
    expect(stripFightingStylePrefix('Оборона')).toBe('Оборона');
  });

  it('показывает имя как в кузне и подпись «Боевой стиль»', () => {
    const p = effectAbilityPresentation(effect(), origin, [feat()], (k) => (k === 'feat' ? 'Черта' : k));
    expect(p.name).toBe('Оборона');
    expect(p.sourceLabel).toBe('Боевой стиль · Оборона');
    expect(p.effect.name).toBe('Оборона');
  });

  it('обычные эффекты не трогает', () => {
    const e = effect({ name: 'Второе дыхание', card_number: 'EFF-second-wind' });
    const o: ChoiceOrigin = { kind: 'class', id: 'c1', name: 'Воин' };
    const p = effectAbilityPresentation(e, o, [], (k) => (k === 'class' ? 'Класс' : k));
    expect(p.name).toBe('Второе дыхание');
    expect(p.sourceLabel).toBe('Класс · Воин');
  });
});
