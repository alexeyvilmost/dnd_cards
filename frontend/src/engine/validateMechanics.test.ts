import { describe, expect, it } from 'vitest';
import { validateMechanics } from './validateMechanics';

describe('validateMechanics', () => {
  it('пустая механика — валидна', () => {
    expect(validateMechanics(null, { id: 'x', name: 'X', kind: 'passive_effect' }).valid).toBe(true);
  });

  it('валидная пассивка с auto', () => {
    const result = validateMechanics(
      {
        activation: { mode: 'passive' },
        effects: [{ resolution: 'auto', result: [{ kind: 'grant_proficiency', prof: 'skill', value: 'perception' }] }],
      },
      { id: 'darkvision', name: 'Тёмное зрение', kind: 'passive_effect' },
    );
    expect(result.valid).toBe(true);
  });

  it('блокирует невалидный activation.mode', () => {
    const result = validateMechanics(
      { activation: { mode: 'not_a_mode' }, effects: [] },
      { id: 'bad', name: 'Bad', kind: 'action' },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
