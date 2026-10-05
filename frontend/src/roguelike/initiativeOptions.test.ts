import {describe, expect, it, vi} from 'vitest';
import fixtureJson from './testing/currentPinnedFixture';
import {prepareInitiativeOptions} from './initiativeOptions';
import {initializeRoguelikeCombat, type RoguelikeCombatInitialization} from './combatInitialization';

function input(resource: string, faces: number): RoguelikeCombatInitialization {
  const base = structuredClone(fixtureJson) as unknown as Pick<RoguelikeCombatInitialization, 'character' | 'catalog' | 'basicActionIds'>;
  const action = {...base.catalog.entities.action[0], id: 'ad940000-0000-4000-8000-000000000001',
    card_number: 'QA-initiative-owned', name: resource, type: 'class_feature', mechanics: {
      activation: {mode: 'triggered', cost: [{resource}], trigger: {events: ['initiative_roll'], requires_not_incapacitated: true}},
      targeting: {domain: 'actor', actor_targets: false, shape: 'self', min_targets: 1, max_targets: 1, range_ft: 0,
        requires_line_of_sight: false, allowed_relations: ['self']},
      effects: [{resolution: 'auto', result: [{kind: 'modifier', op: 'bonus_die', faces, sign: 1, consume: 'next',
        applies_to: {roll: 'd20'}, duration: {type: 'until_end_of_turn'}, source: resource}]}],
    }} as typeof base.catalog.entities.action[number];
  base.catalog.entities.action.push(action, {...structuredClone(action),
    id: 'ad940000-0000-4000-8000-000000000002', card_number: 'QA-initiative-unowned'});
  const card = {...structuredClone(base.catalog.entities.card[0]),
    id: 'ad940000-0000-4000-8000-000000000003', card_number: 'QA-initiative-item',
    type: 'ring', slot: 'ring', requires_attunement: false, mechanics: {
      activation: {mode: 'passive', while: 'equipped'}, effects: [{resolution: 'auto', result: [
        {kind: 'resource', op: 'grant', id: resource, amount: 2}, {kind: 'grant_action', value: action.card_number},
      ]}],
    }} as typeof base.catalog.entities.card[number];
  base.catalog.entities.card.push(card);
  base.character.equipment = {...base.character.equipment, ring_1: card.id};
  base.character.resources = {...base.character.resources, [resource]: 2};
  base.character.max_resources = {...base.character.max_resources, [resource]: 2};
  base.character.initiative_bonus = 100;
  return {...base, seed: 'initiative-options-equivalence', roster: [{monster_id: 'qa:idle', quantity: 1}],
    monsters: {version: 1, effects: [], actions: [], monsters: [{id: 'qa:idle', slug: 'qa-idle', name: 'Idle enemy',
      size: 'medium', creature_type: 'construct', armor_class: 10, max_hp: 10, speed: 0, initiative_bonus: -100,
      proficiency_bonus: 2, abilities: {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10},
      action_ids: [], effect_ids: [], ai: {strategy: 'hold'}} as unknown as RoguelikeCombatInitialization['monsters']['monsters'][number]]}};
}

describe('read-only initiative offers and authoritative initialize', () => {
  it.each([{resource: 'initiative_alpha', faces: 4}, {resource: 'initiative_beta', faces: 6}])(
    'does not roll/pay $resource while listing, then uses the same seeded initialize and rechecks exhausted cost', async ({resource, faces}) => {
      const request = input(resource, faces), snapshot = structuredClone(request);
      const random = vi.spyOn(Math, 'random').mockImplementation(() => {throw Error('Options must not roll');});
      let offer: Awaited<ReturnType<typeof prepareInitiativeOptions>>;
      try {
        offer = await prepareInitiativeOptions(request);
        expect(await prepareInitiativeOptions(request)).toEqual(offer);
        expect(random).not.toHaveBeenCalled();
      } finally {random.mockRestore();}
      expect(request).toEqual(snapshot);
      if (offer!.status !== 'ready') throw Error('Incomplete offer fixture');
      expect(offer!.initiativeOptions.map(row => row.id)).toEqual(['ad940000-0000-4000-8000-000000000001']);
      const selected = {...request, initiativeManeuverActionId: offer!.initiativeOptions[0].id};
      const artifact = `sha256:${'a'.repeat(64)}`;
      const accepted = await initializeRoguelikeCombat(selected, artifact);
      if (accepted.status !== 'ready') throw Error('Incomplete initialize fixture');
      expect(accepted.combatOpeningState.world.actors[request.character.id].runtime.resources[resource]).toBe(1);
      expect(accepted.envelope.entropy.cursor).toBe(accepted.randomValues.length);
      expect(await initializeRoguelikeCombat({...structuredClone(snapshot), initiativeManeuverActionId: selected.initiativeManeuverActionId}, artifact)).toEqual(accepted);
      expect(request).toEqual(snapshot);
      request.character.resources![resource] = 0;
      const exhausted = await prepareInitiativeOptions(request);
      expect(exhausted.status).toBe('ready');
      if (exhausted.status === 'ready') expect(exhausted.initiativeOptions).toEqual([]);
      await expect(initializeRoguelikeCombat({...request, initiativeManeuverActionId: selected.initiativeManeuverActionId}, artifact)).rejects.toThrow('недоступен');
      await expect(initializeRoguelikeCombat({...snapshot, initiativeManeuverActionId: 'ad940000-0000-4000-8000-000000000002'}, artifact)).rejects.toThrow('недоступен');
    },
  );
});
