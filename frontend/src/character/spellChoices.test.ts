import { describe, expect, it } from 'vitest';
import type { PendingChoice } from '../mechanics/collectChoices';
import type { Spell } from '../types';
import { spellMatchesChoice } from './spellChoices';

const spell = (id: string, level: number, classes: string[]): Spell =>
  ({ id, level, classes } as Spell);

const choice = (filter: unknown): PendingChoice =>
  ({
    id: 'choice',
    source: 'spell',
    count: 1,
    prompt: 'Выберите заклинание',
    origin: { kind: 'class', id: 'class-id', name: 'Класс' },
    options: { filter },
  } as unknown as PendingChoice);

describe('spellMatchesChoice', () => {
  it('фильтрует заговоры и классовые списки тем же правилом, что кузница', () => {
    const fireBolt = spell('fire-bolt', 0, ['wizard']);
    const guidance = spell('guidance', 0, ['cleric', 'druid']);

    expect(spellMatchesChoice(fireBolt, choice({ levels: [0], classes: ['wizard'] }))).toBe(true);
    expect(spellMatchesChoice(guidance, choice({ levels: [0], classes: ['wizard'] }))).toBe(false);
    expect(spellMatchesChoice(guidance, choice('cantrip'))).toBe(true);
  });

  it('учитывает максимальный доступный круг', () => {
    const shield = spell('shield', 1, ['wizard']);
    const mistyStep = spell('misty-step', 2, ['wizard']);
    const available = choice({ only_available_slots: true, classes: ['wizard'] });

    expect(spellMatchesChoice(shield, available, 1)).toBe(true);
    expect(spellMatchesChoice(mistyStep, available, 1)).toBe(false);
  });

  it('для подготовки допускает только фактические записи выбранной книги', () => {
    const prepared = {
      ...choice({}),
      source: 'prepared_spell',
      allowedOptionIds: ['shield-card', 'magic-missile'],
    };
    const shield = { ...spell('shield-uuid', 1, ['wizard']), card_number: 'shield-card' };
    expect(spellMatchesChoice(shield, prepared)).toBe(true);
    expect(spellMatchesChoice(spell('sleep', 1, ['wizard']), prepared)).toBe(false);
  });
});
