import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileMicroMvpL1Overlay,
  type CompiledMicroMvpL1Provider,
  type CompiledMicroMvpL1Root,
} from '../../canon/microMvpL1Overlay';
import {
  createLogicalClock,
  createSequentialIdFactory,
} from '../determinism';
import type { RuleActionDefinition, SpatialFacts } from '../domain';
import type { SpellGrantAccess } from '../spellcastingAccess';
import {
  createCompiledMicroMvpScenarioFixtureProvider,
  type CompiledMicroMvpScenarioActorState,
} from './compiledMicroMvpScenarioAdapter';
import { runScenario, type ScenarioSpec } from './scenario';

const WIZARD_CLASS = 'CLASS-wizard';
const FIGHTER_CLASS = 'CLASS-warrior';
const THUNDERWAVE_CARD = 'SPELL-0171';

interface PreparedThunderwave {
  root: CompiledMicroMvpL1Root;
  action: Extract<RuleActionDefinition, { kind: 'spell' }>;
  grant: SpellGrantAccess;
}

function required<T>(value: T | undefined, description: string): T {
  if (value === undefined) throw new Error(`Missing compiled scenario fixture: ${description}`);
  return value;
}

function rootForClass(
  compiled: CompiledMicroMvpL1Provider,
  classCardNumber: string,
): CompiledMicroMvpL1Root {
  return required(
    compiled.roots
      .filter((root) => root.matrixCase.klass.card_number === classCardNumber)
      .sort((left, right) => left.stableKey.localeCompare(right.stableKey))[0],
    classCardNumber,
  );
}

function preparedThunderwave(compiled: CompiledMicroMvpL1Provider): PreparedThunderwave {
  for (const root of compiled.roots
    .filter((candidate) => candidate.matrixCase.klass.card_number === WIZARD_CLASS)
    .sort((left, right) => left.stableKey.localeCompare(right.stableKey))) {
    const spell = root.assembled.spells.find((candidate) => (
      candidate.card_number === THUNDERWAVE_CARD
    ));
    if (!spell) continue;
    const action = root.rulesActions.find((candidate): candidate is Extract<
      RuleActionDefinition,
      { kind: 'spell' }
    > => (
      candidate.kind === 'spell'
        && candidate.sourceEntityIds.includes(spell.id)
        && candidate.sourceEntityIds.includes(root.matrixCase.klass.id)
    ));
    if (!action) continue;
    const grant = root.actor.spellcastingAccess?.grants.find((candidate) => (
      candidate.actionId === action.id && candidate.sourceId === WIZARD_CLASS
    ));
    if (!grant) continue;
    const prepared = root.actor.spellcastingAccess
      ?.preparedSources[grant.sourceId]
      ?.preparedActionIds.includes(action.id) === true;
    if (prepared) return { root, action, grant };
  }
  throw new Error('No real compiled Wizard root has prepared Thunderwave');
}

const enemyInArea: SpatialFacts = {
  factsSource: 'board',
  boardRevision: 1,
  distanceFt: 5,
  lineOfSight: true,
  cover: 'none',
  relation: 'enemy',
};

describe('compiled Wizard vs Fighter scenario vertical', () => {
  let compiled: CompiledMicroMvpL1Provider;
  let fighter: CompiledMicroMvpL1Root;
  let wizardSpell: PreparedThunderwave;

  beforeAll(async () => {
    compiled = await compileMicroMvpL1Overlay();
    fighter = rootForClass(compiled, FIGHTER_CLASS);
    wizardSpell = preparedThunderwave(compiled);
  }, 60_000);

  it('runs real compiled roots through turns, source-owned Thunderwave, a failed save, checkpoint, check, and replay', () => {
    const { root: wizard, action, grant } = wizardSpell;
    const fixtures = createCompiledMicroMvpScenarioFixtureProvider(compiled, {
      fixtureIds: [fighter.fixtureId, wizard.fixtureId],
    });
    const fighterHpBefore = fighter.actor.runtime.hp.current;
    const slotBefore = wizard.actor.runtime.resources.spell_slot_1;
    const damage = 5;
    const scenario: ScenarioSpec = {
      schemaVersion: 1,
      id: 'compiled.vertical.wizard-thunderwave-vs-fighter',
      ruleset: fixtures.ruleset,
      actors: {
        fighter: { fixtureId: fighter.fixtureId },
        wizard: { fixtureId: wizard.fixtureId },
      },
      initiative: ['fighter', 'wizard'],
      autoStartEncounter: false,
      rollTape: [
        { label: 'Fighter Hide check', sides: 20, value: 20 },
        { label: 'Fighter Strength check', sides: 20, value: 10 },
        { label: 'Thunderwave first damage die', sides: 8, value: 2 },
        { label: 'Thunderwave second damage die', sides: 8, value: 3 },
      ],
      steps: [
        {
          do: 'hide', actor: 'fighter',
          eligibility: {
            factsSource: 'board', boardRevision: 1, heavilyObscured: true,
            cover: 'three_quarters', visibleToAnyEnemy: false,
          },
          assertions: [
            {
              id: 'CWFS-FIGHTER-HIDE-IS-NONSPELL', type: 'event',
              match: {
                payloadType: 'ActionDeclared', sourceActorId: 'fighter', actorId: 'fighter',
                payloadSubset: { actionId: 'core.action.hide', actionKind: 'nonSpell' },
              },
              exactly: 1,
            },
            {
              id: 'CWFS-FIGHTER-HIDE-APPLIES-INVISIBLE', type: 'condition',
              actor: 'fighter', condition: 'invisible', present: true,
            },
          ],
        },
        {
          do: 'checkpointReload', assertions: [{
            id: 'CWFS-HIDDEN-CONDITION-SURVIVES-RELOAD', type: 'condition',
            actor: 'fighter', condition: 'invisible', present: true,
          }],
        },
        {
          do: 'startEncounter', actor: 'fighter', assertions: [{
            id: 'CWFS-ENCOUNTER-STARTS-WITH-BOTH-ACTORS', type: 'equals',
            path: 'scene.initiative', value: ['fighter', 'wizard'],
          }],
        },
        {
          do: 'startTurn', actor: 'fighter', assertions: [{
            id: 'CWFS-FIGHTER-IS-COMPILED', type: 'equals',
            path: 'actors.fighter.compiledSource.entities.class.cardNumber', value: FIGHTER_CLASS,
          }],
        },
        {
          do: 'abilityCheck', actor: 'fighter', ability: 'str', dc: 1, assertions: [{
            id: 'CWFS-FIGHTER-ABILITY-CHECK', type: 'event',
            match: {
              engineEventType: 'roll', actorId: 'fighter',
              includesObligationIds: ['system:ability-check'],
              roll: { kind: 'check', outcome: 'success' },
            },
            exactly: 1,
          }],
        },
        {
          do: 'endTurn', actor: 'fighter', assertions: [{
            id: 'CWFS-FIGHTER-ENDS-TURN', type: 'event', eventType: 'turn_ended', exactly: 1,
          }],
        },
        {
          do: 'startTurn', actor: 'wizard', assertions: [{
            id: 'CWFS-WIZARD-IS-COMPILED', type: 'equals',
            path: 'actors.wizard.compiledSource.stableKey', value: wizard.stableKey,
          }],
        },
        {
          do: 'use', actor: 'wizard', actionId: action.id, actionKind: 'spell',
          targets: ['fighter'],
          factsByTarget: { fighter: enemyInArea },
          spell: { baseLevel: 1, grantId: grant.grantId, mode: 'normal' },
          worldInput: { type: 'area_objects', factsByObject: {} },
          assertions: [
            {
              id: 'CWFS-THUNDERWAVE-OPENS-SAVE', type: 'pending', pendingType: 'target_save',
            },
            {
              id: 'CWFS-THUNDERWAVE-SPENDS-SOURCE-SLOT', type: 'equals',
              path: 'actors.wizard.runtime.resources.spell_slot_1', value: slotBefore - 1,
            },
            {
              id: 'CWFS-THUNDERWAVE-SPENDS-ACTION', type: 'equals',
              path: 'actors.wizard.runtime.resources.action', value: 0,
            },
            {
              id: 'CWFS-THUNDERWAVE-SOURCE-PROVENANCE', type: 'event',
              match: {
                payloadType: 'ActionDeclared', sourceActorId: 'wizard', actorId: 'wizard',
                targetIds: ['fighter'],
                payloadSubset: {
                  actionId: action.id,
                  actionKind: 'spell',
                  spell: {
                    baseLevel: 1,
                    castLevel: 1,
                    grantId: grant.grantId,
                    sourceId: grant.sourceId,
                    spellcastingAbility: grant.spellcastingAbility,
                    mode: 'normal',
                    payment: { kind: 'slot', resource: 'spell_slot_1' },
                  },
                },
              },
              exactly: 1,
            },
            {
              id: 'CWFS-THUNDERWAVE-ONE-SLOT-EVENT', type: 'event',
              match: {
                engineEventType: 'resource_spent', actorId: 'wizard',
                payloadSubset: {
                  event: {
                    type: 'resource_spent', resource: 'spell_slot_1', amount: 1,
                    remaining: slotBefore - 1,
                  },
                },
              },
              exactly: 1,
            },
          ],
        },
        {
          do: 'checkpointReload', assertions: [
            {
              id: 'CWFS-CHECKPOINT-PRESERVES-SAVE', type: 'pending', pendingType: 'target_save',
            },
            {
              id: 'CWFS-CHECKPOINT-PRESERVES-GRANT', type: 'equals',
              path: 'pendingResolution.spell.grantId', value: grant.grantId,
            },
            {
              id: 'CWFS-CHECKPOINT-PRESERVES-PAYMENT', type: 'equals',
              path: 'pendingResolution.spell.payment.resource', value: 'spell_slot_1',
            },
          ],
        },
        {
          do: 'resolveDecision', actor: 'fighter',
          roll: { mode: 'manual', dice: [{ sides: 20, value: 1 }] },
          assertions: [
            {
              id: 'CWFS-FIGHTER-FAILS-CON-SAVE', type: 'event',
              match: {
                engineEventType: 'roll', actorId: 'fighter',
                includesObligationIds: [`entity:${action.id}`, 'system:target-save'],
                roll: { kind: 'save', outcome: 'fail' },
              },
              exactly: 1,
            },
            {
              id: 'CWFS-THUNDERWAVE-DEALS-2D8', type: 'equals',
              path: 'actors.fighter.runtime.hp.current', value: fighterHpBefore - damage,
            },
            {
              id: 'CWFS-THUNDERWAVE-DAMAGE-EVENT', type: 'event',
              match: {
                engineEventType: 'damage', targetIds: ['fighter'],
                payloadSubset: {
                  event: { type: 'damage', amount: damage, damageType: 'thunder' },
                },
              },
              exactly: 1,
            },
          ],
        },
        {
          do: 'endTurn', actor: 'wizard', assertions: [{
            id: 'CWFS-WIZARD-ENDS-TURN', type: 'event', eventType: 'turn_ended', exactly: 1,
          }],
        },
      ],
      requiredTrace: [
        'nonSpellAction', 'castSpell', 'applyCondition', 'savingThrow', 'abilityCheck',
      ],
    };

    const run = runScenario(scenario, fixtures, {
      clock: createLogicalClock(70_000),
      nextId: createSequentialIdFactory('compiled-wizard-fighter'),
    });

    expect(run.rejections).toEqual([]);
    expect(run.rngConsumed).toBe(4);
    expect(run.checkpoints).toHaveLength(2);
    expect(run.observedTrace).toEqual([
      'abilityCheck', 'applyCondition', 'castSpell', 'nonSpellAction', 'savingThrow',
    ]);
    expect(run.finalState).toEqual(run.replayState);
    expect((run.finalState.actors.fighter as CompiledMicroMvpScenarioActorState)
      .compiledSource.stableKey).toBe(fighter.stableKey);
    expect((run.finalState.actors.wizard as CompiledMicroMvpScenarioActorState)
      .compiledSource.stableKey).toBe(wizard.stableKey);
  });
});
