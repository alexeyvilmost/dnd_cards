// @vitest-environment jsdom

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SheetAtomicRetryEnvelope } from '../character/sheetAtomicRetry';
import type { ForgeCharacter } from '../character/types';
import CharacterSheetV2 from './CharacterSheetV2';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../settings', () => ({
  useSiteSettings: () => ({ entityDisplay: { effects: 'cards', actions: 'cards' } }),
}));

vi.mock('../contexts/DiceDialogContext', () => ({
  useDiceDialog: () => ({ request: vi.fn() }),
}));

vi.mock('../components/SheetActionsPanel', () => ({
  default: (props: {
    character: ForgeCharacter;
    spellsOnly?: boolean;
    pendingAtomicRetry?: SheetAtomicRetryEnvelope | null;
    onPendingAtomicRetryChange?: (retry: SheetAtomicRetryEnvelope | null) => void;
    showAtomicRetryControl?: boolean;
  }) => {
    const panel = props.spellsOnly ? 'spells' : 'actions';
    return (
      <button
        type="button"
        data-testid={`${panel}-atomic-panel`}
        data-command-id={props.pendingAtomicRetry?.prepared.request.command_id ?? ''}
        data-show-retry-control={String(props.showAtomicRetryControl !== false)}
        disabled={Boolean(props.pendingAtomicRetry)}
        onClick={() => props.onPendingAtomicRetryChange?.({
          characterId: props.character.id,
          kind: 'ordinary_spell',
          prepared: {
            request: { command_id: 'atomic-command' },
          },
        } as SheetAtomicRetryEnvelope)}
      >
        {panel}
      </button>
    );
  },
}));

vi.mock('../components/CharacterSheetFirstColumn', () => ({
  CHARACTER_SENSE_LABELS: {},
  default: () => null,
}));
vi.mock('../components/SheetRestButtons', () => ({ default: () => null }));
vi.mock('../components/SheetConditionsPanel', () => ({ default: () => null }));
vi.mock('../components/SheetEquipmentPanel', () => ({ default: () => null }));
vi.mock('../components/SheetInPlayController', () => ({ default: () => null }));
vi.mock('../components/SheetHpDialog', () => ({ default: () => null }));
vi.mock('../components/EffectiveSenseValue', () => ({ default: () => null }));
vi.mock('../components/forge/ForgeAbilityDisplay', () => ({ default: () => null }));
vi.mock('../components/ValueBreakdownPanel', () => ({ default: () => null }));
vi.mock('../components/ValueBreakdownTip', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../components/CollapsibleSection', () => ({
  default: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
}));

const abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
const character = {
  id: 'hero',
  name: 'Hero',
  level: 1,
  current_hp: 10,
  inventory_items: [],
  revision: 1,
} as unknown as ForgeCharacter;

const baseProps = {
  character,
  assembled: {
    actions: [],
    spells: [{ id: 'spell', name: 'Spell' }],
    feats: [],
    effects: [],
  },
  ruleState: {
    abilities,
    abilityMods: abilities,
    proficiencyBonus: 2,
    proficiencies: { savingThrows: [], skills: [], languages: [] },
    expertise: { skills: [] },
    savingThrowBonuses: {},
    skillBonuses: {},
    maxHP: 10,
    armorClass: 10,
    initiativeBonus: 0,
    speed: 30,
    speeds: {},
    passivePerception: 10,
    spellcasting: null,
  },
  effectiveSenses: [],
  draft: { level: 1 },
  sheetCtx: null,
  runtimeState: null,
  passives: [],
  equipCards: new Map(),
  acBreakdown: null,
  maxHpBreakdown: null,
  initBreakdown: null,
  speedBreakdown: null,
  spellsByLevel: [],
  lineageName: null,
  inPlayChoices: [],
  onUpdated: vi.fn(),
  onEvents: vi.fn(),
  onPersistedEvents: vi.fn(),
  readOnly: false,
} as unknown as Omit<React.ComponentProps<typeof CharacterSheetV2>,
  'pendingAtomicRetry' | 'onPendingAtomicRetryChange'>;

function Harness() {
  const [pendingAtomicRetry, setPendingAtomicRetry] = useState<SheetAtomicRetryEnvelope | null>(null);
  return (
    <CharacterSheetV2
      {...baseProps}
      pendingAtomicRetry={pendingAtomicRetry}
      onPendingAtomicRetryChange={setPendingAtomicRetry}
    />
  );
}

describe('CharacterSheetV2 atomic retry ownership', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it('shares one exact retry envelope across Action and Spells siblings', async () => {
    await act(async () => root.render(<Harness />));
    const actions = container.querySelector<HTMLButtonElement>('[data-testid="actions-atomic-panel"]')!;
    const spells = container.querySelector<HTMLButtonElement>('[data-testid="spells-atomic-panel"]')!;

    expect(actions.disabled).toBe(false);
    expect(spells.disabled).toBe(false);
    expect(actions.dataset.showRetryControl).toBe('true');
    expect(spells.dataset.showRetryControl).toBe('false');

    await act(async () => spells.click());

    expect(actions.disabled).toBe(true);
    expect(spells.disabled).toBe(true);
    expect(actions.dataset.commandId).toBe('atomic-command');
    expect(spells.dataset.commandId).toBe('atomic-command');
  });
});
