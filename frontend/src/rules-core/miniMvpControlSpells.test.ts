import { describe, expect, it } from 'vitest';
import definitions from '../../../scripts/content/data/mini-mvp-control-spells.v1.json';
import { activeConditionsOf } from '../engine/circumstances';
import {
  executeAction,
  projectedAgainst,
  resolveNextTurnCommand,
} from '../engine/execute';
import { deniedCapabilities } from '../engine/modifiers';
import { validateMechanics } from '../engine/validateMechanics';
import { FIGHTER_CTX_EQUIPPED, freshFighterState } from '../mvp/fixtures';
import type { CharacterContext, RuntimeState } from '../mvp/contracts';

type Dict = Record<string, unknown>;

function spell(cardNumber: string) {
  const definition = definitions.find((candidate) => candidate.card_number === cardNumber);
  if (!definition) throw new Error(`Missing control spell ${cardNumber}`);
  return definition as { card_number: string; name: string; mechanics: Dict };
}

function casterState(): RuntimeState {
  const state = freshFighterState();
  state.resources.spell_slot_1 = 4;
  state.maxResources.spell_slot_1 = 4;
  return state;
}

const caster: CharacterContext = {
  ...FIGHTER_CTX_EQUIPPED,
  creatureType: 'humanoid',
  spellcastingMod: 3,
};
const ordinaryTarget: CharacterContext = {
  ...FIGHTER_CTX_EQUIPPED,
  creatureType: 'humanoid',
  characterSpeed: 30,
};

function castAtTarget(
  cardNumber: string,
  options: { choices?: Record<string, string>; rng?: () => number } = {},
): RuntimeState {
  const result = executeAction(casterState(), spell(cardNumber).mechanics, {
    character: caster,
    selfId: 'caster',
    target: {
      id: 'target',
      ac: 10,
      characterContext: ordinaryTarget,
      runtimeState: freshFighterState(),
    },
    choices: options.choices,
    rng: options.rng ?? (() => 0),
  });
  if (!result.targetState) throw new Error(`${cardNumber} did not mutate target`);
  return result.targetState;
}

const conditionAction = (condition: 'charmed' | 'frightened'): Dict => ({
  activation: { mode: 'active', cost: [] },
  effects: [{
    resolution: 'auto',
    who: 'target',
    result: [{ kind: 'condition', value: condition, op: 'apply' }],
  }],
});

function imposeCondition(
  targetState: RuntimeState,
  creatureType: string,
  condition: 'charmed' | 'frightened',
) {
  return executeAction(freshFighterState(), conditionAction(condition), {
    character: { ...ordinaryTarget, creatureType },
    selfId: 'hostile-source',
    target: {
      id: 'target', characterContext: ordinaryTarget, runtimeState: targetState,
    },
    rng: () => 0.5,
  });
}

const singleAttack: Dict = {
  activation: { mode: 'active', cost: [{ resource: 'action' }] },
  effects: [{
    resolution: 'attack_roll', attack_kind: 'spell_melee', ability: 'str', vs: 'ac', who: 'target',
    on_hit: [{ kind: 'damage', dice: '1', type: 'bludgeoning' }],
  }],
  targeting: { shape: 'single', domain: 'actor' },
};

describe('mini-MVP: data-driven control and ward spells', () => {
  it('validates every declaration and retains explicit non-certified limitations', () => {
    for (const definition of definitions) {
      expect(validateMechanics(definition.mechanics as Dict, {
        id: definition.card_number,
        name: definition.name,
        kind: 'spell',
      })).toEqual({ valid: true, errors: [] });
    }
    expect(JSON.stringify(spell('SPELL-0201').mechanics)).toContain('одержимости');
    expect(JSON.stringify(spell('SPELL-0272').mechanics)).toContain('multi-target');
    expect(JSON.stringify(spell('SPELL-0306').mechanics)).toContain('новой цели');
  });

  it('Protection projects attack disadvantage only from declared creature types', () => {
    const protectedTarget = castAtTarget('SPELL-0201');
    const incoming = (creatureType?: string) => projectedAgainst(
      { id: 'target', runtimeState: protectedTarget },
      'attack',
      'melee',
      {
        rollerActorId: 'attacker',
        rollTargetActorId: 'target',
        rollerCreatureType: creatureType,
      },
    ).advantage;
    expect(incoming('fiend:devil')).toBe('disadvantage');
    expect(incoming('undead')).toBe('disadvantage');
    expect(incoming('beast')).toBe('none');
    expect(incoming()).toBe('none');
  });

  it('Protection blocks Charmed/Frightened only from a matching source type', () => {
    const protectedTarget = castAtTarget('SPELL-0201');
    const fiend = imposeCondition(protectedTarget, 'fiend:demon', 'frightened');
    expect(fiend.targetState && activeConditionsOf(fiend.targetState).has('frightened')).toBe(false);
    expect(fiend.events).toContainEqual(expect.objectContaining({
      type: 'condition_immune', condition: 'frightened',
    }));

    const beast = imposeCondition(protectedTarget, 'beast', 'charmed');
    expect(beast.targetState && activeConditionsOf(beast.targetState).has('charmed')).toBe(true);
  });

  it('Command persists the chosen failed-save order and resolves generic next-turn effects', () => {
    const grovel = castAtTarget('SPELL-0272', { choices: { command_option: 'grovel' } });
    const grovelTurn = resolveNextTurnCommand(grovel, {
      character: ordinaryTarget, selfId: 'target', rng: () => 0.5,
    });
    expect(grovelTurn).toMatchObject({ command: 'grovel', endsTurn: true });
    expect(grovelTurn && activeConditionsOf(grovelTurn.state).has('prone')).toBe(true);

    const halt = castAtTarget('SPELL-0272', { choices: { command_option: 'halt' } });
    const haltTurn = resolveNextTurnCommand(halt, {
      character: ordinaryTarget, selfId: 'target', rng: () => 0.5,
    });
    expect(haltTurn).toMatchObject({ command: 'halt', endsTurn: true });
    expect(haltTurn && [...deniedCapabilities(haltTurn.state)].sort()).toEqual([
      'action', 'bonus_action', 'movement',
    ]);

    const flee = castAtTarget('SPELL-0272', { choices: { command_option: 'flee' } });
    expect(resolveNextTurnCommand(flee, {
      character: ordinaryTarget, selfId: 'target', rng: () => 0.5,
    })).toMatchObject({
      command: 'flee', directive: { type: 'flee_source', sourceActorId: 'caster' },
    });
  });

  it('Sanctuary spends the incoming action but blocks its roll after a failed save', () => {
    const warded = castAtTarget('SPELL-0306');
    const before = warded.hp.current;
    const attacker = { ...ordinaryTarget, creatureType: 'beast' };
    const blocked = executeAction(freshFighterState(), singleAttack, {
      character: attacker,
      selfId: 'attacker',
      target: { id: 'target', ac: 10, characterContext: ordinaryTarget, runtimeState: warded },
      rng: () => 0,
    });
    expect(blocked.state.resources.action).toBe(0);
    expect(blocked.targetState).toBeUndefined();
    expect(warded.hp.current).toBe(before);
    expect(blocked.events.filter((event) => event.type === 'roll')).toHaveLength(1);
    expect(blocked.events).toContainEqual(expect.objectContaining({
      type: 'narrative', text: expect.stringContaining('новую цель'),
    }));

    const allowed = executeAction(freshFighterState(), singleAttack, {
      character: attacker,
      selfId: 'attacker',
      target: { id: 'target', ac: 10, characterContext: ordinaryTarget, runtimeState: warded },
      rng: () => 0.99,
    });
    expect(allowed.targetState?.hp.current).toBe(before - 1);
    expect(allowed.events.filter((event) => event.type === 'roll')).toHaveLength(2);
  });

  it('Sanctuary ignores area damage and ends on any spell cast by its owner', () => {
    const warded = castAtTarget('SPELL-0306');
    const areaDamage: Dict = {
      activation: { mode: 'active', cost: [] },
      effects: [{ resolution: 'auto', who: 'target', result: [{ kind: 'damage', dice: '2', type: 'fire' }] }],
      targeting: { shape: 'sphere', domain: 'area', radius_ft: 10 },
    };
    const area = executeAction(freshFighterState(), areaDamage, {
      character: { ...ordinaryTarget, spellcastingMod: 0 },
      selfId: 'caster-2',
      target: { id: 'target', characterContext: ordinaryTarget, runtimeState: warded },
      spell: { baseLevel: 1, castLevel: 1, components: { verbal: true, somatic: true, material: false } },
      rng: () => 0,
    });
    expect(area.targetState?.hp.current).toBe(warded.hp.current - 2);
    expect(area.events.filter((event) => event.type === 'roll')).toHaveLength(0);

    const harmlessSpell: Dict = {
      activation: { mode: 'active', cost: [] },
      effects: [{ resolution: 'auto', result: [{ kind: 'narrative', description: 'Безвредный эффект' }] }],
    };
    const ownCast = executeAction(warded, harmlessSpell, {
      character: ordinaryTarget,
      selfId: 'target',
      spell: { baseLevel: 0, components: { verbal: false, somatic: true, material: false } },
      rng: () => 0.5,
    });
    expect(ownCast.state.activeEffects.some((entry) => (
      (entry.mechanics as Dict).kind === 'targeting_ward'
    ))).toBe(false);
  });
});
