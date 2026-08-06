import { describe, expect, it } from 'vitest';
import {
  materializeMicroMvpL1ContentPatch,
} from '../../canon/declarativeMechanicsPatch';
import { readProdSnapshotCatalogs } from '../../canon/prodSnapshotL1Fixtures';
import type { EngineEvent } from '../../mvp/contracts';
import type { Card, PassiveEffect } from '../../types';
import {
  weaponMasteryCleaveUseKey,
  weaponMasteryNickUseKey,
} from '../../engine/weaponMastery2024';
import {
  WEAPON_MASTERY_PUSH_CHOICE_ID,
  WEAPON_MASTERY_TOPPLE_CHOICE_ID,
  WEAPON_MASTERY_SLOW_CHOICE_ID,
  WEAPON_MASTERY_GRAZE_CHOICE_ID,
} from '../../engine/testing/weaponMastery2024Fixtures';
import {
  createLogicalClock,
  createSequentialIdFactory,
  createStrictRngTape,
  type DieTapeEntry,
} from '../determinism';
import {
  withDeclaredTestWeaponProfile,
  type DeclaredTestWeaponProfile,
} from '../../testing/weaponProfileFixtures';
import {
  createWorld,
  type ActorState,
  type CommandResult,
  type GameCommand,
  type RulesCatalog,
  type SpatialFacts,
} from '../domain';
import { foldEvents } from '../reducer';
import { InMemoryRulesSession } from '../session';
import { MANDATORY_TWO_PC_SCENARIO_PROTOCOL } from './mandatoryTwoPcProtocol';

type MasteryType = 'topple' | 'sap' | 'slow' | 'vex' | 'push' | 'graze' | 'nick' | 'cleave';
const MASTERY_TYPES: readonly MasteryType[] = [
  'topple', 'sap', 'slow', 'vex', 'push', 'graze', 'nick', 'cleave',
];

function masteryScenarioId(type: MasteryType): string {
  return `SC-WEAPON-MASTERY-${type.toUpperCase()}-01`;
}

const EFFECT_NUMBER: Record<MasteryType, string> = {
  topple: 'EFFECT-0248', sap: 'EFFECT-0249', slow: 'EFFECT-0250', nick: 'EFFECT-0251',
  vex: 'EFFECT-0252', push: 'EFFECT-0253', cleave: 'EFFECT-0254', graze: 'EFFECT-0255',
};
const WEAPON_NUMBER: Record<MasteryType, string> = {
  topple: 'CARD-0027', sap: 'CARD-0009', slow: 'CARD-0025', nick: 'CARD-0031',
  vex: 'CARD-0029', push: 'CARD-0028', cleave: 'CARD-0030', graze: 'CARD-0021',
};
const SECOND_LIGHT_WEAPON_NUMBER = 'CARD-0297';

const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'weapon-mastery-2024-scenarios@1',
  contentHash: 'sha256:weapon-mastery-2024-scenarios',
  errataVersion: '2024',
};
const CATALOG: RulesCatalog = { getAction: () => undefined };

type CommandInput = GameCommand extends infer Command
  ? Command extends GameCommand
    ? Omit<Command, 'schemaVersion' | 'expectedRevision' | 'rulesetContentHash' | 'actorId'>
    : never
  : never;

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function accepted(result: CommandResult) {
  if (result.status === 'rejected') throw new Error(`${result.code}: ${result.message}`);
  return result;
}

function dispatch(session: InMemoryRulesSession, actorId: string, input: CommandInput) {
  return accepted(session.dispatch({
    schemaVersion: 1,
    expectedRevision: session.getState().revision,
    rulesetContentHash: RULESET.contentHash,
    actorId,
    ...input,
  } as GameCommand));
}

function spatial(session: InMemoryRulesSession, distanceFt = 5): SpatialFacts {
  return {
    factsSource: 'scenario',
    boardRevision: session.getState().revision,
    distanceFt,
    lineOfSight: true,
    cover: 'none',
    relation: 'enemy',
  };
}

function engineEvents(result: ReturnType<typeof accepted>): EngineEvent[] {
  return result.events.flatMap((event) => event.payload.type === 'EngineEventRecorded'
    ? [event.payload.event]
    : []);
}

function dieTapeFor(card: Card, label: string, value = 4): DieTapeEntry[] {
  const match = String(card.bonus_value ?? '1d4').match(/(\d+)d(\d+)/i);
  const count = Number(match?.[1] ?? 1);
  const sides = Number(match?.[2] ?? 4);
  return Array.from({ length: count }, (_, index) => ({
    label: `${label} damage ${index + 1}`,
    sides,
    value: Math.min(value, sides),
  }));
}

const patched = materializeMicroMvpL1ContentPatch(readProdSnapshotCatalogs()).catalogs;

const PROFILE_BY_MASTERY: Record<MasteryType, Omit<DeclaredTestWeaponProfile, 'masteryEffectId'>> = {
  topple: {
    weaponType: 'maul', proficiencyCategory: 'martial', attackAbility: 'str',
    damageLines: [{ dice: '2d6', type: 'bludgeoning' }], defaultAttackMode: 'melee',
    attackModes: [{ kind: 'melee', reach_ft: 5 }], properties: ['heavy', 'two_handed'],
  },
  sap: {
    weaponType: 'mace', proficiencyCategory: 'simple', attackAbility: 'str',
    damageLines: [{ dice: '1d6', type: 'bludgeoning' }], defaultAttackMode: 'melee',
    attackModes: [{ kind: 'melee', reach_ft: 5 }], properties: [],
  },
  slow: {
    weaponType: 'whip', proficiencyCategory: 'martial', attackAbility: 'finesse',
    damageLines: [{ dice: '1d4', type: 'slashing' }], defaultAttackMode: 'melee',
    attackModes: [{ kind: 'melee', reach_ft: 10 }], properties: ['finesse', 'reach'],
  },
  vex: {
    weaponType: 'rapier', proficiencyCategory: 'martial', attackAbility: 'finesse',
    damageLines: [{ dice: '1d8', type: 'piercing' }], defaultAttackMode: 'melee',
    attackModes: [{ kind: 'melee', reach_ft: 5 }], properties: ['finesse'],
  },
  push: {
    weaponType: 'pike', proficiencyCategory: 'martial', attackAbility: 'str',
    damageLines: [{ dice: '1d10', type: 'piercing' }], defaultAttackMode: 'melee',
    attackModes: [{ kind: 'melee', reach_ft: 10 }], properties: ['heavy', 'reach', 'two_handed'],
  },
  graze: {
    weaponType: 'glaive', proficiencyCategory: 'martial', attackAbility: 'str',
    damageLines: [{ dice: '1d10', type: 'slashing' }], defaultAttackMode: 'melee',
    attackModes: [{ kind: 'melee', reach_ft: 10 }], properties: ['heavy', 'reach', 'two_handed'],
  },
  nick: {
    weaponType: 'scimitar', proficiencyCategory: 'martial', attackAbility: 'finesse',
    damageLines: [{ dice: '1d6', type: 'slashing' }], defaultAttackMode: 'melee',
    attackModes: [{ kind: 'melee', reach_ft: 5 }], properties: ['finesse', 'light'],
  },
  cleave: {
    weaponType: 'greataxe', proficiencyCategory: 'martial', attackAbility: 'str',
    damageLines: [{ dice: '1d12', type: 'slashing' }], defaultAttackMode: 'melee',
    attackModes: [{ kind: 'melee', reach_ft: 5 }], properties: ['heavy', 'two_handed'],
  },
};

function canonicalBinding(type: MasteryType): { effect: PassiveEffect; weapon: Card } {
  const effect = patched.effects.find((candidate) => candidate.card_number === EFFECT_NUMBER[type]);
  const rawWeapon = patched.cards.find((candidate) => candidate.card_number === WEAPON_NUMBER[type]);
  if (!effect || !rawWeapon) throw new Error(`Missing canonical ${type} binding`);
  expect(rawWeapon.mastery, `${type} Card→Effect UUID`).toBe(effect.id);
  expect((effect.mechanics as Record<string, unknown>).weapon_mastery).toMatchObject({ type });
  const weapon = withDeclaredTestWeaponProfile(rawWeapon, {
    ...PROFILE_BY_MASTERY[type],
    masteryEffectId: effect.id,
  });
  return { effect, weapon };
}

function actor(input: {
  id: string;
  cards?: Card[];
  mastery?: { effect: PassiveEffect; weaponTypes: string[] };
  attacksPerAction?: number;
  ac?: number;
  kind?: ActorState['kind'];
}): ActorState {
  const cards = copy(input.cards ?? []);
  const main = cards[0];
  const off = cards[1];
  const effect = input.mastery?.effect;
  return {
    id: input.id,
    name: input.id,
    kind: input.kind ?? 'playerCharacter',
    controllerId: `${input.id}:controller`,
    ac: input.ac ?? 5,
    capabilities: { actionIds: [] },
    character: {
      abilityMods: { str: 3, dex: 2, con: 0, int: 0, wis: 0, cha: 0 },
      abilityScores: { str: 16, dex: 14, con: 10, int: 10, wis: 10, cha: 10 },
      profBonus: 2,
      level: 1,
      knownCards: cards,
      equippedCards: cards,
      weaponProficiencies: cards.flatMap((card) => card.weapon_type ? [card.weapon_type] : []),
      ...(input.mastery ? { weaponMasteries: [...input.mastery.weaponTypes] } : {}),
      baseSpeed: 30,
    },
    runtime: {
      hp: { current: 100, max: 100, temp: 0 },
      resources: { action: 1, bonus_action: 1, reaction: 1 },
      maxResources: { action: 1, bonus_action: 1, reaction: 1 },
      equipment: {
        ...(main ? { main_hand: main.id } : {}),
        ...(off ? { off_hand: off.id } : {}),
      },
      inventory: cards.map((card) => ({ cardId: card.id, qty: 1 })),
      activeEffects: [],
      firedThisTurn: [],
    },
    ...(effect ? {
      masteryEffects: {
        [effect.id]: {
          name: effect.name,
          mechanics: copy(effect.mechanics),
          weaponTypes: [...input.mastery!.weaponTypes],
          sourceEntityIds: [effect.id],
        },
      },
    } : {}),
    attackProfile: {
      attacksPerAction: input.attacksPerAction ?? 1,
      size: 2,
      reachFt: 5,
      graspingParts: ['main_hand', 'off_hand'],
      sourceEntityIds: ['class:test:attack-profile'],
    },
  };
}

function start(type: MasteryType, tapeEntries: DieTapeEntry[], attacksPerAction = 1) {
  const binding = canonicalBinding(type);
  const extraLight = type === 'nick'
    ? patched.cards.find((card) => card.card_number === SECOND_LIGHT_WEAPON_NUMBER)
    : undefined;
  if (type === 'nick' && !extraLight) throw new Error('Missing canonical second Light weapon');
  const attacker = actor({
    id: 'pc:attacker',
    cards: [binding.weapon, ...(extraLight ? [extraLight] : [])],
    mastery: {
      effect: binding.effect,
      weaponTypes: [binding.weapon.weapon_type!, ...(extraLight?.weapon_type ? [extraLight.weapon_type] : [])],
    },
    attacksPerAction,
  });
  const defenderWeapon = canonicalBinding('sap').weapon;
  const defender = actor({ id: 'pc:defender', cards: [defenderWeapon], ac: type === 'graze' ? 99 : 5 });
  const secondary = type === 'cleave'
    ? actor({ id: 'monster:secondary', cards: [], kind: 'monster', ac: 5 })
    : undefined;
  const initial = createWorld({
    id: `world:mastery:${type}`,
    ruleset: RULESET,
    actors: [attacker, defender, ...(secondary ? [secondary] : [])],
  });
  const tape = createStrictRngTape(tapeEntries);
  const session = new InMemoryRulesSession(initial, CATALOG, {
    rng: tape.rng,
    clock: createLogicalClock(100_000),
    nextId: createSequentialIdFactory(`mastery:${type}`),
  });
  const initiative = ['pc:attacker', 'pc:defender', ...(secondary ? [secondary.id] : [])];
  dispatch(session, 'pc:attacker', { type: 'StartEncounter', commandId: `${type}:encounter`, initiative });
  dispatch(session, 'pc:attacker', { type: 'StartTurn', commandId: `${type}:attacker-turn` });
  return { binding, extraLight, initial, session, tape };
}

function beginAndAttack(
  session: InMemoryRulesSession,
  type: MasteryType,
  weapon: Card,
  choices?: Record<string, string | string[]>,
) {
  dispatch(session, 'pc:attacker', { type: 'BeginAttackAction', commandId: `${type}:begin` });
  const attackActionId = Object.values(session.getState().attackActions).at(-1)!.id;
  const result = dispatch(session, 'pc:attacker', {
    type: 'PerformWeaponAttack',
    commandId: `${type}:primary-attack`,
    attackActionId,
    weaponCardId: weapon.id,
    targetActorId: 'pc:defender',
    facts: spatial(session),
    ...(choices ? { choices } : {}),
  });
  return { attackActionId, result };
}

function passTurn(session: InMemoryRulesSession, type: MasteryType) {
  dispatch(session, 'pc:attacker', { type: 'EndTurn', commandId: `${type}:attacker-end` });
  dispatch(session, 'pc:defender', { type: 'StartTurn', commandId: `${type}:defender-turn` });
}

describe('mandatory two-PC sequential PHB 2024 Weapon Mastery scenarios', () => {
  for (const type of MASTERY_TYPES) {
    it(`${type}: real Card/Effect binding executes across the sequential two-PC protocol`, {
      meta: {
        semanticProtocol: MANDATORY_TWO_PC_SCENARIO_PROTOCOL,
        scenarioId: masteryScenarioId(type),
      },
    }, () => {
    const binding = canonicalBinding(type);
    const primaryWeaponForTape = type === 'nick'
      ? patched.cards.find((card) => card.card_number === SECOND_LIGHT_WEAPON_NUMBER)!
      : binding.weapon;
    const primaryAttack = [{ label: `${type} primary attack`, sides: 20, value: type === 'graze' ? 1 : 10 }];
    const primaryDamage = type === 'graze' ? [] : dieTapeFor(primaryWeaponForTape, `${type} primary`);
    const extra: DieTapeEntry[] = type === 'sap'
      ? [
        { label: 'Sap disadvantaged high', sides: 20, value: 12 },
        { label: 'Sap disadvantaged low', sides: 20, value: 10 },
        ...dieTapeFor(patched.cards.find((card) => card.card_number === 'CARD-0009')!, 'defender'),
      ]
      : type === 'vex'
        ? [
          { label: 'Vex advantaged high', sides: 20, value: 12 },
          { label: 'Vex advantaged low', sides: 20, value: 10 },
          ...dieTapeFor(binding.weapon, 'vex second'),
        ]
        : type === 'nick'
          ? [
            { label: 'Nick extra attack', sides: 20, value: 10 },
            ...dieTapeFor(binding.weapon, 'nick extra'),
          ]
          : type === 'cleave'
            ? [
              { label: 'Cleave secondary attack', sides: 20, value: 10 },
              ...dieTapeFor(binding.weapon, 'cleave secondary'),
            ]
            : [];
    const test = start(type, [...primaryAttack, ...primaryDamage, ...extra], type === 'vex' ? 2 : 1);
    const beforeDefenderHp = test.session.getState().actors['pc:defender'].runtime.hp.current;
    const choices: Record<string, string | string[]> | undefined = type === 'push'
      ? { [WEAPON_MASTERY_PUSH_CHOICE_ID]: '10' }
      : type === 'topple'
        ? { [WEAPON_MASTERY_TOPPLE_CHOICE_ID]: 'use' }
        : type === 'slow'
          ? { [WEAPON_MASTERY_SLOW_CHOICE_ID]: 'use' }
          : type === 'graze'
            ? { [WEAPON_MASTERY_GRAZE_CHOICE_ID]: 'use' }
            : undefined;
    const qualifyingWeapon = type === 'nick' ? test.extraLight! : test.binding.weapon;
    const primary = beginAndAttack(test.session, type, qualifyingWeapon, choices);

    expect(MANDATORY_TWO_PC_SCENARIO_PROTOCOL).toBe('mandatory-two-pc-v1');
    expect(masteryScenarioId(type)).toContain(type.toUpperCase());

    if (type === 'topple') {
      const pending = test.session.getState().pendingResolution;
      expect(pending).toMatchObject({
        type: 'mastery_save', targetActorId: 'pc:defender',
        mastery: { sourceEntityId: test.binding.effect.id },
        request: { ability: 'con', dc: 13 },
      });
      if (!pending || pending.type !== 'mastery_save') throw new Error('Topple save was not opened');
      dispatch(test.session, 'pc:defender', {
        type: 'ResolveDecision', commandId: 'topple:failed-save',
        resolutionId: pending.id, requestId: pending.request.id,
        response: { kind: 'roll', roll: { mode: 'manual', dice: [{ sides: 20, value: 3 }] } },
      });
      expect(test.session.getState().actors['pc:defender'].runtime.activeEffects).toEqual(
        expect.arrayContaining([expect.objectContaining({
          mechanics: expect.objectContaining({ kind: 'condition', value: 'prone' }),
        })]),
      );
    }

    if (type === 'sap') {
      passTurn(test.session, type);
      dispatch(test.session, 'pc:defender', { type: 'BeginAttackAction', commandId: 'sap:defender-begin' });
      const defenderAction = Object.values(test.session.getState().attackActions)
        .find((entry) => entry.actorId === 'pc:defender')!;
      const defenderWeapon = test.session.getState().actors['pc:defender'].character.equippedCards![0];
      const response = dispatch(test.session, 'pc:defender', {
        type: 'PerformWeaponAttack', commandId: 'sap:defender-attack',
        attackActionId: defenderAction.id, weaponCardId: defenderWeapon.id,
        targetActorId: 'pc:attacker', facts: spatial(test.session),
      });
      expect(engineEvents(response).find((event) => event.type === 'roll')).toMatchObject({
        type: 'roll', roll: { advantage: 'disadvantage' },
      });
      expect(test.session.getState().actors['pc:defender'].runtime.activeEffects.some((entry) => (
        (entry.mechanics as Record<string, unknown>).stack_id === 'weapon-mastery:sap'
      ))).toBe(false);
    }

    if (type === 'slow') {
      expect(test.session.getState().actors['pc:defender'].runtime.activeEffects).toEqual(
        expect.arrayContaining([expect.objectContaining({ mechanics: expect.objectContaining({
          stack_id: 'weapon-mastery:slow', value: '-10',
        }) })]),
      );
    }

    if (type === 'vex') {
      const response = dispatch(test.session, 'pc:attacker', {
        type: 'PerformWeaponAttack', commandId: 'vex:second-attack',
        attackActionId: primary.attackActionId, weaponCardId: test.binding.weapon.id,
        targetActorId: 'pc:defender', facts: spatial(test.session),
      });
      expect(engineEvents(response).find((event) => event.type === 'roll')).toMatchObject({
        type: 'roll', roll: { advantage: 'advantage' },
      });
    }

    if (type === 'push') {
      expect(engineEvents(primary.result)).toContainEqual({ type: 'movement', mode: 'push', distanceFt: 10 });
    }

    if (type === 'graze') {
      expect(test.session.getState().actors['pc:defender'].runtime.hp.current).toBe(beforeDefenderHp - 3);
      expect(engineEvents(primary.result)).toContainEqual(expect.objectContaining({
        type: 'damage', amount: 3, damageType: 'slashing',
      }));
    }

    if (type === 'nick') {
      expect(test.extraLight).toBeDefined();
      const beforeBonusAction = test.session.getState().actors['pc:attacker'].runtime.resources.bonus_action;
      const response = dispatch(test.session, 'pc:attacker', {
        type: 'PerformLightWeaponExtraAttack', commandId: 'nick:extra-attack',
        attackActionId: primary.attackActionId,
        weaponCardId: test.binding.weapon.id,
        targetActorId: 'pc:defender', facts: spatial(test.session),
      });
      expect(test.session.getState().actors['pc:attacker'].runtime.resources.bonus_action)
        .toBe(beforeBonusAction);
      expect(test.session.getState().actors['pc:attacker'].runtime.firedThisTurn).toContain(
        weaponMasteryNickUseKey(test.session.getState().attackActions[primary.attackActionId].turnKey),
      );
      expect(response.events.find((event) => event.payload.type === 'ActionDeclared')?.payload)
        .toMatchObject({ facts: { actionEconomy: 'attack_action' } });
    }

    if (type === 'cleave') {
      const window = test.session.getState().actors['pc:attacker'].runtime.activeEffects.find((entry) => (
        (entry.mechanics as Record<string, unknown>).follow_up === 'cleave'
      ));
      expect(window).toBeDefined();
      const response = dispatch(test.session, 'pc:attacker', {
        type: 'PerformWeaponMasteryCleaveAttack', commandId: 'cleave:secondary',
        attackActionId: primary.attackActionId,
        weaponCardId: test.binding.weapon.id,
        targetActorId: 'monster:secondary',
        secondaryDistanceFromPrimaryFt: 5,
        facts: spatial(test.session),
      });
      const damage = engineEvents(response).find((event): event is Extract<EngineEvent, { type: 'damage' }> => (
        event.type === 'damage'
      ));
      expect(damage?.roll?.modifiers.some((modifier) => modifier.source === 'СИЛ')).toBe(false);
      expect(test.session.getState().actors['pc:attacker'].runtime.firedThisTurn).toContain(
        weaponMasteryCleaveUseKey(test.session.getState().attackActions[primary.attackActionId].turnKey),
      );
    }

    if (type !== 'sap') passTurn(test.session, type);
    if (type === 'cleave') {
      expect(test.session.getState().actors['pc:attacker'].runtime.activeEffects.some((entry) => (
        (entry.mechanics as Record<string, unknown>).follow_up === 'cleave'
      ))).toBe(false);
    }
    test.tape.assertExhausted();
    expect(foldEvents(copy(test.initial), copy(test.session.getEvents()))).toEqual(test.session.getState());
    });
  }
});
