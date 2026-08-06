import { beforeAll, describe, expect, it } from 'vitest';
import {
  collectActionUsesPools,
  collectActionUsesRecharge,
  collectActionUsesRecovery,
} from '../character/actionSheet';
import { compileMicroMvpL1Overlay, type CompiledMicroMvpL1Root } from '../canon/microMvpL1Overlay';
import { createLogicalClock, createSequentialIdFactory } from '../rules-core/determinism';
import { createWorld } from '../rules-core/domain';
import { foldEvents } from '../rules-core/reducer';
import { InMemoryRulesSession } from '../rules-core/session';
import { actionUsesKey } from './actionUses';
import { longRest, shortRest } from './turn';

const SECOND_WIND_CARD = 'ACT-second-wind';
const SECOND_WIND_USES_KEY = actionUsesKey(SECOND_WIND_CARD);

let fighter: CompiledMicroMvpL1Root;
let otherActor: CompiledMicroMvpL1Root;
let ruleset: Awaited<ReturnType<typeof compileMicroMvpL1Overlay>>['ruleset'];

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('Second Wind recovery from the pinned production root', () => {
  beforeAll(async () => {
    const provider = await compileMicroMvpL1Overlay();
    const root = provider.roots.find((candidate) => (
      candidate.matrixCase.klass.card_number === 'CLASS-warrior'
    ));
    if (!root) throw new Error('Pinned production Fighter L1 root is missing');
    fighter = root;
    const other = provider.roots.find((candidate) => candidate.fixtureId !== root.fixtureId);
    if (!other) throw new Error('Pinned production two-actor fixture is missing');
    otherActor = other;
    ruleset = provider.ruleset;
  });

  it('carries the exact action identity into the virtual uses pool and rest execution', () => {
    const source = fighter.assembled.actions.find(({ action }) => (
      action.card_number === SECOND_WIND_CARD
    ))?.action;
    expect(source).toMatchObject({
      card_number: SECOND_WIND_CARD,
      mechanics: {
        uses: {
          count: 2,
          per: 'short_rest',
          recovery: {
            short_rest: { mode: 'fixed', amount: 1 },
            long_rest: { mode: 'full' },
          },
        },
      },
    });

    const pool = collectActionUsesPools(fighter.assembled).find(({ key }) => (
      key === SECOND_WIND_USES_KEY
    ));
    expect(pool).toMatchObject({
      key: SECOND_WIND_USES_KEY,
      count: 2,
      per: 'short_rest',
      recovery: {
        short_rest: { mode: 'fixed', amount: 1 },
        long_rest: { mode: 'full' },
      },
    });

    const recharge = collectActionUsesRecharge(fighter.assembled);
    const recovery = collectActionUsesRecovery(fighter.assembled);
    expect(recharge[SECOND_WIND_USES_KEY]).toBe('short_rest');
    expect(recovery[SECOND_WIND_USES_KEY]).toEqual({
      short_rest: { mode: 'fixed', amount: 1 },
      long_rest: { mode: 'full' },
    });

    const depleted = copy(fighter.actor.runtime);
    depleted.resources[SECOND_WIND_USES_KEY] = 0;
    const context = {
      ...fighter.actor.character,
      resourceRecharge: recharge,
      resourceRecovery: recovery,
    };
    const afterFirstShortRest = shortRest(depleted, context).state;
    const afterSecondShortRest = shortRest(afterFirstShortRest, context).state;
    const afterLongRest = longRest(depleted, context).state;

    expect(afterFirstShortRest.resources[SECOND_WIND_USES_KEY]).toBe(1);
    expect(afterSecondShortRest.resources[SECOND_WIND_USES_KEY]).toBe(2);
    expect(afterLongRest.resources[SECOND_WIND_USES_KEY]).toBe(2);
  });

  it('persists one-use recovery through the canonical command/event/replay boundary', () => {
    const depletedFighter = copy(fighter.actor);
    depletedFighter.runtime.resources[SECOND_WIND_USES_KEY] = 0;
    const initial = createWorld({
      id: 'second-wind-rest-world',
      ruleset,
      actors: [depletedFighter, copy(otherActor.actor)],
    });
    const session = new InMemoryRulesSession(initial, { getAction: () => undefined }, {
      rng: () => { throw new Error('Second Wind recovery must not consume RNG'); },
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('second-wind-event'),
    });

    const first = session.dispatch({
      schemaVersion: 1,
      type: 'TakeShortRest',
      commandId: 'second-wind-short-rest-1',
      expectedRevision: 0,
      rulesetContentHash: ruleset.contentHash,
      actorId: depletedFighter.id,
    });
    expect(first.status).toBe('accepted');
    expect(session.getState().actors[depletedFighter.id]
      .runtime.resources[SECOND_WIND_USES_KEY]).toBe(1);
    expect(session.getEvents()).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        type: 'EngineEventRecorded',
        event: {
          type: 'resource_restored',
          resource: SECOND_WIND_USES_KEY,
          amount: 1,
          current: 1,
        },
      }),
    }));

    const second = session.dispatch({
      schemaVersion: 1,
      type: 'TakeShortRest',
      commandId: 'second-wind-short-rest-2',
      expectedRevision: 1,
      rulesetContentHash: ruleset.contentHash,
      actorId: depletedFighter.id,
    });
    expect(second.status).toBe('accepted');
    expect(session.getState().actors[depletedFighter.id]
      .runtime.resources[SECOND_WIND_USES_KEY]).toBe(2);
    expect(foldEvents(initial, session.getEvents())).toEqual(session.getState());
  });
});
