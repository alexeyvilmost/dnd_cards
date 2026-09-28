import {describe,it,expect} from 'vitest';
import fixture from './pinnedFighter.fixture.json';
import type {ForgeCharacter} from '../character/types';
import type {FrozenCombatCatalog} from './combatCatalog';
import {executeJourneyCheck,executeJourneyEffect} from './journeyWorker';
import definitions from '../../../backend/roguelikecontent/urvin.json';

function input(){return {...structuredClone(fixture) as unknown as {character:ForgeCharacter;catalog:FrozenCombatCatalog},seed:'journey-test',commandId:'event:1',check:{ability:'dex' as const,skill:'stealth',dc:12}};}
describe('persistable canonical journey checks',()=>{
  it.each([false,true])('resolves an optional after-failure boost (use=%s) without rerolling the d20',async use=>{
    const request=input();request.check.dc=100;request.character.resources={...request.character.resources,'uses_ACT-second-wind':2};
    const action=request.catalog.entities.action.find(a=>a.name==='Тактический ум')!;
    action.mechanics={...action.mechanics,activation:{mode:'triggered',trigger:{events:['ability_check_failed']},cost:[{resource:'uses_ACT-second-wind'}]}};
    const held=await executeJourneyCheck(request);if(held.status!=='ready')throw Error('fixture');
    const boost=await executeJourneyCheck({...request,envelope:held.envelope,resolve:true,commandId:'boost'});
    if(boost.status!=='ready')throw Error('fixture');expect(boost.public.phase).toBe('boost');expect(boost.public.influences).toHaveLength(1);
    const done=await executeJourneyCheck({...request,envelope:JSON.parse(JSON.stringify(boost.envelope)),resolve:true,commandId:'finish',effectId:use?boost.public.influences[0].id:''});
    if(done.status!=='ready')throw Error('fixture');expect(done.public.phase).toBe('resolved');
    expect(done.public.roll.dice.filter(d=>d.sides===20)).toEqual(held.public.roll.dice.filter(d=>d.sides===20));
    expect(done.envelope.after.pendingResolution).toBeNull();
  });
  it('applies a shared survival aura to event damage and clears it from every party member',async()=>{
    const request=input(),ally=structuredClone(request.character);ally.id='20000000-0000-4000-8000-000000000099';
    const aura=definitions.auras.find(a=>a.key==='phoenix')!;
    request.character.current_hp=1;ally.current_hp=0;
    for(const c of [request.character,ally])c.active_effects=[{id:aura.id,name:aura.name,source:aura.name,mechanics:aura.mechanics}];
    const result=await executeJourneyEffect({...request,characters:[request.character,ally],hazard:{id:'fall',name:'Падение',sourceKind:'environment',sourceEntityIds:['bridge'],resolution:'automatic',effects:[{kind:'damage',dice:'1',type:'bludgeoning'}]}});
    if(result.status!=='ready')throw Error('fixture');
    expect(result.patch.current_hp).toBe(1);
    expect(Object.values(result.patches).every(p=>!p.active_effects.some(e=>e.id===aura.id))).toBe(true);
  });
  it('holds the original result without applying it, restores from JSON and commits once',async()=>{
    const request=input(),before=structuredClone(request);
    const held=await executeJourneyCheck(request);if(held.status!=='ready')throw Error('fixture incomplete');
    expect(held.patch).toBeUndefined();expect(held.public.phase).toBe('influence');expect(request).toEqual(before);
    expect(await executeJourneyCheck(request)).toEqual(held);
    const accepted=await executeJourneyCheck({...request,envelope:JSON.parse(JSON.stringify(held.envelope)),resolve:true,commandId:'event:2'});
    if(accepted.status!=='ready')throw Error('fixture incomplete');
    expect(accepted.public.roll).toEqual(held.public.roll);expect(accepted.public.phase).toBe('resolved');expect(accepted.patch?.runtime_revision).toBe(Number(request.character.runtime_revision)+1);
    await expect(executeJourneyCheck({...request,envelope:accepted.envelope,resolve:true})).rejects.toThrow('завершена');
  });
  it('validates influence from data, preserves non-d20 dice and spends inspiration once',async()=>{
    const request=input();request.character.resources={...request.character.resources,heroic_inspiration:1};request.character.max_resources={...request.character.max_resources,heroic_inspiration:1};
    const held=await executeJourneyCheck(request);if(held.status!=='ready')throw Error('fixture');
    expect(held.public.influences.length).toBeGreaterThan(0);
    await expect(executeJourneyCheck({...request,envelope:held.envelope,resolve:true,effectId:'forged'})).rejects.toThrow();
    const used=await executeJourneyCheck({...request,envelope:held.envelope,resolve:true,effectId:held.public.influences[0].id});if(used.status!=='ready')throw Error('fixture');
    expect(used.envelope.influenced).toBe(true);expect(used.patch?.resources.heroic_inspiration).toBe(0);
  });
  it('runs another skill and automatic event healing through the shared rules',async()=>{
    const request=input();request.check={ability:'str' as 'dex',skill:'athletics',dc:10};request.character.current_hp=1;
    const held=await executeJourneyCheck(request);expect(held.status).toBe('ready');
    const healed=await executeJourneyEffect({...request,hazard:{id:'event:fountain',name:'Фонтан',sourceKind:'environment',sourceEntityIds:['fountain-v2'],resolution:'automatic',effects:[{kind:'healing',amount:'1d4'}]}});
    if(healed.status!=='ready')throw Error('fixture');expect(healed.patch.current_hp).toBeGreaterThan(1);expect(healed.events.some(e=>e.type==='healing')).toBe(true);
    const damaged=await executeJourneyEffect({...request,hazard:{id:'event:fall',name:'Падение',sourceKind:'environment',sourceEntityIds:['bridge-v1'],resolution:'automatic',effects:[{kind:'damage',dice:'1d4',type:'bludgeoning'}]}});
    if(damaged.status!=='ready')throw Error('fixture');expect(damaged.patch.current_hp).toBe(0);
  });
});
