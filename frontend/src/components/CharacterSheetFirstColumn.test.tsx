// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CharacterSheetFirstColumn from './CharacterSheetFirstColumn';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const abilities = { str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10 } as const;
const abilityMods = { str: 0, dex: 3, con: 0, int: 0, wis: 0, cha: 0 } as const;

describe('CharacterSheetFirstColumn details', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('marks initiative proficiency and forwards complete save/skill breakdowns', async () => {
    const onRollSave = vi.fn();
    const onRollSkill = vi.fn();
    const initiative = {
      value: 5,
      onRoll: vi.fn(),
      breakdown: {
        value: 5,
        parts: [
          { value: 3, source: 'ЛОВ', kind: 'ability' as const },
          { value: 2, source: 'Бонус мастерства', kind: 'proficiency' as const },
        ],
      },
    };

    await act(async () => root.render(
      <CharacterSheetFirstColumn
        abilities={abilities}
        abilityMods={abilityMods}
        savingThrowProficiencies={[]}
        savingThrowBonuses={abilityMods}
        skillProficiencies={[]}
        skillExpertise={[]}
        skillBonuses={{}}
        proficiencyBonus={2}
        passivePerception={10}
        senses={[]}
        conditions={null}
        breakdownFor={(key) => {
          if (key === 'save:str') return {
            value: 2,
            parts: [{ value: 2, source: 'Защитный эффект', reason: 'проверка источника' }],
          };
          if (key.startsWith('skill:')) return {
            value: 1,
            parts: [{ value: 1, source: 'Эффект навыка', reason: 'проверка источника' }],
          };
          return null;
        }}
        onRollSave={onRollSave}
        onRollSkill={onRollSkill}
        initiative={initiative}
      />,
    ));

    const initiativeRow = container.querySelector<HTMLElement>('.cs-initiative-skill')!;
    expect(initiativeRow.classList.contains('on')).toBe(true);
    expect(initiativeRow.textContent).toContain('+5');

    await act(async () => container.querySelector<HTMLElement>('.cs-abil-save')!.click());
    expect(onRollSave).toHaveBeenCalledWith('str', expect.objectContaining({
      value: 2,
      parts: [expect.objectContaining({ source: 'Защитный эффект' })],
    }));

    const firstSkill = container.querySelector<HTMLElement>('.cs-skills li:not(.cs-initiative-skill)')!;
    await act(async () => firstSkill.click());
    expect(onRollSkill).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        value: 1,
        parts: [expect.objectContaining({ source: 'Эффект навыка' })],
      }),
    );
  });

  it('keeps initiative details visible on read-only and combat mini-sheets', async () => {
    await act(async () => root.render(
      <CharacterSheetFirstColumn
        abilities={abilities}
        abilityMods={abilityMods}
        savingThrowProficiencies={[]}
        savingThrowBonuses={abilityMods}
        skillProficiencies={[]}
        skillExpertise={[]}
        skillBonuses={{}}
        proficiencyBonus={2}
        passivePerception={10}
        senses={[]}
        conditions={null}
        initiative={{
          value: 5,
          breakdown: {
            value: 5,
            parts: [
              { value: 3, source: 'ЛОВ', kind: 'ability' },
              { value: 2, source: 'Бонус мастерства', kind: 'proficiency' },
            ],
          },
        }}
      />,
    ));
    const row = container.querySelector<HTMLElement>('.cs-initiative-skill');
    expect(row?.textContent).toContain('+5');
    expect(row?.classList.contains('on')).toBe(true);
    expect(row?.classList.contains('cs-rollable')).toBe(false);
  });
});
