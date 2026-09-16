import {describe, expect, it} from 'vitest';
import fixtureJson from './pinnedFighter.fixture.json';
import {initializeRoguelikeCombat, projectRoguelikeCombatPatch, projectRoguelikePartyCombatPatch, type RoguelikeCombatInitialization} from './combatInitialization';

const artifactHash = `sha256:${'a'.repeat(64)}`;
function input(): RoguelikeCombatInitialization {
  const pinned = structuredClone(fixtureJson) as unknown as Pick<RoguelikeCombatInitialization, 'character' | 'catalog' | 'basicActionIds'>;
  return {...pinned, seed: 'initialization-replay', roster: [{monster_id: 'test-monster', quantity: 1}],
    monsters: {version: 1, effects: [], actions: [{id: 'test-attack', name: 'Slam', mechanics: {
      activation: {mode: 'active', cost: [{resource: 'action', amount: 1}]},
      targeting: {domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1,
        range_ft: 5, requires_line_of_sight: true, allowed_relations: ['enemy']},
      effects: [{resolution: 'attack_roll', ability: 'str', attack_kind: 'weapon_melee',
        attack_bonus_override: 4, vs: 'ac', on_hit: [{kind: 'damage', amount: 3, type: 'bludgeoning'}]}],
    }}] as unknown as RoguelikeCombatInitialization['monsters']['actions'],
    monsters: [{id: 'test-monster', slug: 'test', name: 'Enemy', size: 'medium', creature_type: 'humanoid',
      armor_class: 10, max_hp: 10, speed: 30, initiative_bonus: 0, proficiency_bonus: 2,
      abilities: {str: 14, dex: 10, con: 10, int: 10, wis: 10, cha: 10},
      action_ids: ['test-attack'], effect_ids: [], ai: {strategy: 'tactical'}}] as unknown as RoguelikeCombatInitialization['monsters']['monsters']}};
}
describe('trusted combat initialization', () => {
  it('requests missing content for the entire party in the same pass',async()=>{
    const request=input();
    const ally=structuredClone(request.character);ally.id='qa:ally';ally.feat_ids=[...(ally.feat_ids??[]),'missing-ally-feat'];
    request.characters=[request.character,ally];request.character.feat_ids=[...(request.character.feat_ids??[]),'missing-owner-feat'];
    const result=await initializeRoguelikeCombat(request,artifactHash);
    expect(result.status).toBe('needs_content');if(result.status!=='needs_content')return;
    expect(result.needs).toEqual(expect.arrayContaining([
      expect.objectContaining({reference:'missing-ally-feat'}),expect.objectContaining({reference:'missing-owner-feat'}),
    ]));
  });
  it('projects six participants with one combat snapshot and preserves their revisions on replay',async()=>{
    const request=input();request.characters=Array.from({length:6},(_,i)=>({...structuredClone(request.character),id:i===0?request.character.id:`qa:ally-${i}`}));request.mapIndex=1;
    const result=await initializeRoguelikeCombat(request,artifactHash);if(result.status!=='ready')throw Error('Missing fixture');
    const projected=projectRoguelikePartyCombatPatch(result.envelope,request.characters);
    expect(Object.keys(projected.patches)).toHaveLength(6);
    for(const c of request.characters){
      expect(projected.patches[c.id].runtime_revision).toBe(Number(c.runtime_revision)+1);
      expect(!!projected.patches[c.id].turn_state.solo_combat_v1).toBe(c.id===request.character.id);
    }
    expect(()=>projectRoguelikePartyCombatPatch(result.envelope,request.characters!.slice(1))).toThrow();
  });
  it('replays setup and projects only runtime fields without mutating its inputs', async () => {
    const request = input();
    const before = structuredClone(request);
    const first = await initializeRoguelikeCombat(request, artifactHash);
    expect(first).toEqual(await initializeRoguelikeCombat(request, artifactHash));
    expect(request).toEqual(before);
    if (first.status !== 'ready') throw Error('unexpected missing content');
    expect(first.envelope.entropy.cursor).toBe(first.randomValues.length);
    expect(first.envelope.state.dashActionId).toBeTruthy();
    const original = structuredClone(first.envelope);
    const projected = projectRoguelikeCombatPatch(first.envelope, request.character);
    expect(first.envelope).toEqual(original);
    expect(projected.patch.runtime_revision).toBe(Number(request.character.runtime_revision) + 1);
    expect(projected.patch).not.toHaveProperty('gold');
    expect(projected.patch).not.toHaveProperty('experience');
    expect(projected.patch.current_hp).toBe(first.envelope.state.world.actors[request.character.id].runtime.hp.current);
    expect(projected.envelope.state.runtimeRevision).toBe(projected.patch.runtime_revision);
  });
  it('rejects an oversized roster before compiling content', async () => {
    const request = input();
    request.roster[0].quantity = 9;
    await expect(initializeRoguelikeCombat(request, artifactHash)).rejects.toThrow();
  });
  it('returns missing content instead of starting a partial fighter', async () => {
    const request = input();
    request.catalog.entities.class = [];
    const result = await initializeRoguelikeCombat(request, artifactHash);
    expect(result.status).toBe('needs_content');
    expect(result).not.toHaveProperty('envelope');
  });
});
