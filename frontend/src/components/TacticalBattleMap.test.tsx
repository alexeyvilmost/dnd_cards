// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SoloCombatState } from '../solo-combat/types';
import TacticalBattleMap from './TacticalBattleMap';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('TacticalBattleMap world-object clarity', () => {
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

  it('shows an inspectable Minor Illusion token with its description and counterplay', async () => {
    const state = {
      world: {
        scene: { mode: 'encounter', initiative: ['wizard'], activeIndex: 0, round: 1 },
        actors: {},
        objects: {
          illusion: {
            id: 'illusion', name: 'Minor Illusion', kind: 'spell_effect', size: 'medium',
            sourceActorId: 'wizard', sourceActionId: 'spell:minor-illusion', roundsLeft: 10,
            illusion: {
              form: 'image', description: 'Закрытая железная дверь', spellSaveDc: 13,
              studyAbility: 'int', studySkill: 'investigation', imageCubeSideFt: 5,
              discernedByActorIds: [], physicallyRevealedToActorIds: [],
            },
          },
        },
      },
      tokens: {},
      worldObjectPositions: { illusion: { x: 2, y: 3 } },
      catalogActions: [],
      movementRemainingFt: {},
    } as unknown as SoloCombatState;

    await act(async () => root.render(
      <TacticalBattleMap
        state={state}
        actorId="wizard"
        selectedActionId={null}
        movementMode={false}
        onCell={() => {}}
      />,
    ));

    const cell = container.querySelector<HTMLButtonElement>('[aria-label*="Закрытая железная дверь"]');
    expect(cell?.getAttribute('aria-label')).toContain('Интеллект (Расследование) против СЛ 13');
    expect(cell?.getAttribute('aria-label')).toContain('физическое взаимодействие раскрывает иллюзию');
    expect(cell?.querySelector('[data-world-object-id="illusion"]')?.textContent)
      .toContain('Закрытая железная дверь');
  });
});
