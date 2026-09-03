import { describe, expect, it } from 'vitest';
import type { PendingChoice } from '../mechanics/collectChoices';
import type { Spell } from '../types';
import { preparedSpellChoiceAllowsOwnedOption, spellMatchesChoice } from './spellChoices';

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

  it('не протекает текущий высокий круг в повторный выбор с прошлого уровня', () => {
    const firstLevel = spell('shield', 1, ['wizard']);
    const secondLevel = spell('misty-step', 2, ['wizard']);
    const thirdLevel = spell('fireball', 3, ['wizard']);
    const historical = {
      ...choice({ only_available_slots: true, classes: ['wizard'] }),
      origin: {
        kind: 'class' as const,
        id: 'wizard',
        name: 'Wizard',
        progressionLevel: 2,
        spellSlotLevelCap: 1,
      },
    };

    expect(spellMatchesChoice(firstLevel, historical, 3)).toBe(true);
    expect(spellMatchesChoice(secondLevel, historical, 3)).toBe(false);
    expect(spellMatchesChoice(thirdLevel, historical, 3)).toBe(false);
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

  it('позволяет повторно выбрать для подготовки заклинание из любого level-up добавления книги', () => {
    const prepared = {
      ...choice({}),
      source: 'prepared_spell',
      preparedSpellSourceChoiceId: 'class:wizard:spellcasting:wizard_book',
      allowedOptionIds: ['SPELL-SHIELD', 'spell-misty-step', 'spell-fireball'],
    };
    const canonical = (reference: string) => (
      reference === 'SPELL-SHIELD' ? 'spell-shield' : reference
    );

    // The owner choice id for misty-step/fireball is intentionally different
    // from preparedSpellSourceChoiceId: each level-up book addition is scoped.
    expect(preparedSpellChoiceAllowsOwnedOption(prepared, 'spell-shield', canonical)).toBe(true);
    expect(preparedSpellChoiceAllowsOwnedOption(prepared, 'spell-misty-step', canonical)).toBe(true);
    expect(preparedSpellChoiceAllowsOwnedOption(prepared, 'spell-fireball', canonical)).toBe(true);
    expect(preparedSpellChoiceAllowsOwnedOption(prepared, 'spell-sleep', canonical)).toBe(false);
    expect(preparedSpellChoiceAllowsOwnedOption(choice({}), 'spell-shield', canonical)).toBe(false);
  });

  it('фильтрует школу без учёта регистра для Shadow/Fey Touched', () => {
    const illusion = { ...spell('disguise-self', 1, ['wizard']), school: 'Illusion' };
    const evocation = { ...spell('burning-hands', 1, ['wizard']), school: 'evocation' };
    const shadow = choice({ levels: [1], schools: ['illusion', 'necromancy'] });

    expect(spellMatchesChoice(illusion, shadow)).toBe(true);
    expect(spellMatchesChoice(evocation, shadow)).toBe(false);
  });

  it('допускает для Ritual Caster только ритуальные заклинания', () => {
    const ritual = { ...spell('detect-magic', 1, ['wizard']), ritual: true };
    const ordinary = { ...spell('shield', 1, ['wizard']), ritual: false };

    expect(spellMatchesChoice(ritual, choice({ levels: [1], ritual: true }))).toBe(true);
    expect(spellMatchesChoice(ordinary, choice({ levels: [1], ritual: true }))).toBe(false);
  });

  it('для Spell Sniper показывает только заговоры с броском атаки', () => {
    const attack = {
      ...spell('fire-bolt', 0, ['wizard']),
      mechanics: { effects: [{ resolution: 'attack_roll', on_hit: [] }] },
    };
    const save = {
      ...spell('sacred-flame', 0, ['cleric']),
      mechanics: { effects: [{ resolution: 'save', ability: 'dex', on_fail: [] }] },
    };
    const filter = choice({
      levels: [0],
      classes: ['bard', 'cleric', 'druid', 'sorcerer', 'warlock', 'wizard'],
      requires_attack_roll: true,
    });

    expect(spellMatchesChoice(attack, filter)).toBe(true);
    expect(spellMatchesChoice(save, filter)).toBe(false);
  });
});
