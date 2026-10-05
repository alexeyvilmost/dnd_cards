import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {withUrvinFixture, urvinHash, sqlLiteral, assertUUID} from './urvin-fixture.mjs';
import {createScenarioAPI} from '../performance/scenarios.mjs';

const same=(left,right,message)=>assert.equal(urvinHash(left),urvinHash(right),message);
export function declineUrvinCombatChoice(state){
  if(state.pendingAlertSwapActorIds?.length)return {type:'alert_swap',actorId:state.pendingAlertSwapActorIds[0],allyActorId:null};
  if(state.pendingD20Interrupt)return {type:'d20_interrupt',actorId:null};
  if(state.pendingTriggeredAction)return {type:'triggered_action',actionId:null};
  if(state.pendingDeathSave){
    assert.ok(['rolled','resolved'].includes(state.pendingDeathSave.phase),'Unhandled authoritative death-save phase');
    return {type:'death_save',actorId:state.pendingDeathSave.actorId,phase:state.pendingDeathSave.phase};
  }
  if(state.world.pendingResolution?.request.type==='reaction')return {type:'reaction',response:{kind:'reaction',actionId:null}};
  if(state.world.pendingResolution?.request.type==='saving_throw')return {type:'saving_throw'};
  if(state.world.pendingResolution)throw Error('Unhandled authoritative combat decision in Urvin fixture');
  if(state.world.scene.initiative[state.world.scene.activeIndex]!==state.characterId)return {type:'resume'};
}

export async function checkUrvinAcceptance(stack,{part='all'}={}){
  assert.ok(['all','route','rooms'].includes(part));
  const checks=[];
  let report;
  try{report=await withUrvinFixture(stack,async fixture=>{
    const {context,mode,query}=fixture;
    const client=await createScenarioAPI(context);
    const api=(method,resource,body,status=200)=>client.request(method,resource,body,{status,trace:false});
    const offeredMode=(await api('GET','/roguelike/runs/modes')).mode;
    assert.equal(offeredMode.auras.length,5);
    const auraRules=rows=>rows.map(({id,key,mechanics})=>({id,key,mechanics}));
    same(auraRules(offeredMode.auras),auraRules(mode.auras),'Public aura mechanics differ from installed declarations');
    const catalog=(await api('GET','/character-templates')).templates;
    assert.ok(catalog.length>=3,'Canonical template catalog is incomplete');
    const sourceSnapshots=new Map(),created=[];
    const mark=(id,detail={})=>{assert.ok(!checks.some(row=>row.id===id),'Duplicate acceptance check id');checks.push({id,status:'passed',...detail});};
    async function copy(preset='line'){
      const template=catalog.find(row=>row.preset_key===preset);assert.ok(template,'Canonical template absent');
      const row=await api('POST',`/character-templates/${template.id}/copies`,{name:`Urvin local ${preset}`},201);
      assert.equal(row.user_id,client.user.id);sourceSnapshots.set(row.id,await api('GET',`/characters-v3/${row.id}`));return row;
    }
    async function invariant(runId){
      assertUUID(runId);
      return query(`SELECT json_build_object('run',md5(to_jsonb(r)::text),'characters',(SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id)::text,'')) FROM characters_v3 c WHERE c.user_id=r.user_id),'receipts',(SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id)::text,'')) FROM roguelike_command_receipts c WHERE c.run_id=r.id),'events',(SELECT md5(coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.revision)::text,'')) FROM roguelike_combat_events e WHERE e.run_id=r.id)) FROM roguelike_runs r WHERE id=${sqlLiteral(runId)} AND user_id=${sqlLiteral(client.user.id)};`);
    }
    function connected(initial){
      let run=initial;
      return {get run(){return run;},
        async reload(){run=(await api('GET',`/roguelike/runs/${run.id}`)).run;return run;},
        async command(type,payload={},status=200){
          const request={type,payload,command_id:randomUUID(),expected_revision:run.revision};
          const before=status===200?null:await invariant(run.id);
          const result=await api('POST',`/roguelike/runs/${run.id}/commands`,request,status);
          if(status!==200){same(await invariant(run.id),before,'Rejected command mutated Urvin state');return {request,result};}
          assert.equal(result.run.revision,run.revision+1,'Command must commit one revision');
          const after=await invariant(run.id);
          same(await api('POST',`/roguelike/runs/${run.id}/commands`,request),result,'Duplicate command changed response');
          same(await invariant(run.id),after,'Duplicate command changed private state or journal');run=result.run;
          return {request,result};
        }};
    }
    async function create({auraKey='ferocity',sources,preset='line',classic=false}={}){
      sources??=[await copy(preset)];
      const aura=mode.auras.find(row=>row.key===auraKey);assert.ok(aura);
      const body={source_character_ids:sources.map(row=>row.id),...(classic?{}:{mode:'urvin',aura_id:aura.id})};
      const {run}=await api('POST','/roguelike/runs',body,201);created.push(run.id);
      for(const key of ['mode_rules','journey_private','run_seed','checkpoint','combat_envelope'])assert.ok(!(key in run),'Private run data leaked');
      return connected(run);
    }
    async function room(kind,eventId,{auraKey='ferocity',preset='line'}={}){
      const run=await create({auraKey,preset});
      const nodeId=await fixture.arrangeRoom(run.run,client.user.id,{kind,eventId});
      await run.reload();await run.command('enter_room',{node_id:nodeId});return run;
    }
    async function finishCombat(run,outcome){
      for(let step=0;step<160&&(run.run.combat_state.outcome==='active'||run.run.combat_state.pendingDeathSave);step++){
        const state=run.run.combat_state;
        let intent=declineUrvinCombatChoice(state);
        if(!intent){
          const actor=state.world.actors[state.characterId];
          if(outcome==='defeat'||actor.runtime.resources.action===0)intent={type:'end_turn',actorId:actor.id};
          else {
            const action=state.catalogActions.find(row=>row.mechanics?.primitive?.type==='weapon_attack'&&row.mechanics.effects?.some(effect=>effect.attack_kind==='weapon_ranged'));
            const target=Object.values(state.world.actors).find(row=>row.kind==='monster'&&row.runtime.hp.current>0);
            assert.ok(action&&target,'Canonical ranged combat fixture is incomplete');
            intent={type:'approach_action',actorId:actor.id,actionId:action.id,targetActorId:target.id};
          }
        }
        await run.command('combat_intent',{intent});
      }
      assert.equal(run.run.combat_state.outcome,outcome,'Bounded actual combat failed to reach required outcome');
      assert.ok(!run.run.combat_state.pendingDeathSave,'Combat conclusion still has a held death save');
    }
    if(part!=='rooms'){
      const auras=[];
      for(const aura of mode.auras){
        const first=await copy(),second=await copy('swordsman');
        if(aura.key==='solitude')await api('POST','/roguelike/runs',{source_character_ids:[first.id,second.id],mode:'urvin',aura_id:aura.id},400);
        const run=await create({auraKey:aura.key,sources:aura.key==='solitude'?[first]:[first,second]});
        assert.equal(run.run.mode,'urvin');assert.equal(run.run.journey.aura.id,aura.id);assert.equal(run.run.journey.nodes.length,43);
        assert.ok(run.run.characters.every(row=>row.active_effects.some(effect=>effect.id===aura.id)));
        auras.push({key:aura.key,run,source:first});mark('aura-'+aura.key,{party:run.run.characters.length});
      }
      assert.equal(auras.find(row=>row.key==='wealth').run.run.gold-auras.find(row=>row.key==='ferocity').run.run.gold,200);mark('wealth-once');
      const first=auras[0],second=await create({auraKey:mode.auras[0].key,sources:[first.source]}),classic=await create({sources:[first.source],classic:true});
      assert.equal(new Set([first.run.run.character_id,second.run.character_id,classic.run.character_id]).size,3);
      assert.equal(second.run.source_character_id,first.source.id);assert.equal(classic.run.source_character_id,first.source.id);mark('source-independent-copies');
      const peer=await createScenarioAPI(context,{role:'peer'});
      await peer.request('GET',`/roguelike/runs/${first.run.run.id}`,undefined,{status:404,trace:false});mark('peer-ownership');
      const run=first.run;
      for(const type of ['start_encounter','long_rest','short_rest','buy','victory'])await run.command(type,{},409);
      await run.command('enter_room',{node_id:'r14-l0'},409);mark('route-and-room-gates');
      await run.command('enter_room',{node_id:'r0-l0'});assert.equal(run.run.phase,'combat');
      await run.command('initialize_combat');assert.ok(run.run.combat_state);assert.ok(run.run.combat_state.battleMap.id.startsWith('urvin-'));
      const before=run.run.combat_state,privateBefore=await invariant(run.run.id);await run.reload();same(run.run.combat_state,before,'Combat reload drift');same(await invariant(run.run.id),privateBefore,'Reload writes private run');mark('route-combat-reload-retry');
    }
    if(part!=='route'){
      {
        const run=await room('treasure',undefined,{auraKey:'solitude'});
        assert.equal(run.run.last_reward.experience,70);assert.equal(run.run.last_reward.items.length,1);assert.ok(run.run.journey.nodes[0].completed);
        await run.command('enter_room',{node_id:'r0-l0'},409);mark('treasure-xp-loot-once');
      }
      {
        const run=await room('shop');assert.ok(run.run.shop.offers.length>=mode.shop.minimum_magic_items);assert.ok(run.run.shop.staples.length);
        const offer=run.run.shop.offers.find(row=>!row.sold);assert.ok(offer);const gold=run.run.gold;
        await run.command('buy',{offer_id:offer.id});assert.ok(run.run.gold<gold);await run.command('leave_room');await run.command('buy_cart',{items:[]},409);mark('shop-buy-once-and-close');
      }
      for(const kind of ['pass','camp']){
        const run=await room(kind),type=kind==='camp'?'long_rest':'short_rest';
        const before=await api('GET',`/characters-v3/${run.run.character_id}`);
        await run.command(type,{preserve_preparation:true});assert.ok(run.run.journey.nodes[0].completed);
        const accepted=run.run;await run.reload();same(run.run,accepted,'Rest reload changed its accepted state');
        const after=await api('GET',`/characters-v3/${run.run.character_id}`);
        for(const [key,value]of Object.entries(after.resources))assert.ok(value>=0&&value<=(after.max_resources[key]??0),'Rest pool exceeds its canonical maximum');
        const introducedPools=Object.keys(after.max_resources).filter(key=>!Object.hasOwn(before.max_resources,key));
        await run.command(type,{},409);same(await api('GET',`/characters-v3/${run.run.character_id}`),after,'Repeated completed rest changed canonical resources');
        mark(kind+'-canonical-rest-once',{introducedPools:introducedPools.length});
      }
      for(const kind of ['elite','boss']){
        const original=await room(kind);assert.ok(original.run.encounter.roster.some(row=>row.monster_slug.startsWith('urvin-')));
        await original.command('initialize_combat');assert.ok(original.run.combat_state.battleMap.id.startsWith('urvin-'));mark(kind+'-original-guardian-compiles');
        const run=await fixture.withCombatProfile('passive',async()=>{
          const run=await room(kind,undefined,{preset:'archer'});await run.command('initialize_combat');return run;
        });
        await finishCombat(run,'victory');await run.command('complete_encounter');assert.equal(run.run.encounters_won,1);assert.equal(run.run.last_reward.items.length,1);
        const item=await api('GET',`/cards/${run.run.last_reward.items[0].card_id}`);
        assert.ok(['uncommon','rare','epic','legendary','artifact'].includes(item.rarity));if(kind==='boss')assert.notEqual(item.rarity,'uncommon');
        assert.equal(run.run.status,kind==='boss'?'victory':'active');mark(kind+'-actual-victory-reward-retry');
      }
      for(const event of mode.events)for(const option of event.options.filter(row=>row.checks?.length)){
        const run=await room('event',event.id);await run.command('event_choice',{option_id:option.id,character_id:run.run.character_id});
        let transitions=0,heldChecks=0;
        while(!run.run.journey.event.finished){
          assert.ok(transitions++<option.checks.length*5+5,'Event continuation exceeded declared check budget');
          const pending=run.run.journey.event.pending;
          if(!pending){
            await run.command('event_roll');const held=run.run.journey.event.pending;assert.ok(held.roll.dice.length);heldChecks++;
            const saved=await invariant(run.run.id);await run.reload();same(run.run.journey.event.pending,held,'Journey pending reload drift');same(await invariant(run.run.id),saved,'Journey reload modified private state');
            for(const type of ['camp_action','transfer_item','confirm_level_up','event_roll','claim_stash'])await run.command(type,{},409);
          }else if(pending.phase==='influence'||pending.phase==='boost'){
            const total=pending.roll.total;await run.command('event_resolve');assert.equal(run.run.journey.event.pending.roll.total,total,'Declining influence rerolled a check');
          }else if(pending.phase==='resolved')await run.command('event_continue');
          else throw Error('Unhandled saved journey phase');
        }
        assert.ok(heldChecks>0);mark(`event-${event.id}-${option.id}`,{heldChecks,transitions});
      }
      {
        const run=await fixture.withCombatProfile('lethal',async()=>{
          const run=await room('event','sleeping-goblins');const option=run.run.journey.event.definition.options.find(row=>row.success?.surprise);assert.ok(option);
          await run.command('event_choice',{option_id:option.id,character_id:run.run.character_id});assert.ok(run.run.encounter.enemy_effects.length);
          assert.ok(run.run.encounter.roster.every(row=>row.monster_slug==='goblin-warrior'));assert.equal(run.run.journey.nodes[0].resolved_kind,'normal');
          await run.command('initialize_combat');return run;
        });
        assert.ok(run.run.combat_state.initiative.filter(row=>row.actorId!==run.run.character_id).every(row=>row.roll.advantage==='disadvantage'));
        await finishCombat(run,'defeat');
        assert.equal(run.run.status,'defeat');assert.equal(run.run.phase,'ended');
        // The authoritative death-save acknowledgement finalizes defeat in
        // that same receipt; only victory has a separate reward command.
        await run.command('complete_encounter',{},409);const composition=run.run.encounter.composition_key;
        await run.command('retry');assert.ok(run.run.journey.event.finished);assert.equal(run.run.journey.nodes[0].resolved_kind,'normal');
        await run.command('resume_room');assert.equal(run.run.encounter.composition_key,composition);mark('ambush-checkpoint-defeat-retry');
      }
    }
    for(const [id,before] of sourceSnapshots)same(await api('GET',`/characters-v3/${id}`),before,'Urvin mutated its source sheet');
    mark('source-sheets-unchanged',{count:sourceSnapshots.size});
    assert.ok(checks.length>0);
    return {schemaVersion:1,status:'passed',execution:'native-owned-api',runId:context.registry.runId,part,artifactHash:stack.registry.artifactHash,
      checks,createdRuns:created.length,limitations:['Integration fixture; historical migration chain not exercised','Terminal combat uses declared synthetic pre-init stats; not balance proof']};
  });}catch(error){
    // Record only named completed checks, never an API body or a character snapshot.
    if(stack?.registry?.directory)await writeFile(path.join(stack.registry.directory,'urvin-acceptance.json'),JSON.stringify({schemaVersion:1,status:'failed',runId:stack.registry.runId,part,checks},null,2)+'\n');
    throw error;
  }
  await writeFile(path.join(stack.registry.directory,'urvin-acceptance.json'),JSON.stringify(report,null,2)+'\n');return report;
}
