import { describe, expect, it } from 'vitest';
import { activeEffectInstruction, expiryLabel } from './effects';

describe('подпись длительности активного эффекта', () => {
  it('показывает оставшиеся ходы вместо «без срока»', () => {
    expect(expiryLabel(undefined, 10)).toBe('10 ходов');
    expect(expiryLabel(undefined, 2)).toBe('2 хода');
    expect(expiryLabel(undefined, 1)).toBe('1 ход');
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
      'Добавьте 1к6 к проверке характеристики, броску атаки или спасброску, затем снимите эффект.',
    );
  });

  it('не придумывает инструкцию для автоматического эффекта', () => {
    expect(activeEffectInstruction({
      id: 'light-1', name: 'Свет', source: 'Свет', expiry: 'manual',
      mechanics: { kind: 'narrative' },
    })).toBeNull();
  });
});
