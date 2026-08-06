import { describe, expect, it } from 'vitest';
import { CARD_LONGSWORD } from '../mvp/fixtures';
import type { EngineEvent } from '../mvp/contracts';
import {
  temporaryHpMeleeRetaliationPolicyFromMechanics,
  createArmorOfAgathysEffect,
} from './armorOfAgathys';
import { createLogicalClock } from './determinism';
import {
  createWorld,
  type ActorState,
  type GameCommand,
  type RuleActionDefinition,
  type RulesCatalog,
  type SpatialFacts,
  type UncommittedRuleEvent,
  type WorldState,
} from './domain';
import { foldEvents } from './reducer';
import { InMemoryRulesSession } from './session';
import type { SpellcastingAccessState } from './spellcastingAccess';
import { migrateWorldState } from './worldMigration';

const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'armor-of-agathys-runtime@1',
  contentHash: 'sha256:armor-of-agathys-runtime',
  errataVersion: 'phb-2024-v1',
};

const FACTS: SpatialFacts = {
  factsSource: 'scenario', boardRevision: 1, distanceFt: 5,
  lineOfSight: true, cover: 'none', relation: 'enemy',
};

const SELF_FACTS: SpatialFacts = {
  factsSource: 'scenario', boardRevision: 1, distanceFt: 0,
  lineOfSight: true, cover: 'none', relation: 'self',
};

const ARMOR_PRIMITIVE = {
  type: 'temporary_hp_melee_retaliation',
  temporary_hp_per_slot: 5,
  retaliation_damage_per_slot: 5,
  retaliation_damage_type: 'cold',
  retaliation_trigger: 'hit_by_melee_attack_roll',
  duration_rounds: 600,
  end_when_no_temporary_hp: true,
  minimum_slot_level: 1,
  maximum_slot_level: 9,
} as const;
const ARMOR_POLICY = temporaryHpMeleeRetaliationPolicyFromMechanics(ARMOR_PRIMITIVE)!;

const ARMOR: RuleActionDefinition = {
  id: 'spell.armor-of-agathys',
  name: 'Armor of Agathys',
  kind: 'spell',
  sourceEntityIds: ['custom-spell-entity'],
  spell: { level: 1, sourceClass: 'warlock' },
  targeting: {
    minTargets: 1, maxTargets: 1, rangeFt: 0,
    requiresLineOfSight: false, allowedRelations: ['self'],
  },
  mechanics: {
    activation: {
      mode: 'active',
      cost: [{ resource: 'bonus_action' }, { resource: 'spell_slot', level: 1, amount: 1 }],
    },
    primitive: ARMOR_PRIMITIVE,
    effects: [{
      resolution: 'auto', who: 'self',
      result: [{ kind: 'temp_hp', amount: '5' }],
    }],
  },
};

const GENERIC_FROST_WARD: RuleActionDefinition = {
  ...ARMOR,
  id: 'spell.custom-frost-ward',
  name: 'Frost Ward',
  sourceEntityIds: ['CARD-custom-frost-ward'],
  mechanics: {
    ...ARMOR.mechanics,
    primitive: {
      ...ARMOR_PRIMITIVE,
      temporary_hp_per_slot: 3,
      retaliation_damage_per_slot: 7,
      duration_rounds: 4,
    },
    effects: [{
      resolution: 'auto', who: 'self',
      result: [{ kind: 'temp_hp', amount: '3' }],
    }],
  },
};

const MELEE_SPELL: RuleActionDefinition = {
  id: 'spell.melee-test', name: 'Melee spell', kind: 'spell',
  sourceEntityIds: ['spell:melee-test'], spell: { level: 0, sourceClass: 'wizard' },
  targeting: {
    minTargets: 1, maxTargets: 1, rangeFt: 5,
    requiresLineOfSight: true, allowedRelations: ['enemy'],
  },
  mechanics: {
    activation: { mode: 'active', cost: [{ resource: 'action' }] },
    effects: [{
      resolution: 'attack_roll', ability: 'int', attack_kind: 'spell_melee',
      on_hit: [{ kind: 'damage', dice: '1d4', type: 'force', ability: 'none' }],
    }],
  },
};

const RANGED_SPELL: RuleActionDefinition = {
  ...MELEE_SPELL,
  id: 'spell.ranged-test',
  name: 'Ranged spell',
  sourceEntityIds: ['spell:ranged-test'],
  mechanics: {
    ...MELEE_SPELL.mechanics,
    effects: [{
      resolution: 'attack_roll', ability: 'int', attack_kind: 'spell_ranged',
      on_hit: [{ kind: 'damage', dice: '1d4', type: 'force', ability: 'none' }],
    }],
  },
};

const STRIKE: RuleActionDefinition = {
  id: 'action.melee-strike', name: 'Melee strike', kind: 'nonSpell',
  sourceEntityIds: ['action:melee-strike'],
  targeting: {
    minTargets: 1, maxTargets: 1, rangeFt: 5,
    requiresLineOfSight: true, allowedRelations: ['enemy'],
  },
  mechanics: {
    activation: { mode: 'active', cost: [{ resource: 'action' }] },
    effects: [{
      resolution: 'attack_roll', ability: 'str', attack_kind: 'weapon_melee',
      on_hit: [{ kind: 'damage', dice: '1d6', type: 'slashing', ability: 'none' }],
    }],
  },
};

const AUTO_DAMAGE: RuleActionDefinition = {
  id: 'action.auto-damage', name: 'Automatic damage', kind: 'nonSpell',
  sourceEntityIds: ['action:auto-damage'],
  targeting: {
    minTargets: 1, maxTargets: 1, rangeFt: 30,
    requiresLineOfSight: true, allowedRelations: ['enemy'],
  },
  mechanics: {
    activation: { mode: 'active', cost: [{ resource: 'action' }] },
    effects: [{
      resolution: 'auto', who: 'target',
      result: [{ kind: 'damage', amount: '5', type: 'fire' }],
    }],
  },
};

const SHIELD: RuleActionDefinition = {
  id: 'spell.shield', name: 'Shield', kind: 'spell', sourceEntityIds: ['spell:shield'],
  spell: { level: 1, sourceClass: 'wizard' },
  mechanics: {
    activation: {
      mode: 'reaction', trigger: { event: 'hit_by_attack' },
      cost: [{ resource: 'reaction' }, { resource: 'spell_slot', level: 1, amount: 1 }],
    },
    effects: [{
      resolution: 'auto', who: 'self', result: [{
        kind: 'modifier', applies_to: { roll: 'ac' }, op: 'add', value: '+5',
        duration: { type: 'until_start_of_next_turn' },
      }],
    }],
  },
};

const ACTIONS = [
  ARMOR, GENERIC_FROST_WARD, MELEE_SPELL, RANGED_SPELL, STRIKE, AUTO_DAMAGE, SHIELD,
];
const catalog: RulesCatalog = {
  getAction: (id) => ACTIONS.find((action) => action.id === id),
};

function access(grants: SpellcastingAccessState['grants']): SpellcastingAccessState {
  return { grants, preparedSources: {} };
}

function grant(input: {
  actorId: string;
  action: typeof ARMOR | typeof SHIELD | typeof MELEE_SPELL | typeof RANGED_SPELL;
  slotResource?: string;
}) {
  if (input.action.kind !== 'spell') throw new Error('test grant requires spell');
  return {
    grantId: `grant:${input.actorId}:${input.action.id}:${input.slotResource ?? 'cantrip'}`,
    actionId: input.action.id,
    sourceId: `source:${input.actorId}`,
    access: input.action.spell.level === 0 ? 'cantrip' as const : 'known' as const,
    level: input.action.spell.level,
    spellcastingAbility: input.actorId === 'warlock' ? 'cha' as const : 'int' as const,
    ...(input.slotResource ? { slotResource: input.slotResource } : {}),
  };
}

function actor(input: {
  id: string;
  actionIds?: string[];
  spellAccess?: SpellcastingAccessState;
  temp?: number;
  armorSlotLevel?: number;
  weapon?: boolean;
  damageAdjustment?: 'resistance' | 'immunity' | 'vulnerability';
  concentrating?: boolean;
}): ActorState {
  const weapon = input.weapon ? { ...CARD_LONGSWORD, weapon_type: 'longsword' } : undefined;
  const actionIds = input.actionIds ?? [];
  const effects: ActorState['runtime']['activeEffects'] = [];
  if (input.armorSlotLevel) {
    effects.push(createArmorOfAgathysEffect({
      id: `aoa:${input.id}`,
      actorId: input.id,
      actionId: ARMOR.id,
      name: ARMOR.name,
      slotLevel: input.armorSlotLevel,
      policy: ARMOR_POLICY,
      sourceEntityIds: ARMOR.sourceEntityIds,
    }));
  }
  if (input.damageAdjustment) {
    effects.push({
      id: `cold:${input.damageAdjustment}`,
      name: `Cold ${input.damageAdjustment}`,
      mechanics: {
        kind: 'resistance', damage_type: 'cold', value: input.damageAdjustment,
        sourceEntityIds: [`effect:cold:${input.damageAdjustment}`],
      },
      source: 'test', ownerId: input.id, sourceId: input.id,
    });
  }
  if (input.concentrating) {
    effects.push({
      id: `concentration-marker:${input.id}`, name: 'Concentration marker',
      mechanics: { kind: 'marker' }, source: 'test', ownerId: input.id, sourceId: input.id,
    });
  }
  const resources = {
    action: 1, bonus_action: 1, reaction: 1,
    spell_slot_1: 1, spell_slot_2: 1,
  };
  return {
    id: input.id,
    name: input.id,
    kind: 'playerCharacter',
    controllerId: `${input.id}:controller`,
    ac: 12,
    capabilities: { actionIds },
    character: {
      abilityMods: { str: 3, dex: 1, con: 2, int: 3, wis: 0, cha: 4 },
      profBonus: 2, level: 1,
      weaponProficiencies: ['longsword'],
      ...(weapon ? { knownCards: [weapon], equippedCards: [weapon] } : {}),
    },
    runtime: {
      hp: { current: 20, max: 20, temp: input.temp ?? 0 },
      resources,
      maxResources: { ...resources },
      equipment: weapon ? { main_hand: weapon.id, off_hand: null } : {},
      inventory: weapon ? [{ cardId: weapon.id, qty: 1 }] : [],
      activeEffects: effects,
    },
    ...(input.spellAccess ? { spellcastingAccess: input.spellAccess } : {}),
    attackProfile: {
      attacksPerAction: 1, size: 2, reachFt: 5,
      graspingParts: ['main_hand', 'off_hand'],
      sourceEntityIds: ['class:test:attack-profile'],
    },
  };
}

function command<T extends GameCommand>(value: T): T { return value; }

function accepted(result: ReturnType<InMemoryRulesSession['dispatch']>) {
  expect(result.status).toBe('accepted');
  if (result.status !== 'accepted') throw new Error(`${result.code}: ${result.message}`);
  return result;
}

function engineEvents(events: readonly UncommittedRuleEvent[]): EngineEvent[] {
  return events.flatMap((event) => (
    event.payload.type === 'EngineEventRecorded' ? [event.payload.event] : []
  ));
}

function session(world: WorldState, rng = () => 0.5) {
  return new InMemoryRulesSession(world, catalog, {
    rng, clock: createLogicalClock(), nextId: () => 'ignored',
  });
}

function base(instance: InMemoryRulesSession, id: string, actorId: string) {
  return {
    schemaVersion: 1 as const, commandId: id,
    expectedRevision: instance.getState().revision,
    rulesetContentHash: RULESET.contentHash, actorId,
  };
}

function encounter(instance: InMemoryRulesSession, attackerId = 'attacker', defenderId = 'warlock') {
  accepted(instance.dispatch(command({
    ...base(instance, 'encounter', attackerId), type: 'StartEncounter',
    initiative: [attackerId, defenderId],
  })));
  accepted(instance.dispatch(command({
    ...base(instance, 'attacker-start', attackerId), type: 'StartTurn',
  })));
}

function beginAttack(instance: InMemoryRulesSession, actorId = 'attacker') {
  accepted(instance.dispatch(command({
    ...base(instance, 'begin-attack', actorId), type: 'BeginAttackAction',
  })));
  const attack = Object.values(instance.getState().attackActions).find((entry) => (
    entry.actorId === actorId && entry.status === 'open'
  ));
  if (!attack) throw new Error('Expected open Attack action');
  return attack;
}

function armorDefender(temp = 5, slotLevel = 1, shield = false): ActorState {
  const grants = shield ? [grant({ actorId: 'warlock', action: SHIELD, slotResource: 'spell_slot_1' })] : [];
  return actor({
    id: 'warlock', temp, armorSlotLevel: slotLevel,
    actionIds: [ARMOR.id, ...(shield ? [SHIELD.id] : [])],
    ...(shield ? { spellAccess: access(grants) } : {}),
  });
}

function replay(initial: WorldState, instance: InMemoryRulesSession) {
  const persisted = JSON.parse(JSON.stringify(instance.getState())) as WorldState;
  expect(migrateWorldState(persisted)).toEqual(persisted);
  expect(foldEvents(
    JSON.parse(JSON.stringify(initial)) as WorldState,
    JSON.parse(JSON.stringify(instance.getEvents())) as UncommittedRuleEvent[],
  )).toEqual(instance.getState());
}

describe('Armor of Agathys authoritative runtime vertical', () => {
  it('selects the retaliation primitive from mechanics for an unrelated entity/card identity', () => {
    const wardBearer = actor({
      id: 'ward-bearer', actionIds: [GENERIC_FROST_WARD.id],
      spellAccess: access([grant({
        actorId: 'ward-bearer', action: GENERIC_FROST_WARD, slotResource: 'spell_slot_1',
      })]),
    });
    const instance = session(createWorld({
      id: 'generic-frost-ward', ruleset: RULESET,
      actors: [wardBearer, actor({ id: 'observer' })],
    }));
    accepted(instance.dispatch(command({
      ...base(instance, 'cast-generic-ward', 'ward-bearer'),
      type: 'UseAction', actionId: GENERIC_FROST_WARD.id,
      targetIds: ['ward-bearer'], factsByTarget: { 'ward-bearer': SELF_FACTS },
      spell: { baseLevel: 1 }, choices: { temporary_hp: 'take_spell' },
    })));
    expect(instance.getState().actors['ward-bearer'].runtime).toMatchObject({
      hp: { temp: 3 },
      activeEffects: [expect.objectContaining({
        name: 'Frost Ward', roundsLeft: 4,
        mechanics: expect.objectContaining({
          kind: 'temporary_hp_melee_retaliation',
          retaliationDamage: 7,
          sourceEntityIds: ['CARD-custom-frost-ward'],
        }),
      })],
    });
  });

  it('requires an explicit THP choice and an exact paid source, and scales from the paid slot', () => {
    const warlock = actor({
      id: 'warlock', temp: 8, actionIds: [ARMOR.id],
      spellAccess: access([
        grant({ actorId: 'warlock', action: ARMOR, slotResource: 'spell_slot_2' }),
      ]),
    });
    const ally = actor({ id: 'ally' });
    const initial = migrateWorldState(createWorld({
      id: 'cast-armor', ruleset: RULESET, actors: [warlock, ally],
    }));
    const instance = session(initial);
    const revision = instance.getState().revision;
    expect(instance.dispatch(command({
      ...base(instance, 'missing-choice', 'warlock'), type: 'UseAction', actionId: ARMOR.id,
      targetIds: ['warlock'], factsByTarget: { warlock: SELF_FACTS },
      spell: { baseLevel: 1, castLevel: 2, grantId: 'grant:warlock:spell.armor-of-agathys:spell_slot_2' },
    }))).toMatchObject({ status: 'rejected', code: 'InvalidDecision' });
    expect(instance.getState().revision).toBe(revision);

    const cast = accepted(instance.dispatch(command({
      ...base(instance, 'cast-armor', 'warlock'), type: 'UseAction', actionId: ARMOR.id,
      targetIds: ['warlock'], factsByTarget: { warlock: SELF_FACTS },
      spell: { baseLevel: 1, castLevel: 2, grantId: 'grant:warlock:spell.armor-of-agathys:spell_slot_2' },
      choices: { temporary_hp: 'take_spell' },
    })));
    expect(instance.getState().actors.warlock.runtime).toMatchObject({
      hp: { temp: 10 },
      resources: { bonus_action: 0, spell_slot_2: 0, spell_slot_1: 1 },
      activeEffects: [expect.objectContaining({
        id: 'cast-armor:id:1', roundsLeft: 600,
        mechanics: expect.objectContaining({
          slotLevel: 2,
          retaliationDamage: 10,
          sourceEntityIds: ['custom-spell-entity'],
        }),
      })],
    });
    const declaration = cast.events.find((event) => event.payload.type === 'ActionDeclared');
    expect(declaration?.payload).toMatchObject({
      type: 'ActionDeclared',
      spell: {
        grantId: 'grant:warlock:spell.armor-of-agathys:spell_slot_2',
        sourceId: 'source:warlock', castLevel: 2,
        payment: { kind: 'slot', resource: 'spell_slot_2' },
      },
    });
    replay(initial, instance);

    const forged = actor({
      id: 'warlock', actionIds: [ARMOR.id],
      spellAccess: access([grant({ actorId: 'warlock', action: ARMOR, slotResource: 'spell_slot_1' })]),
    });
    const forgedSession = session(createWorld({
      id: 'forged-upcast', ruleset: RULESET, actors: [forged, actor({ id: 'ally' })],
    }));
    expect(forgedSession.dispatch(command({
      ...base(forgedSession, 'forged-upcast', 'warlock'), type: 'UseAction', actionId: ARMOR.id,
      targetIds: ['warlock'], factsByTarget: { warlock: SELF_FACTS },
      spell: { baseLevel: 1, castLevel: 2 }, choices: { temporary_hp: 'take_spell' },
    }))).toMatchObject({ status: 'rejected', code: 'InvalidSpellDeclaration' });
  });

  it('keeps current THP explicitly, replaces only its previous copy, and omits a zero-THP effect', () => {
    const unrelated = {
      id: 'unrelated', name: 'Unrelated', mechanics: { kind: 'modifier' },
      source: 'test', ownerId: 'warlock', sourceId: 'warlock',
    };
    const warlock = actor({
      id: 'warlock', temp: 8, armorSlotLevel: 1, actionIds: [ARMOR.id],
      spellAccess: access([grant({ actorId: 'warlock', action: ARMOR, slotResource: 'spell_slot_1' })]),
    });
    warlock.runtime.activeEffects.push(unrelated);
    const instance = session(createWorld({
      id: 'keep-armor', ruleset: RULESET, actors: [warlock, actor({ id: 'ally' })],
    }));
    accepted(instance.dispatch(command({
      ...base(instance, 'keep-cast', 'warlock'), type: 'UseAction', actionId: ARMOR.id,
      targetIds: ['warlock'], factsByTarget: { warlock: SELF_FACTS }, spell: { baseLevel: 1 },
      choices: { temporary_hp: 'keep_current' },
    })));
    expect(instance.getState().actors.warlock.runtime.hp.temp).toBe(8);
    expect(instance.getState().actors.warlock.runtime.activeEffects.map(({ id }) => id).sort())
      .toEqual(['keep-cast:id:1', 'unrelated']);

    const empty = actor({
      id: 'warlock', actionIds: [ARMOR.id],
      spellAccess: access([grant({ actorId: 'warlock', action: ARMOR, slotResource: 'spell_slot_1' })]),
    });
    const emptySession = session(createWorld({
      id: 'empty-armor', ruleset: RULESET, actors: [empty, actor({ id: 'ally' })],
    }));
    accepted(emptySession.dispatch(command({
      ...base(emptySession, 'empty-cast', 'warlock'), type: 'UseAction', actionId: ARMOR.id,
      targetIds: ['warlock'], factsByTarget: { warlock: SELF_FACTS }, spell: { baseLevel: 1 },
      choices: { temporary_hp: 'keep_current' },
    })));
    expect(emptySession.getState().actors.warlock.runtime.hp.temp).toBe(0);
    expect(emptySession.getState().actors.warlock.runtime.activeEffects).toEqual([]);
  });

  it('retaliates after a canonical weapon hit across every Cold damage adjustment', () => {
    const cases = [
      [undefined, 5],
      ['resistance', 2],
      ['immunity', 0],
      ['vulnerability', 10],
    ] as const;
    for (const [adjustment, damage] of cases) {
      const attacker = actor({ id: 'attacker', weapon: true, damageAdjustment: adjustment });
      const defender = armorDefender();
      const initial = createWorld({ id: `weapon-${adjustment}`, ruleset: RULESET, actors: [attacker, defender] });
      const instance = session(initial);
      encounter(instance);
      const attack = beginAttack(instance);
      const result = accepted(instance.dispatch(command({
        ...base(instance, 'weapon-hit', 'attacker'), type: 'PerformWeaponAttack',
        attackActionId: attack.id, weaponCardId: CARD_LONGSWORD.id,
        targetActorId: 'warlock', facts: FACTS,
      })));
      expect(instance.getState().actors.attacker.runtime.hp.current).toBe(20 - damage);
      expect(instance.getState().actors.warlock.runtime.hp.temp).toBe(0);
      expect(instance.getState().actors.warlock.runtime.activeEffects.some((effect) => (
        (effect.mechanics as Record<string, unknown>).kind === 'temporary_hp_melee_retaliation'
      ))).toBe(false);
      if (adjustment) {
        expect(engineEvents(result.events)).toContainEqual(expect.objectContaining({
          type: 'narrative',
          damageAdjustment: expect.objectContaining({
            damageType: 'cold', adjustment, before: 5, after: damage,
          }),
        }));
      }
      replay(initial, instance);
    }
  });

  it('retaliates for unarmed and spell melee hits, but not for a ranged spell hit', () => {
    const unarmedInitial = createWorld({
      id: 'unarmed-armor', ruleset: RULESET,
      actors: [actor({ id: 'attacker' }), armorDefender(5)],
    });
    const unarmed = session(unarmedInitial);
    encounter(unarmed);
    const attack = beginAttack(unarmed);
    accepted(unarmed.dispatch(command({
      ...base(unarmed, 'unarmed-hit', 'attacker'), type: 'PerformUnarmedStrike',
      attackActionId: attack.id, option: 'damage', targetActorId: 'warlock', facts: FACTS,
    })));
    expect(unarmed.getState().actors.attacker.runtime.hp.current).toBe(15);

    for (const [action, expectedHp] of [[MELEE_SPELL, 15], [RANGED_SPELL, 20]] as const) {
      const attacker = actor({
        id: 'attacker', actionIds: [action.id],
        spellAccess: access([grant({ actorId: 'attacker', action })]),
      });
      const initial = createWorld({
        id: action.id, ruleset: RULESET, actors: [attacker, armorDefender(10, 1)],
      });
      const instance = session(initial);
      accepted(instance.dispatch(command({
        ...base(instance, `cast:${action.id}`, 'attacker'), type: 'UseAction', actionId: action.id,
        targetIds: ['warlock'], factsByTarget: { warlock: FACTS }, spell: { baseLevel: 0 },
      })));
      expect(instance.getState().actors.attacker.runtime.hp.current).toBe(expectedHp);
      expect(instance.getState().actors.warlock.runtime.activeEffects.some((effect) => (
        (effect.mechanics as Record<string, unknown>).kind === 'temporary_hp_melee_retaliation'
      ))).toBe(true);
    }
  });

  it('ends after another event removes all THP without treating non-attack damage as a trigger', () => {
    const attacker = actor({ id: 'attacker', actionIds: [AUTO_DAMAGE.id] });
    const initial = createWorld({
      id: 'non-attack-end', ruleset: RULESET, actors: [attacker, armorDefender()],
    });
    const instance = session(initial);
    accepted(instance.dispatch(command({
      ...base(instance, 'automatic-damage', 'attacker'), type: 'UseAction', actionId: AUTO_DAMAGE.id,
      targetIds: ['warlock'], factsByTarget: { warlock: FACTS },
    })));
    expect(instance.getState().actors.attacker.runtime.hp.current).toBe(20);
    expect(instance.getState().actors.warlock.runtime.hp.temp).toBe(0);
    expect(instance.getState().actors.warlock.runtime.activeEffects.some((effect) => (
      (effect.mechanics as Record<string, unknown>).kind === 'temporary_hp_melee_retaliation'
    ))).toBe(false);
    replay(initial, instance);
  });

  it('resolves retaliation after a Shield resume only when the final attack still hits', () => {
    function run(rng: () => number) {
      const attacker = actor({ id: 'attacker', actionIds: [STRIKE.id] });
      const defender = armorDefender(10, 1, true);
      const instance = session(createWorld({
        id: 'shield-resume', ruleset: RULESET, actors: [attacker, defender],
      }), rng);
      accepted(instance.dispatch(command({
        ...base(instance, 'open-hit', 'attacker'), type: 'UseAction', actionId: STRIKE.id,
        targetIds: ['warlock'], factsByTarget: { warlock: FACTS },
      })));
      const pending = instance.getState().pendingResolution;
      if (!pending || pending.type !== 'attack_reaction') throw new Error('Expected Shield window');
      accepted(instance.dispatch(command({
        ...base(instance, 'cast-shield', 'warlock'), type: 'ResolveDecision',
        resolutionId: pending.id, requestId: pending.request.id,
        response: { kind: 'reaction', actionId: SHIELD.id },
      })));
      return instance;
    }

    const survivesShield = run(() => 0.95);
    expect(survivesShield.getState().actors.attacker.runtime.hp.current).toBe(15);
    expect(survivesShield.getState().actors.warlock.runtime.hp.temp).toBeLessThan(10);

    const blockedByShield = run(() => 0.5);
    expect(blockedByShield.getState().actors.attacker.runtime.hp.current).toBe(20);
    expect(blockedByShield.getState().actors.warlock.runtime.hp.temp).toBe(10);
  });

  it('queues a CON save when retaliation damages the concentrating attacker', () => {
    const attacker = actor({
      id: 'attacker', weapon: true, concentrating: true,
      actionIds: ['spell.concentration'],
    });
    const defender = armorDefender();
    const initial = createWorld({
      id: 'retaliation-concentration', ruleset: RULESET, actors: [attacker, defender],
    });
    initial.concentrations.attacker = {
      id: 'attacker:concentration', sourceActorId: 'attacker',
      actionId: 'spell.concentration', startedAtRevision: 0,
      effectLinks: [{ actorId: 'attacker', effectId: 'concentration-marker:attacker' }],
    };
    const instance = session(initial);
    encounter(instance);
    expect(instance.getState().concentrations.attacker).toBeDefined();
    const attack = beginAttack(instance);
    accepted(instance.dispatch(command({
      ...base(instance, 'weapon-hit-concentrating', 'attacker'), type: 'PerformWeaponAttack',
      attackActionId: attack.id, weaponCardId: CARD_LONGSWORD.id,
      targetActorId: 'warlock', facts: FACTS,
    })));
    expect(instance.getState().pendingResolution).toMatchObject({
      type: 'concentration_save', actorId: 'attacker',
      concentrationId: 'attacker:concentration', damage: 5,
      request: { ability: 'con', dc: 10 },
    });
    replay(initial, instance);
  });

  it('reloads independent retaliation groups from different declarative source actions', () => {
    const owner = actor({
      id: 'warlock', temp: 8, actionIds: [ARMOR.id, GENERIC_FROST_WARD.id],
    });
    const genericPolicy = temporaryHpMeleeRetaliationPolicyFromMechanics(
      GENERIC_FROST_WARD.mechanics.primitive,
    )!;
    owner.runtime.activeEffects = [
      createArmorOfAgathysEffect({
        id: 'armor-group', actorId: owner.id, actionId: ARMOR.id, name: ARMOR.name,
        slotLevel: 1, policy: ARMOR_POLICY, sourceEntityIds: ARMOR.sourceEntityIds,
      }),
      createArmorOfAgathysEffect({
        id: 'ward-group', actorId: owner.id, actionId: GENERIC_FROST_WARD.id,
        name: GENERIC_FROST_WARD.name, slotLevel: 1, policy: genericPolicy,
        sourceEntityIds: GENERIC_FROST_WARD.sourceEntityIds,
      }),
    ];
    const migrated = migrateWorldState(createWorld({
      id: 'multi-retaliation-groups', ruleset: RULESET,
      actors: [owner, actor({ id: 'ally' })],
    }));
    expect(migrated.actors.warlock.runtime.activeEffects.map(({ id }) => id))
      .toEqual(['armor-group', 'ward-group']);
  });

  it('fails closed on forged persisted duration, scaling, ownership, action, and zero THP', () => {
    const valid = createWorld({
      id: 'armor-migration', ruleset: RULESET,
      actors: [armorDefender(), actor({ id: 'ally' })],
    });
    expect(migrateWorldState(JSON.parse(JSON.stringify(valid)))).toEqual(migrateWorldState(valid));
    const cases: Array<[string, (world: WorldState) => void, RegExp]> = [
      ['duration', (world) => { world.actors.warlock.runtime.activeEffects[0].roundsLeft = 601; }, /duration/],
      ['damage', (world) => {
        (world.actors.warlock.runtime.activeEffects[0].mechanics as Record<string, unknown>).retaliationDamage = 6;
      }, /inconsistent/],
      ['owner', (world) => { world.actors.warlock.runtime.activeEffects[0].ownerId = 'ally'; }, /owner and source/],
      ['action', (world) => {
        (world.actors.warlock.runtime.activeEffects[0].mechanics as Record<string, unknown>).actionId = 'forged';
      }, /not actor-owned/],
      ['temp', (world) => { world.actors.warlock.runtime.hp.temp = 0; }, /positive Temporary HP/],
      ['duplicate', (world) => {
        world.actors.warlock.runtime.activeEffects.push({
          ...world.actors.warlock.runtime.activeEffects[0], id: 'duplicate-armor',
        });
      }, /multiple retaliations for one source action/],
    ];
    for (const [label, mutate, message] of cases) {
      const forged = JSON.parse(JSON.stringify(valid)) as WorldState;
      mutate(forged);
      expect(() => migrateWorldState(forged), label).toThrow(message);
    }
  });
});
