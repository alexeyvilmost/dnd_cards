import { beforeAll, describe, expect, it } from 'vitest';
import {
  materializeMicroMvpL1ContentPatch,
} from '../../canon/declarativeMechanicsPatch';
import {
  compileMicroMvpL1ChoiceVariants,
  compileMicroMvpL1Overlay,
  type CompiledMicroMvpL1Provider,
} from '../../canon/microMvpL1Overlay';
import {
  readMicroMvpSnapshotManifest,
  readProdSnapshotCatalogs,
  type SnapshotCatalogs,
} from '../../canon/prodSnapshotL1Fixtures';
import { createLogicalClock, createSequentialIdFactory, createStrictRngTape } from '../determinism';
import {
  createWorld,
  type ActorState,
  type GameCommand,
  type JsonObject,
  type RuleActionDefinition,
  type SpatialFacts,
} from '../domain';
import { buildMicroMvpSpellScopePolicy } from '../microMvpSpellScope';
import { InMemoryRulesSession } from '../session';

const HARMFUL_SOURCE_CARDS = [
  'ACT-breath-acid',
  'ACT-breath-cold',
  'ACT-breath-fire',
  'ACT-breath-lightning',
  'ACT-breath-poison',
  'SPELL-0171',
  'SPELL-0174',
  'SPELL-0218',
  'SPELL-0229',
  'SPELL-0242',
  'SPELL-0286',
  'chill_touch',
  'fire_bolt',
  'poison_spray',
] as const;

const NON_HARMFUL_SOURCE_CARDS = [
  'ACTION-0001',
  'ACT-second-wind',
  'EFF-innate-sorcery',
  'EFF-pact-blade',
  'RE-dwarf-4',
  'SPELL-0163',
  'SPELL-0189',
  'SPELL-0190',
  'SPELL-0214',
  'SPELL-0230',
  'SPELL-0236',
  'SPELL-0241',
  'SPELL-0252',
  'SPELL-0317',
  'dancing_lights',
  'detect_magic',
  'druidcraft',
  'false_life',
  'light',
  'mending',
  'minor_illusion',
  'prestidigitation',
] as const;

const EXPECTED_NON_SPELL_SOURCE_CARDS = [
  'ACTION-0001',
  'ACT-breath-acid',
  'ACT-breath-cold',
  'ACT-breath-fire',
  'ACT-breath-lightning',
  'ACT-breath-poison',
  'ACT-second-wind',
  'EFF-innate-sorcery',
  'EFF-pact-blade',
  'RE-dwarf-4',
] as const;

const EXPECTED_SOURCE_CARDS = [
  ...HARMFUL_SOURCE_CARDS,
  ...NON_HARMFUL_SOURCE_CARDS,
] as const;

const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'micro-mvp-harmful-intent-gate@1',
  contentHash: 'sha256:micro-mvp-harmful-intent-gate',
  errataVersion: 'phb-2024',
};

const FACTS: SpatialFacts = {
  factsSource: 'scenario',
  boardRevision: 0,
  distanceFt: 5,
  lineOfSight: true,
  cover: 'none',
  relation: 'enemy',
};

type ExecutableSource = {
  id: string;
  card_number: string;
  name: string;
  mechanics?: JsonObject | null;
};

type CommandInput = GameCommand extends infer Command
  ? Command extends GameCommand
    ? Omit<Command, 'schemaVersion' | 'expectedRevision' | 'rulesetContentHash' | 'actorId'>
    : never
  : never;

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function interaction(mechanics: JsonObject | null | undefined): unknown {
  return mechanics?.interaction;
}

function actor(input: {
  id: string;
  actionIds?: string[];
  activeEffects?: ActorState['runtime']['activeEffects'];
}): ActorState {
  return {
    id: input.id,
    name: input.id,
    kind: 'playerCharacter',
    controllerId: `${input.id}:controller`,
    ac: 10,
    capabilities: { actionIds: [...(input.actionIds ?? [])] },
    character: {
      abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      profBonus: 2,
      level: 1,
      knownCards: [],
      equippedCards: [],
    },
    runtime: {
      hp: { current: 10, max: 10, temp: 0 },
      resources: { action: 1 },
      maxResources: { action: 1 },
      equipment: {},
      inventory: [],
      activeEffects: input.activeEffects ?? [],
      firedThisTurn: [],
    },
    lifecycle: { status: 'alive' },
  };
}

function charmedBy(sourceActorId: string): ActorState['runtime']['activeEffects'][number] {
  return {
    id: 'condition:charmed:release-gate',
    name: 'Charmed',
    source: 'release-gate',
    sourceId: sourceActorId,
    expiry: 'manual',
    mechanics: { kind: 'condition', value: 'charmed' },
  };
}

function syntheticAction(input: { id: string; name: string; marker: boolean }): RuleActionDefinition {
  return {
    id: input.id,
    name: input.name,
    kind: 'nonSpell',
    sourceEntityIds: [`source:${input.id}`],
    targeting: {
      minTargets: 1,
      maxTargets: 1,
      rangeFt: 30,
      requiresLineOfSight: true,
      allowedRelations: ['enemy'],
    },
    mechanics: {
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      ...(input.marker ? { interaction: { intent: 'harmful' } } : {}),
      effects: [{
        resolution: 'auto',
        who: 'target',
        result: [{ kind: 'damage', amount: '1', type: 'force' }],
      }],
    },
  };
}

function dispatchSynthetic(action: RuleActionDefinition) {
  const target = actor({ id: 'actor:charmer' });
  const acting = actor({
    id: 'actor:charmed',
    actionIds: [action.id],
    activeEffects: [charmedBy(target.id)],
  });
  const session = new InMemoryRulesSession(
    createWorld({ id: `world:${action.id}`, ruleset: RULESET, actors: [acting, target] }),
    { getAction: (id) => id === action.id ? action : undefined },
    {
      rng: createStrictRngTape([]).rng,
      clock: createLogicalClock(900_000),
      nextId: createSequentialIdFactory('harmful-intent-gate'),
    },
  );
  const command: CommandInput = {
    type: 'UseAction',
    commandId: `command:${action.id}`,
    actionId: action.id,
    targetIds: [target.id],
    factsByTarget: { [target.id]: FACTS },
  };
  return session.dispatch({
    schemaVersion: 1,
    expectedRevision: session.getState().revision,
    rulesetContentHash: RULESET.contentHash,
    actorId: acting.id,
    ...command,
  } as GameCommand);
}

describe('micro-MVP exact harmful-intent release gate', () => {
  let catalogs: SnapshotCatalogs;
  let provider: CompiledMicroMvpL1Provider;
  let executableSources: ExecutableSource[];
  let compiledActionsBySource: Map<string, RuleActionDefinition[]>;

  beforeAll(async () => {
    const rawCatalogs = readProdSnapshotCatalogs();
    catalogs = materializeMicroMvpL1ContentPatch(rawCatalogs).catalogs;
    const [manifest, compiled] = await Promise.all([
      readMicroMvpSnapshotManifest(),
      compileMicroMvpL1Overlay(),
    ]);
    provider = compiled;

    const spellPolicy = buildMicroMvpSpellScopePolicy({
      manifest,
      snapshotSpells: catalogs.spells,
    });
    const warlockRoot = provider.roots.find((root) => (
      root.matrixCase.klass.card_number === 'CLASS-warlock'
    ));
    if (!warlockRoot) {
      throw new Error('The harmful-intent gate cannot construct its focused compile variants');
    }
    const focusedRoots = await compileMicroMvpL1ChoiceVariants([
      {
        stableKey: warlockRoot.stableKey,
        overrides: { warlock_invocation_l1: ['EFF-pact-blade'] },
      },
    ]);
    const compiledRoots = [...provider.roots, ...focusedRoots];
    const curatedSpellIds = new Set(spellPolicy.spells.map((spell) => spell.id));
    const primaryCompiledSourceIds = new Set(compiledRoots.flatMap((root) => (
      root.rulesActions.map((action) => action.sourceEntityIds[0])
    )));
    const spellSources = catalogs.spells.filter((spell) => curatedSpellIds.has(spell.id));
    const nonSpellSources = [...catalogs.actions, ...catalogs.effects].filter((entity) => (
      primaryCompiledSourceIds.has(entity.id)
    ));
    executableSources = [...spellSources, ...nonSpellSources];

    compiledActionsBySource = new Map();
    for (const action of compiledRoots.flatMap((root) => root.rulesActions)) {
      const sourceId = action.sourceEntityIds[0];
      const actions = compiledActionsBySource.get(sourceId) ?? [];
      if (!actions.some((candidate) => candidate.id === action.id)) actions.push(action);
      compiledActionsBySource.set(sourceId, actions);
    }
  }, 60_000);

  it('pins the exact 36 executable source definitions and their 14/22 partition', () => {
    expect(HARMFUL_SOURCE_CARDS).toHaveLength(14);
    expect(NON_HARMFUL_SOURCE_CARDS).toHaveLength(22);
    expect(new Set(EXPECTED_SOURCE_CARDS).size).toBe(36);
    expect(sorted(executableSources.map((source) => source.card_number)))
      .toEqual(sorted(EXPECTED_SOURCE_CARDS));
    expect(executableSources).toHaveLength(36);
    expect(sorted(executableSources
      .filter((source) => !catalogs.spells.some((spell) => spell.id === source.id))
      .map((source) => source.card_number)))
      .toEqual(sorted(EXPECTED_NON_SPELL_SOURCE_CARDS));
  });

  it('requires the exact materialized marker on all 14 harmful sources and forbids it on the other 22', () => {
    const harmful = executableSources.filter((source) => (
      JSON.stringify(interaction(source.mechanics)) === JSON.stringify({ intent: 'harmful' })
    ));
    expect(sorted(harmful.map((source) => source.card_number)))
      .toEqual(sorted(HARMFUL_SOURCE_CARDS));

    for (const source of executableSources) {
      const expected = (HARMFUL_SOURCE_CARDS as readonly string[]).includes(source.card_number)
        ? { intent: 'harmful' }
        : undefined;
      expect(interaction(source.mechanics), source.card_number).toEqual(expected);

      // Some curated world/narrative primitives are valid source definitions
      // without appearing in the deterministic default roots. Whenever the
      // compiler does emit a RuleActionDefinition, the declarative marker must
      // survive unchanged; source materialization above remains the 36-item
      // authority denominator.
      for (const action of compiledActionsBySource.get(source.id) ?? []) {
        expect(interaction(action.mechanics), `${source.card_number} -> ${action.id}`)
          .toEqual(expected);
      }
    }
  });

  it('does not infer harmful intent at runtime from localized names or damage payloads', () => {
    const unmarkedDamage = syntheticAction({
      id: 'action:unmarked-damage',
      name: 'Атака убийственным огненным уроном',
      marker: false,
    });
    expect(dispatchSynthetic(unmarkedDamage)).toMatchObject({ status: 'accepted' });

    const markedFriendlyName = syntheticAction({
      id: 'action:marked-friendly-name',
      name: 'Безобидная помощь другу',
      marker: true,
    });
    expect(dispatchSynthetic(markedFriendlyName)).toMatchObject({
      status: 'rejected',
      code: 'CapabilityDenied',
    });
  });
});
