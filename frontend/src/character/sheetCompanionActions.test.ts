import { describe, expect, it } from 'vitest';
import { createLogicalClock, createSequentialIdFactory } from '../rules-core/determinism';
import { createWorld, type GameCommand, type RuleActionDefinition, type RulesCatalog } from '../rules-core/domain';
import { InMemoryRulesSession } from '../rules-core/session';
import {
  FIND_FAMILIAR_CAST_PATH_CHOICE,
  FIND_FAMILIAR_FORM_CHOICE,
  FIND_FAMILIAR_SPIRIT_CHOICE,
} from '../rules-core/familiarRuntime';
import {
  RULES_LAB_FAMILIAR_ACTOR_IDS,
  RULES_LAB_FAMILIAR_SESSION_CONFIG,
  RULES_LAB_PACT_EXECUTION,
  RULES_LAB_TOME_ACTOR_IDS,
  RULES_LAB_TOME_SESSION_CONFIG,
} from '../pages/rulesLabFixture';
import {
  buildDismissFamiliarCommand,
  buildPactTomeRestCommand,
  buildReappearFamiliarCommand,
  collectSheetCompanionControls,
  executeSheetCompanionCommand,
  SHEET_COMPANION_ONLINE_AUTHORITY_REASON,
  SheetCompanionActionError,
} from './sheetCompanionActions';
import type { SheetCanonicalRuntime } from './sheetCanonicalWorld';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function runtime(input: {
  actorId: string;
  world: ReturnType<typeof createWorld>;
  catalog: RulesCatalog;
  pactTomeSelection?: SheetCanonicalRuntime['pactTomeSelection'];
}): SheetCanonicalRuntime {
  return {
    actorId: input.actorId,
    world: input.world,
    catalog: input.catalog,
    actions: input.catalog.listActions?.() ?? [],
    cards: [],
    resourceBindings: {},
    ...(input.pactTomeSelection ? { pactTomeSelection: input.pactTomeSelection } : {}),
    actionFor: () => { throw new Error('not used by companion bridge'); },
  };
}

function summonBaseFamiliar() {
  const initial = RULES_LAB_FAMILIAR_SESSION_CONFIG.createWorld();
  const actorId = RULES_LAB_FAMILIAR_ACTOR_IDS[0];
  const actionId = RULES_LAB_PACT_EXECUTION.familiar.findFamiliarActionId;
  const action = RULES_LAB_FAMILIAR_SESSION_CONFIG.catalog.getAction(actionId)!;
  const session = new InMemoryRulesSession(initial, RULES_LAB_FAMILIAR_SESSION_CONFIG.catalog, {
    rng: () => 0.5,
    clock: createLogicalClock(initial.logicalClock),
    nextId: createSequentialIdFactory('sheet-companion-familiar'),
  });
  const command: GameCommand = {
    schemaVersion: 1,
    type: 'UseAction',
    commandId: 'summon-familiar',
    expectedRevision: initial.revision,
    rulesetContentHash: initial.ruleset.contentHash,
    actorId,
    actionId,
    targetIds: [],
    spell: {
      baseLevel: 1,
      grantId: RULES_LAB_PACT_EXECUTION.familiar.findFamiliarGrantId,
      mode: 'ritual',
    },
    choices: {
      [FIND_FAMILIAR_FORM_CHOICE]: 'owl',
      [FIND_FAMILIAR_SPIRIT_CHOICE]: 'fey',
      [FIND_FAMILIAR_CAST_PATH_CHOICE]: 'ritual',
    },
  };
  expect(session.dispatch(command).status).toBe('accepted');
  const world = clone(session.getState());
  world.actors[actorId].runtime.resources.action = 1;
  return { world, actorId, action };
}

describe('data-owned CharacterV3 companion controls', () => {
  it('derives one familiar and persists temporary dismissal/reappearance through rules-core', () => {
    const summoned = summonBaseFamiliar();
    const canonical = runtime({
      actorId: summoned.actorId,
      world: summoned.world,
      catalog: RULES_LAB_FAMILIAR_SESSION_CONFIG.catalog,
    });
    const model = collectSheetCompanionControls({ runtime: canonical });
    expect(model.familiar).toMatchObject({
      presence: 'present', extension: 'base', reactionAvailable: true,
    });

    const dismissed = executeSheetCompanionCommand({
      runtime: canonical,
      command: buildDismissFamiliarCommand({
        runtime: canonical,
        commandId: 'dismiss-temporary',
        mode: 'temporary',
      }),
      rng: () => 0.5,
    });
    const familiarId = model.familiar!.actorId;
    expect(dismissed.world.actors[familiarId].familiarState?.presence).toBe('pocket_dimension');
    expect(dismissed.world.actors[summoned.actorId].runtime.resources.action).toBe(0);

    dismissed.world.actors[summoned.actorId].runtime.resources.action = 1;
    const afterDismiss = runtime({
      actorId: summoned.actorId,
      world: clone(dismissed.world),
      catalog: canonical.catalog,
    });
    const reappeared = executeSheetCompanionCommand({
      runtime: afterDismiss,
      command: buildReappearFamiliarCommand({
        runtime: afterDismiss,
        commandId: 'reappear',
        facts: {
          factsSource: 'scenario', boardRevision: dismissed.world.revision,
          distanceFt: 10, lineOfSight: true, unoccupiedSpace: true,
        },
      }),
      rng: () => 0.5,
    });
    expect(reappeared.world.actors[familiarId].familiarState?.presence).toBe('present');
    expect(reappeared.events.some((event) => (
      event.payload.type === 'FamiliarStateChanged'
        && event.payload.reason === 'reappeared'
    ))).toBe(true);
  });

  it('fails closed for the online encounter authority gap before building or paying', () => {
    const summoned = summonBaseFamiliar();
    const canonical = runtime({
      actorId: summoned.actorId,
      world: summoned.world,
      catalog: RULES_LAB_FAMILIAR_SESSION_CONFIG.catalog,
    });
    expect(collectSheetCompanionControls({
      runtime: canonical,
      onlineEncounterId: 'encounter:online',
    }).blockedReason).toBe(SHEET_COMPANION_ONLINE_AUTHORITY_REASON);
    expect(() => buildDismissFamiliarCommand({
      runtime: canonical,
      onlineEncounterId: 'encounter:online',
      commandId: 'forbidden',
      mode: 'temporary',
    })).toThrowError(SheetCompanionActionError);
    expect(summoned.world.actors[summoned.actorId].runtime.resources.action).toBe(1);
  });

  it('replaces Pact Tome from the exact compiled five-spell selection on a declared rest', () => {
    const world = RULES_LAB_TOME_SESSION_CONFIG.createWorld();
    const actorId = RULES_LAB_TOME_ACTOR_IDS[0];
    const state = world.actors[actorId].warlockPacts?.tome?.tome;
    if (!state) throw new Error('Generated Tome fixture has no active selection');
    const canonical = runtime({
      actorId,
      world,
      catalog: RULES_LAB_TOME_SESSION_CONFIG.catalog,
      pactTomeSelection: {
        sourceEntityId: state.sourceEntityId,
        cantripActionIds: [...state.cantripActionIds],
        ritualActionIds: [...state.ritualActionIds],
      },
    });
    const command = buildPactTomeRestCommand({
      runtime: canonical,
      commandId: 'replace-tome',
      rest: 'long',
      bookObjectId: 'sheet:tome:replacement',
    });
    expect(command).toMatchObject({
      type: 'TakeLongRest',
      pactTome: {
        bookObjectId: 'sheet:tome:replacement',
        cantripActionIds: [...state.cantripActionIds],
        ritualActionIds: [...state.ritualActionIds],
      },
    });
    const result = executeSheetCompanionCommand({ runtime: canonical, command, rng: () => 0.5 });
    expect(result.world.actors[actorId].warlockPacts?.tome?.tome.bookObjectId)
      .toBe('sheet:tome:replacement');
    expect(result.world.objects[state.bookObjectId]).toBeUndefined();
    expect(result.world.objects['sheet:tome:replacement']).toBeDefined();
  });

  it('recognizes Touch only from compiled requiresTouch, not a localized range label', () => {
    const summoned = summonBaseFamiliar();
    const displayOnly = {
      ...clone(summoned.action),
      id: 'spell:display-only-touch',
      mechanics: { ...clone(summoned.action.mechanics), targeting: { range: 'Касание' } },
      targeting: { ...summoned.action.targeting!, rangeFt: 5 },
    } as RuleActionDefinition;
    const explicit = {
      ...displayOnly,
      id: 'spell:explicit-touch',
      targeting: { ...displayOnly.targeting!, requiresTouch: true as const },
    } as RuleActionDefinition;
    const byId = new Map([displayOnly, explicit].map((action) => [action.id, action]));
    const catalog: RulesCatalog = {
      getAction: (id) => byId.get(id),
      listActions: () => [...byId.values()],
    };
    const actor = summoned.world.actors[summoned.actorId];
    actor.capabilities.actionIds.push(displayOnly.id, explicit.id);
    actor.spellcastingAccess!.grants.push({
      grantId: 'grant:explicit-touch', actionId: explicit.id, sourceId: explicit.sourceEntityIds[0],
      access: 'cantrip', level: 0, spellcastingAbility: 'int',
    });
    const model = collectSheetCompanionControls({
      runtime: runtime({ actorId: summoned.actorId, world: summoned.world, catalog }),
    });
    expect(model.touchSpells.map(({ action }) => action.id)).toEqual([explicit.id]);
  });
});
