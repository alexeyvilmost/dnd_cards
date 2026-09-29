import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIGHTER_CTX_EQUIPPED, equippedFighterState } from '../mvp/fixtures';
import { startEncounter } from './encounter';
import { executeAction } from './execute';
import { collectModifiers } from './modifiers';
import { endTurn, startTurn } from './turn';
import { rollD20 } from './roll';
import { forgeToRuntimeState, writeRulesEngineRuntimeTurnState } from '../character/runtime';
import type { ForgeCharacter } from '../character/types';
import { createWorld, type ActorState } from '../rules-core/domain';
import { foldEvents } from '../rules-core/reducer';

const data = JSON.parse(readFileSync('../scripts/content/data/item-completion-high-20260929.json','utf8'));
const mechanics = (n: number) => data[`CARD-${String(n).padStart(4,'0')}`].mechanics;
const state = () => ({ ...equippedFighterState(), hp: { current: 5, max: 30, temp: 0 } });

describe('encounter-owned item restrictions', () => {
  it.each([899,911])('activates item %s only during the current encounter and persists it across sheet reload', n => {
    const initial = state(), passives = [mechanics(n)], ctx = { character: FIGHTER_CTX_EQUIPPED, passives, rng: () => .99, selfId: 'owner' };
    const entered = startEncounter(initial, ctx).state;
    const character = { current_hp: entered.hp.current, max_hp: entered.hp.max, resources: entered.resources, max_resources: entered.maxResources,
      equipment: entered.equipment, inventory_items: [], active_effects: entered.activeEffects, turn_state: writeRulesEngineRuntimeTurnState({}, entered) } as unknown as ForgeCharacter;
    const loaded = forgeToRuntimeState(JSON.parse(JSON.stringify(character)));
    expect(loaded.encounterActive).toBe(true);
    for (const active of [false,true]) {
      const runtime = { ...loaded, encounterActive: active };
      if (n === 899) {
        const result = executeAction(runtime, { effects: [{ resolution: 'auto', who: 'self', result: [{ kind: 'healing', amount: 5 }] }] }, ctx);
        expect(result.state.hp.current).toBe(active ? 5 : 10);
      } else {
        const mods = collectModifiers(runtime, passives, { roll: 'attack', evalCtx: { state: runtime, character: FIGHTER_CTX_EQUIPPED } });
        expect(rollD20({ rng: () => .99, rules: mods.rules, target: { type: 'ac', value: 10 } }).outcome).toBe(active ? 'hit' : 'crit');
      }
    }
    const actor = { id: 'owner', kind: 'playerCharacter', name: 'Owner', ac: 10, controllerId: 'owner', character: FIGHTER_CTX_EQUIPPED, runtime: loaded, capabilities: { actionIds: [] } } as ActorState;
    const world = createWorld({ id: 'world', ruleset: { systemId: 'dnd5e-2024', releaseId: 'test', contentHash: 'test', errataVersion: '2024' }, actors: [actor] });
    const exited = foldEvents(world, [{ ordinal: 0, sourceActorId: 'owner', obligationIds: [], payload: { type: 'SceneSet', scene: { mode: 'exploration' } } }]);
    expect(exited.actors.owner.runtime.encounterActive).toBe(false);
  });
  it('blocks all first-turn capabilities from item 912, then removes them at the owner end boundary', () => {
    const ctx = { character: FIGHTER_CTX_EQUIPPED, passives: [mechanics(912)], rng: () => { throw Error('No RNG'); }, selfId: 'owner' };
    const entered = startEncounter(state(), ctx).state;
    const turnCtx = { ...FIGHTER_CTX_EQUIPPED, passives: ctx.passives, rng: ctx.rng, selfId: 'owner' };
    const first = startTurn(JSON.parse(JSON.stringify(entered)), turnCtx).state;
    for (const roll of ['movement','action','bonus_action','reaction']) expect(collectModifiers(first, [], { roll }).denied).toBe(true);
    const next = startTurn(endTurn(first, turnCtx).state, turnCtx).state;
    for (const roll of ['movement','action','bonus_action','reaction']) expect(collectModifiers(next, [], { roll }).denied).toBe(false);
    expect(startEncounter(next, ctx).state.activeEffects.length).toBeGreaterThan(0);
  });
});
