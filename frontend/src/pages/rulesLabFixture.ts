import type {
  ActorState,
  RuleActionDefinition,
  RulesCatalog,
  RulesetReference,
  UncommittedRuleEvent,
  WorldState,
} from '../rules-core/domain';
import { createWorld } from '../rules-core/domain';
import { FIND_FAMILIAR_MATERIAL_RESOURCE } from '../rules-core/familiarRuntime';
import type { WorldObjectState } from '../rules-core/worldObjects';
import { BrowserIndexedDbRulesWorldStore } from '../rules-session/indexedDbStore';
import { PersistentRulesSession } from '../rules-session/RulesSession';
import type { RulesWorldStore } from '../rules-session/store';
import type { Card } from '../types';
import compiledFixture from './rulesLabFixture.generated.json';

export const RULES_LAB_FIXTURE_VERSION = compiledFixture.fixtureVersion;
export const RULES_LAB_WORLD_ID = 'rules-lab:dnd-2024:compiled-l1-v4';
export const RULES_LAB_DATABASE_NAME = 'dnd-cards-rules-lab-v4';
export const RULES_LAB_DATABASE_SCHEMA_VERSION = 4;
export const RULES_LAB_ACTOR_IDS = ['fighter', 'wizard'] as const;
export const RULES_LAB_OBJECT_ID = 'rules-lab:unsecured-crate' as const;

type RulesLabActorId = typeof RULES_LAB_ACTOR_IDS[number];

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const RULES_LAB_RULESET = cloneJson(
  compiledFixture.source.ruleset,
) as RulesetReference;

const WIZARD_ACTION_ID = compiledFixture.execution.wizardActionId;
export const RULES_LAB_FIGHTER_WEAPON_CARD_ID = compiledFixture.execution.fighterWeaponCardId;
const sourceWizardAction = compiledFixture.roots.wizard.actions.find(
  (action) => action.id === WIZARD_ACTION_ID,
);
if (!sourceWizardAction) {
  throw new Error(`Generated Rules Lab fixture misses Wizard action ${WIZARD_ACTION_ID}`);
}

/**
 * The board supplies the creatures inside Thunderwave's cube; rules-core now
 * executes the compiled multi-target action directly without a one-target UI adapter.
 */
const executableWizardAction = cloneJson(sourceWizardAction) as unknown as RuleActionDefinition;

export const RULES_LAB_ACTIONS: readonly RuleActionDefinition[] = [
  executableWizardAction,
];

export const RULES_LAB_CATALOG: RulesCatalog = {
  getAction: (id) => RULES_LAB_ACTIONS.find((action) => action.id === id),
};

function compiledActor(role: RulesLabActorId): ActorState {
  const source = cloneJson(compiledFixture.roots[role].actor) as unknown as ActorState;
  const projected: ActorState = {
    ...source,
    id: role,
    controllerId: `rules-lab:${role}:controller`,
    capabilities: {
      ...source.capabilities,
      actionIds: role === 'wizard'
        ? [...new Set([...source.capabilities.actionIds, WIZARD_ACTION_ID])]
        : [...source.capabilities.actionIds],
    },
  };
  if (role === 'wizard') return projected;

  const weapon = cloneJson(compiledFixture.weaponCard) as unknown as Card;
  return {
    ...projected,
    character: {
      ...projected.character,
      equippedCards: [weapon],
      knownCards: [weapon],
    },
    runtime: {
      ...projected.runtime,
      equipment: { main_hand: weapon.id },
      inventory: [{ cardId: weapon.id, qty: 1 }],
    },
  };
}

export function createRulesLabWorld(): WorldState {
  return createWorld({
    id: RULES_LAB_WORLD_ID,
    ruleset: RULES_LAB_RULESET,
    actors: RULES_LAB_ACTOR_IDS.map(compiledActor),
    objects: [{
      id: RULES_LAB_OBJECT_ID,
      name: 'Незакреплённый ящик',
      kind: 'environment',
      size: 'medium',
    }],
  });
}

export const RULES_LAB_BLADE_ACTOR_IDS = ['blade-warlock', 'blade-defender'] as const;
export const RULES_LAB_CHAIN_ACTOR_IDS = ['chain-warlock', 'chain-target'] as const;
export const RULES_LAB_TOME_ACTOR_IDS = ['tome-warlock', 'tome-defender'] as const;
export const RULES_LAB_FAMILIAR_ACTOR_IDS = ['familiar-wizard', 'familiar-defender'] as const;

export interface RulesLabPactExecution {
  blade: {
    bondActionId: string;
    weaponCardId: string;
    defenderShieldActionId: string;
    defenderShieldGrantId: string;
  };
  chain: {
    findFamiliarActionId: string;
    findFamiliarGrantId: string;
    familiarActionId: string;
  };
  tome: {
    initialBookObjectId: string;
    cantripActionId: string;
    cantripActionIds: readonly [string, string, string];
    ritualActionIds: readonly [string, string];
  };
  familiar: {
    findFamiliarActionId: string;
    findFamiliarGrantId: string;
    chillTouchActionId: string;
    chillTouchGrantId: string;
    shieldActionId: string;
    shieldGrantId: string;
  };
}

export const RULES_LAB_PACT_EXECUTION = cloneJson(
  compiledFixture.execution.scenarios,
) as unknown as RulesLabPactExecution;

type PactRootKey = 'blade' | 'chain' | 'tome' | 'familiarWizard';

function pactActions(...keys: PactRootKey[]): RuleActionDefinition[] {
  const byId = new Map<string, RuleActionDefinition>();
  for (const key of keys) {
    for (const action of cloneJson(compiledFixture.roots[key].actions) as unknown as RuleActionDefinition[]) {
      byId.set(action.id, action);
    }
  }
  return [...byId.values()];
}

function catalogForPactScenario(
  actions: readonly RuleActionDefinition[],
  includeWeapon = false,
): RulesCatalog {
  const weapon = cloneJson(compiledFixture.weaponCard) as unknown as Card;
  return {
    getAction: (id) => actions.find((action) => action.id === id),
    ...(includeWeapon ? { getCard: (id: string) => (id === weapon.id ? weapon : undefined) } : {}),
  };
}

function remapCompiledActor(source: ActorState, actorId: string): ActorState {
  const actor = cloneJson(source);
  actor.id = actorId;
  actor.name = actorId;
  actor.controllerId = `rules-lab:${actorId}:controller`;
  if (actor.warlockPacts?.blade) {
    actor.warlockPacts.blade.ownerActorId = actorId;
    if (actor.warlockPacts.blade.activeBond) {
      actor.warlockPacts.blade.activeBond.warlockActorId = actorId;
    }
  }
  if (actor.warlockPacts?.chain) {
    actor.warlockPacts.chain.ownerActorId = actorId;
    actor.warlockPacts.chain.activeFamiliar = null;
  }
  if (actor.warlockPacts?.tome) {
    actor.warlockPacts.tome.ownerActorId = actorId;
    actor.warlockPacts.tome.tome.ownerActorId = actorId;
  }
  return actor;
}

function remapCompiledObjects(
  objects: readonly WorldObjectState[],
  oldActorId: string,
  actorId: string,
): WorldObjectState[] {
  return cloneJson(objects).map((object) => ({
    ...object,
    ...(object.ownerActorId === oldActorId ? { ownerActorId: actorId } : {}),
    ...(object.carriedByActorId === oldActorId ? { carriedByActorId: actorId } : {}),
    ...(object.heldByActorId === oldActorId ? { heldByActorId: actorId } : {}),
    ...(object.sourceActorId === oldActorId ? { sourceActorId: actorId } : {}),
  }));
}

function addFamiliarMaterial(actor: ActorState, amount: number): ActorState {
  actor.runtime.resources[FIND_FAMILIAR_MATERIAL_RESOURCE] = amount;
  actor.runtime.maxResources[FIND_FAMILIAR_MATERIAL_RESOURCE] = amount;
  actor.character.resourceRecharge = {
    ...(actor.character.resourceRecharge ?? {}),
    [FIND_FAMILIAR_MATERIAL_RESOURCE]: 'never',
  };
  return actor;
}

function actorFromRoot(key: PactRootKey, actorId: string): ActorState {
  return remapCompiledActor(
    cloneJson(compiledFixture.roots[key].actor) as unknown as ActorState,
    actorId,
  );
}

export const RULES_LAB_BLADE_ACTIONS = pactActions('blade', 'familiarWizard');
export const RULES_LAB_CHAIN_ACTIONS = pactActions('chain');
export const RULES_LAB_TOME_ACTIONS = pactActions('tome', 'familiarWizard');
export const RULES_LAB_FAMILIAR_ACTIONS = pactActions('familiarWizard');

export const RULES_LAB_BLADE_CATALOG = catalogForPactScenario(RULES_LAB_BLADE_ACTIONS, true);
export const RULES_LAB_CHAIN_CATALOG = catalogForPactScenario(RULES_LAB_CHAIN_ACTIONS);
export const RULES_LAB_TOME_CATALOG = catalogForPactScenario(RULES_LAB_TOME_ACTIONS);
export const RULES_LAB_FAMILIAR_CATALOG = catalogForPactScenario(RULES_LAB_FAMILIAR_ACTIONS);

function createBladeWorld(): WorldState {
  const warlock = actorFromRoot('blade', RULES_LAB_BLADE_ACTOR_IDS[0]);
  const defender = actorFromRoot('familiarWizard', RULES_LAB_BLADE_ACTOR_IDS[1]);
  defender.runtime.hp = { current: 20, max: 20, temp: 0 };
  return createWorld({
    id: 'rules-lab:dnd-2024:pact-blade-v1',
    ruleset: RULES_LAB_RULESET,
    actors: [warlock, defender],
  });
}

function createChainWorld(): WorldState {
  const warlock = addFamiliarMaterial(
    actorFromRoot('chain', RULES_LAB_CHAIN_ACTOR_IDS[0]),
    20,
  );
  const target = actorFromRoot('familiarWizard', RULES_LAB_CHAIN_ACTOR_IDS[1]);
  target.runtime.hp = { current: 20, max: 20, temp: 0 };
  return createWorld({
    id: 'rules-lab:dnd-2024:pact-chain-v1',
    ruleset: RULES_LAB_RULESET,
    actors: [warlock, target],
  });
}

function createTomeWorld(): WorldState {
  const sourceActor = cloneJson(compiledFixture.roots.tome.actor) as unknown as ActorState;
  const warlock = remapCompiledActor(sourceActor, RULES_LAB_TOME_ACTOR_IDS[0]);
  const defender = actorFromRoot('familiarWizard', RULES_LAB_TOME_ACTOR_IDS[1]);
  defender.runtime.hp = { current: 20, max: 20, temp: 0 };
  const objects = remapCompiledObjects(
    cloneJson(compiledFixture.roots.tome.initialWorldObjects) as unknown as WorldObjectState[],
    sourceActor.id,
    warlock.id,
  );
  return createWorld({
    id: 'rules-lab:dnd-2024:pact-tome-v1',
    ruleset: RULES_LAB_RULESET,
    actors: [warlock, defender],
    objects,
  });
}

function createFamiliarWorld(): WorldState {
  const wizard = addFamiliarMaterial(
    actorFromRoot('familiarWizard', RULES_LAB_FAMILIAR_ACTOR_IDS[0]),
    20,
  );
  const defender = actorFromRoot('familiarWizard', RULES_LAB_FAMILIAR_ACTOR_IDS[1]);
  defender.runtime.hp = { current: 20, max: 20, temp: 0 };
  return createWorld({
    id: 'rules-lab:dnd-2024:familiar-v1',
    ruleset: RULES_LAB_RULESET,
    actors: [wizard, defender],
  });
}

const EXPLICIT_D20_VALUES = [14, 7, 18, 5, 16, 9, 12, 20, 3, 11, 15, 6] as const;

export interface RulesLabRollPreview {
  ordinal: number;
  sides: 20;
  value: number;
}

export class RulesLabRollQueue {
  private cursor: number;

  constructor(private readonly initialCursor = 0) {
    this.cursor = initialCursor;
  }

  readonly rng = (): number => {
    const value = EXPLICIT_D20_VALUES[this.cursor % EXPLICIT_D20_VALUES.length];
    this.cursor += 1;
    return (value - 0.5) / 20;
  };

  consumedThisSession(): number {
    return this.cursor - this.initialCursor;
  }

  peek(count = 6): RulesLabRollPreview[] {
    return Array.from({ length: count }, (_, offset) => ({
      ordinal: this.cursor + offset + 1,
      sides: 20 as const,
      value: EXPLICIT_D20_VALUES[(this.cursor + offset) % EXPLICIT_D20_VALUES.length],
    }));
  }
}

export interface RulesLabSessionHandle {
  session: PersistentRulesSession;
  rollQueue: RulesLabRollQueue;
  initialEvents: UncommittedRuleEvent[];
  close: () => Promise<void>;
}

export interface RulesLabScenarioSessionConfig {
  worldId: string;
  ruleset: RulesetReference;
  playerActorIds: readonly [string, string];
  requiredObjectIds: readonly string[];
  catalog: RulesCatalog;
  createWorld: () => WorldState;
}

export const RULES_LAB_BASELINE_SESSION_CONFIG: RulesLabScenarioSessionConfig = {
  worldId: RULES_LAB_WORLD_ID,
  ruleset: RULES_LAB_RULESET,
  playerActorIds: RULES_LAB_ACTOR_IDS,
  requiredObjectIds: [RULES_LAB_OBJECT_ID],
  catalog: RULES_LAB_CATALOG,
  createWorld: createRulesLabWorld,
};

export const RULES_LAB_BLADE_SESSION_CONFIG: RulesLabScenarioSessionConfig = {
  worldId: 'rules-lab:dnd-2024:pact-blade-v1',
  ruleset: RULES_LAB_RULESET,
  playerActorIds: RULES_LAB_BLADE_ACTOR_IDS,
  requiredObjectIds: [],
  catalog: RULES_LAB_BLADE_CATALOG,
  createWorld: createBladeWorld,
};

export const RULES_LAB_CHAIN_SESSION_CONFIG: RulesLabScenarioSessionConfig = {
  worldId: 'rules-lab:dnd-2024:pact-chain-v1',
  ruleset: RULES_LAB_RULESET,
  playerActorIds: RULES_LAB_CHAIN_ACTOR_IDS,
  requiredObjectIds: [],
  catalog: RULES_LAB_CHAIN_CATALOG,
  createWorld: createChainWorld,
};

export const RULES_LAB_TOME_SESSION_CONFIG: RulesLabScenarioSessionConfig = {
  worldId: 'rules-lab:dnd-2024:pact-tome-v1',
  ruleset: RULES_LAB_RULESET,
  playerActorIds: RULES_LAB_TOME_ACTOR_IDS,
  requiredObjectIds: [],
  catalog: RULES_LAB_TOME_CATALOG,
  createWorld: createTomeWorld,
};

export const RULES_LAB_FAMILIAR_SESSION_CONFIG: RulesLabScenarioSessionConfig = {
  worldId: 'rules-lab:dnd-2024:familiar-v1',
  ruleset: RULES_LAB_RULESET,
  playerActorIds: RULES_LAB_FAMILIAR_ACTOR_IDS,
  requiredObjectIds: [],
  catalog: RULES_LAB_FAMILIAR_CATALOG,
  createWorld: createFamiliarWorld,
};

export interface RulesLabDependencies {
  open: () => Promise<RulesLabSessionHandle>;
  reset: () => Promise<void>;
}

export interface RulesLabSessionAdapter {
  open: (scenario: RulesLabScenarioSessionConfig) => Promise<RulesLabSessionHandle>;
  reset: (scenario: RulesLabScenarioSessionConfig) => Promise<void>;
}

/**
 * Restores the deterministic browser RNG cursor from every persisted engine
 * roll. Damage/healing formulas consume the same queue as d20 rolls, so
 * counting only saves/checks would make a reload diverge from an uninterrupted
 * offline session.
 */
export function rulesLabRandomDrawCount(events: readonly UncommittedRuleEvent[]): number {
  return events.reduce((total, entry) => {
    if (entry.payload.type === 'DecisionRecorded'
      && entry.payload.response.kind === 'roll'
      && entry.payload.response.roll.mode === 'manual') {
      // Manual dice are journaled as a normal roll but never touch env.rng.
      return total - entry.payload.response.roll.dice.length;
    }
    if (entry.payload.type !== 'EngineEventRecorded') return total;
    const event = entry.payload.event;
    if (event.type === 'roll') return total + event.roll.dice.length;
    if (event.type === 'damage' || event.type === 'healing' || event.type === 'damage_reduction') {
      return total + (event.roll?.dice.length ?? 0);
    }
    return total;
  }, 0);
}

export function assertRulesLabScenarioWorld(
  world: WorldState,
  scenario: RulesLabScenarioSessionConfig,
): void {
  if (world.id !== scenario.worldId) {
    throw new Error(`Сохранённый rules-lab имеет другой worldId (${world.id}). Сбросьте lab.`);
  }
  const configuredPlayerIds = [...scenario.playerActorIds].sort();
  if (new Set(configuredPlayerIds).size !== 2) {
    throw new Error('Rules-lab fixture должен задавать ровно двух различных игровых персонажей.');
  }
  const playerIds = Object.values(world.actors)
    .filter((actor) => actor.kind === 'playerCharacter')
    .map((actor) => actor.id)
    .sort();
  if (playerIds.length !== configuredPlayerIds.length
    || playerIds.some((id, index) => id !== configuredPlayerIds[index])) {
    throw new Error(
      `Сохранённый rules-lab несовместим с fixture: ожидаются ровно два playerCharacter (${configuredPlayerIds.join(', ')}). Сбросьте lab.`,
    );
  }

  const nonPlayers = Object.values(world.actors).filter((actor) => actor.kind !== 'playerCharacter');
  if (nonPlayers.length > 1) {
    throw new Error('Сохранённый rules-lab содержит больше одного призванного участника. Сбросьте lab.');
  }
  const familiar = nonPlayers[0];
  if (familiar) {
    const familiarState = familiar.familiarState;
    const owner = familiarState ? world.actors[familiarState.ownerActorId] : undefined;
    const summoningActionId = familiar.familiarMetadata?.summoningActionId;
    if (familiar.kind !== 'summonedActor'
      || !familiarState
      || !familiar.familiarMetadata
      || familiarState.actorId !== familiar.id
      || !owner
      || owner.kind !== 'playerCharacter'
      || !configuredPlayerIds.includes(owner.id)
      || typeof summoningActionId !== 'string'
      || !summoningActionId.trim()
      || !owner.capabilities.actionIds.includes(summoningActionId)) {
      throw new Error(
        'Сохранённый rules-lab допускает только одного канонического фамильяра, принадлежащего одному из двух playerCharacter. Сбросьте lab.',
      );
    }
  }

  if (world.ruleset.contentHash !== scenario.ruleset.contentHash) {
    throw new Error('Сохранённый rules-lab использует другую версию fixture. Сбросьте lab.');
  }
  const missingObjectId = scenario.requiredObjectIds.find((objectId) => !world.objects[objectId]);
  if (missingObjectId) {
    throw new Error(`Сохранённый rules-lab не содержит тестовый объект ${missingObjectId}. Сбросьте lab.`);
  }
}

export async function openRulesLabScenarioSession(
  scenario: RulesLabScenarioSessionConfig,
  store: RulesWorldStore,
  closeStore: () => Promise<void> = async () => undefined,
): Promise<RulesLabSessionHandle> {
  const initialWorld = scenario.createWorld();
  if (initialWorld.id !== scenario.worldId
    || initialWorld.ruleset.contentHash !== scenario.ruleset.contentHash) {
    throw new Error('Rules-lab scenario factory diverges from its declared world or ruleset identity');
  }
  const restored = await store.loadWorld(scenario.worldId);
  const restoredRows = await store.loadEvents(scenario.worldId);
  const persistedQueueDraws = rulesLabRandomDrawCount(restoredRows.map((row) => row.event));
  const rollQueue = new RulesLabRollQueue(persistedQueueDraws);
  let clock = restored?.logicalClock ?? 0;
  let fallbackIdOrdinal = 0;
  const session = await PersistentRulesSession.open({
    initialWorld,
    catalog: scenario.catalog,
    env: {
      rng: rollQueue.rng,
      clock: () => {
        clock += 1;
        return clock;
      },
      // handleCommand derives persisted IDs from commandId. This fallback stays deterministic.
      nextId: () => `${scenario.worldId}:fallback:r${restored?.revision ?? 0}:${++fallbackIdOrdinal}`,
    },
    store,
  });
  assertRulesLabScenarioWorld(session.getState(), scenario);
  const initialEvents = restoredRows.map((row) => row.event);
  let closed = false;
  return {
    session,
    rollQueue,
    initialEvents,
    close: async () => {
      if (closed) return;
      closed = true;
      await closeStore();
    },
  };
}

/** Backward-compatible baseline helper used by focused unit tests. */
export function openRulesLabSession(
  store: RulesWorldStore,
  closeStore: () => Promise<void> = async () => undefined,
): Promise<RulesLabSessionHandle> {
  return openRulesLabScenarioSession(RULES_LAB_BASELINE_SESSION_CONFIG, store, closeStore);
}

const WORLDS_STORE = 'worlds';
const GENESIS_STORE = 'world_genesis';
const EVENTS_STORE = 'events';
const WORLD_INDEX = 'by_world';

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Rules lab IndexedDB transaction aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Rules lab IndexedDB transaction failed'));
  });
}

function openRulesLabDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(RULES_LAB_DATABASE_NAME, RULES_LAB_DATABASE_SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(WORLDS_STORE)) {
        database.createObjectStore(WORLDS_STORE, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(GENESIS_STORE)) {
        database.createObjectStore(GENESIS_STORE, { keyPath: 'id' });
      }
      let events: IDBObjectStore;
      if (!database.objectStoreNames.contains(EVENTS_STORE)) {
        events = database.createObjectStore(EVENTS_STORE, { keyPath: 'key' });
      } else {
        events = request.transaction!.objectStore(EVENTS_STORE);
      }
      if (!events.indexNames.contains(WORLD_INDEX)) {
        events.createIndex(WORLD_INDEX, 'worldId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Cannot open rules lab IndexedDB'));
    request.onblocked = () => reject(new Error('Rules lab IndexedDB upgrade is blocked by another tab'));
  });
}

/** Deletes exactly one acceptance-lab world and only event rows indexed by that world. */
export async function resetRulesLabWorldById(
  worldId: string,
  factory: IDBFactory = indexedDB,
): Promise<void> {
  if (!worldId.trim()) throw new Error('Rules-lab reset requires an exact non-empty worldId');
  const database = await openRulesLabDatabase(factory);
  try {
    const transaction = database.transaction(
      [WORLDS_STORE, GENESIS_STORE, EVENTS_STORE],
      'readwrite',
    );
    const done = transactionDone(transaction);
    transaction.objectStore(WORLDS_STORE).delete(worldId);
    transaction.objectStore(GENESIS_STORE).delete(worldId);
    const events = transaction.objectStore(EVENTS_STORE);
    const cursorRequest = events.index(WORLD_INDEX).openCursor(worldId);
    await new Promise<void>((resolve, reject) => {
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          resolve();
          return;
        }
        cursor.delete();
        cursor.continue();
      };
      cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error('Cannot clear rules lab events'));
    });
    await done;
  } finally {
    database.close();
  }
}

/** Backward-compatible baseline reset. */
export function resetRulesLabWorld(factory: IDBFactory = indexedDB): Promise<void> {
  return resetRulesLabWorldById(RULES_LAB_WORLD_ID, factory);
}

export const browserRulesLabSessionAdapter: RulesLabSessionAdapter = {
  open: async (scenario) => {
    const store = new BrowserIndexedDbRulesWorldStore(
      RULES_LAB_DATABASE_NAME,
      indexedDB,
      RULES_LAB_DATABASE_SCHEMA_VERSION,
    );
    return openRulesLabScenarioSession(scenario, store, () => store.close());
  },
  reset: (scenario) => resetRulesLabWorldById(scenario.worldId),
};

/** Binds a generic adapter to one exact scenario/world boundary. */
export function rulesLabDependenciesForScenario(
  scenario: RulesLabScenarioSessionConfig,
  adapter: RulesLabSessionAdapter = browserRulesLabSessionAdapter,
): RulesLabDependencies {
  return {
    open: () => adapter.open(scenario),
    reset: () => adapter.reset(scenario),
  };
}

export const browserRulesLabDependencies = rulesLabDependenciesForScenario(
  RULES_LAB_BASELINE_SESSION_CONFIG,
);

export function rulesLabActionId(actorId: string): string | undefined {
  return actorId === 'wizard' ? WIZARD_ACTION_ID : undefined;
}

export function rulesLabAction(actorId: string): RuleActionDefinition | undefined {
  const actionId = rulesLabActionId(actorId);
  return actionId ? RULES_LAB_CATALOG.getAction(actionId) : undefined;
}
