// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveEffectEntry } from '../mvp/contracts';
import RemoteManipulatorControl, { remoteManipulatorSpec } from './RemoteManipulatorControl';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const effect: ActiveEffectEntry = {
  id: 'mage-hand', name: 'Волшебная рука', source: 'Волшебная рука', roundsLeft: 10,
  mechanics: {
    kind: 'remote_manipulator', max_distance_ft: 30, move_per_action_ft: 30,
    max_load_lb: 10,
    allowed_operations: ['move_object', 'open_unlocked_door'],
  },
};

describe('RemoteManipulatorControl', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('finds the persisted constraints and submits a structured player command', async () => {
    expect(remoteManipulatorSpec(effect)).toEqual({
      maxDistanceFt: 30,
      movePerActionFt: 30,
      maxLoadLb: 10,
      allowedOperations: ['move_object', 'open_unlocked_door'],
    });
    const onExecute = vi.fn();
    await act(async () => root.render(<RemoteManipulatorControl effect={effect} onExecute={onExecute} />));

    const open = [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Управлять рукой'));
    expect(open).toBeTruthy();
    await act(async () => open!.click());
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();

    const object = container.querySelector('input[placeholder*="рычаг"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(object, 'рычаг у двери');
      object.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const numbers = [...container.querySelectorAll('input[type="number"]')] as HTMLInputElement[];
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      for (const [field, value] of [[numbers[0], '20'], [numbers[1], '8'], [numbers[2], '15']] as const) {
        setter.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    const apply = [...container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Применить');
    await act(async () => apply!.click());

    expect(onExecute).toHaveBeenCalledWith({
      operation: 'move_object', distanceFt: 20, objectWeightLb: 8, moveDistanceFt: 15,
      parameters: { object_label: 'рычаг у двери' },
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
