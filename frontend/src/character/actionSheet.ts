import type { AssembledCharacter } from './assemble';
import { STANDARD_ACTIONS } from './standardActions';
import type { Action, Spell } from '../types';

export type SheetAction = {
  id: string;
  name: string;
  mechanics: Record<string, unknown>;
  group: 'basic' | 'class' | 'spell';
  level?: number;
};

function actionMechanics(action: Action): Record<string, unknown> | null {
  const mech = action.mechanics;
  if (!mech || typeof mech !== 'object') return null;
  const activation = mech.activation as Record<string, unknown> | undefined;
  if (activation?.mode !== 'active') return null;
  const cost = activation.cost as unknown[] | undefined;
  if (!Array.isArray(cost) || !cost.length) return null;
  return mech as Record<string, unknown>;
}

function spellMechanics(spell: Spell): Record<string, unknown> | null {
  const mech = spell.mechanics;
  if (!mech || typeof mech !== 'object') return null;
  const activation = mech.activation as Record<string, unknown> | undefined;
  if (!activation || activation.mode === 'passive') return null;
  return mech as Record<string, unknown>;
}

export function collectSheetActions(assembled: AssembledCharacter): SheetAction[] {
  const basic: SheetAction[] = STANDARD_ACTIONS.map((a) => ({
    id: a.id,
    name: a.name,
    mechanics: { ...a.mechanics },
    group: 'basic' as const,
  }));

  const fromClass: SheetAction[] = assembled.actions
    .map(({ action }) => {
      const mechanics = actionMechanics(action);
      if (!mechanics) return null;
      return {
        id: action.id,
        name: action.name,
        mechanics: { ...mechanics, name: action.name },
        group: 'class' as const,
      };
    })
    .filter((a): a is SheetAction => a != null);

  const spells: SheetAction[] = assembled.spells
    .map((spell) => {
      const mechanics = spellMechanics(spell);
      if (!mechanics) return null;
      return {
        id: spell.id,
        name: spell.name,
        mechanics: { ...mechanics, name: spell.name },
        group: 'spell' as const,
        level: spell.level ?? 0,
      };
    })
    .filter((a): a is SheetAction => a != null);

  return [...basic, ...fromClass, ...spells];
}

export function actionNeedsTarget(mechanics: Record<string, unknown>): boolean {
  const effects = mechanics.effects as Record<string, unknown>[] | undefined;
  if (!Array.isArray(effects)) return false;
  return effects.some((e) => {
    const res = String(e.resolution ?? '');
    return res === 'attack_roll' || res === 'save';
  });
}
