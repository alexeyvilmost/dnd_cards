import {describe, expect, it} from 'vitest';
import {availableCombatSpellLevels} from './spellCastChoices';
import type {ActorState, RuleActionDefinition} from '../rules-core/domain';
import {FIGHTER_CTX_EQUIPPED, freshFighterState} from '../mvp/fixtures';

describe('level choices for ordinary and triggered spells', () => {
  it.each(['ordinary', 'triggered'])('lists only payable levels for %s without spending anything', mode => {
    const action = {id: mode, name: mode, kind: 'spell', spell: {level: 1}, sourceEntityIds: [mode],
      mechanics: {activation: {mode: mode === 'ordinary' ? 'active' : 'triggered'}}} as RuleActionDefinition;
    const runtime = freshFighterState();
    runtime.resources = {...runtime.resources, spell_slot_1: 0, spell_slot_2: 1, spell_slot_3: 0};
    const actor = {id: 'owner', character: FIGHTER_CTX_EQUIPPED, runtime,
      spellcastingAccess: {preparedSources: {}, grants: [{grantId: 'grant', actionId: mode, sourceId: 'source',
        access: 'known', level: 1, spellcastingAbility: 'cha', slotResource: 'spell_slot_1'}]}} as ActorState;
    const saved = JSON.stringify(actor);
    expect(availableCombatSpellLevels(actor, action)).toEqual([2]);
    expect(JSON.stringify(actor)).toBe(saved);
    actor.spellcastingAccess!.grants[0].freeUseResource = 'free';
    actor.runtime.resources.free = 1;
    expect(availableCombatSpellLevels(actor, action)).toEqual([1, 2]);
  });
});
