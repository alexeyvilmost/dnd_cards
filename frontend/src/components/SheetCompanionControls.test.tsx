// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SheetCompanionControlModel } from '../character/sheetCompanionActions';
import SheetCompanionControls from './SheetCompanionControls';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const model: SheetCompanionControlModel = {
  blockedReason: null,
  familiar: {
    actorId: 'familiar', name: 'Owl', presence: 'present', extension: 'base',
    reactionAvailable: true, attackActionIds: [],
  },
  touchSpells: [{
    action: {
      id: 'spell:touch', name: 'Data Touch', kind: 'spell', sourceEntityIds: ['spell:touch'],
      spell: { level: 0 }, mechanics: {}, targeting: {
        minTargets: 1, maxTargets: 1, rangeFt: 5, requiresLineOfSight: false,
        requiresTouch: true, allowedRelations: ['ally'],
      },
    },
    castOptions: [{
      id: 'cast:grant', label: 'Exact grant', grant: {
        grantId: 'grant', actionId: 'spell:touch', sourceId: 'source', access: 'cantrip',
        level: 0, spellcastingAbility: 'int',
      },
      payment: { kind: 'none' },
      declaration: { grantId: 'grant', mode: 'normal' },
    }],
  }],
  pactBlade: null,
  pactTome: null,
};

function change(element: HTMLInputElement | HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('SheetCompanionControls', () => {
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

  it('requires every observable fact before emitting a two-sheet Touch declaration', async () => {
    const onDeliverTouch = vi.fn();
    await act(async () => root.render(<SheetCompanionControls
      model={model}
      targets={[{ id: 'target', name: 'Target' }]}
      onDismiss={() => undefined}
      onReappear={() => undefined}
      onReplaceTome={() => undefined}
      onTouchPactBlade={() => undefined}
      onDeliverTouch={onDeliverTouch}
    />));
    const button = [...container.querySelectorAll('button')]
      .find((entry) => entry.textContent === 'Доставить через фамильяра')!;
    expect(button.disabled).toBe(true);
    const set = (label: string, value: string) => change(
      container.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | HTMLSelectElement,
      value,
    );
    await act(async () => {
      set('Touch-заклинание', 'spell:touch');
      set('Источник Touch-заклинания', 'cast:grant');
      set('Цель Touch-заклинания', 'target');
      set('Дистанция до фамильяра', '80');
      set('Видимость фамильяра', 'no');
      set('Дистанция от фамильяра до цели', '5');
      set('Видимость цели фамильяром', 'yes');
      set('Укрытие цели', 'none');
      set('Отношение к цели', 'ally');
      set('Согласие цели', 'yes');
    });
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(onDeliverTouch).toHaveBeenCalledWith({
      spellActionId: 'spell:touch', castOptionId: 'cast:grant', targetActorId: 'target',
      ownerDistanceFt: 80, ownerLineOfSight: false,
      targetDistanceFt: 5, targetLineOfSight: true,
      cover: 'none', relation: 'ally', willing: true,
    });
  });

  it('shows the online authority reason and disables mutation controls', async () => {
    await act(async () => root.render(<SheetCompanionControls
      model={{ ...model, blockedReason: 'online authority gap' }}
      targets={[]}
      onDismiss={() => undefined}
      onReappear={() => undefined}
      onReplaceTome={() => undefined}
      onTouchPactBlade={() => undefined}
      onDeliverTouch={() => undefined}
    />));
    expect(container.textContent).toContain('online authority gap');
    expect([...container.querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
    expect(container.textContent).toContain('Атака Pact Chain отключена');
  });
});
