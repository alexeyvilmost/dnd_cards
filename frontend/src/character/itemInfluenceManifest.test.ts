import {describe,expect,it} from 'vitest';
import manifest from '../../../backend/migrations/data/catalog-audit-20260929/item-influences.json';
import overrides from '../../../scripts/content/data/item-influences-20260929.json';
import {validateMechanics} from '../engine/validateMechanics';
import {availableRollInfluences,spendRollInfluence} from '../engine/rollInfluence';
import {rollD20} from '../engine/roll';
import {createSheetCombatRuntime} from './sheetCombatRuntimeFactory';
import type {AssembledCharacter} from './assemble';
import type {Action,Card} from '../types';
import type {ForgeCharacter} from './types';
import {prepareSheetCheckCommit} from './checkManeuvers';
import {influencedSheetRoll} from './influencedSheetRoll';
import type {CharacterContext,RuntimeState} from '../mvp/contracts';

const actions=manifest.entities.map(entry=>entry.patch) as unknown as Action[];
describe('current item influence data through canonical collectors',()=>{
  it('consumes one single-use gift and retains the same consumption in a serialized atomic sheet command',()=>{
    const gift=actions.find(action=>action.card_number==='ACT-item-influence-0445')!;
    const id=String(gift.mechanics!.requires_item_source);
    const card={id,name:'Gift',mechanics:{activation:{mode:'passive',while:'carried'}}} as unknown as Card;
    const character={knownCards:[card]} as CharacterContext;
    const state:RuntimeState={resources:{},maxResources:{},equipment:{},inventory:[{cardId:id,qty:1}],hp:{current:10,max:10,temp:0},activeEffects:[]};
    const source={...gift.mechanics,id:gift.id,name:gift.name};
    const flow=influencedSheetRoll('check',{target:{type:'dc',value:99}},state,[source],()=>0,{character});
    flow.request.beforeInfluence(gift.id);
    const roll=flow.request.roll();
    expect(roll.outcome).toBe('success');
    const paid=flow.finalize(state);
    expect(paid.state.inventory).toEqual([]);
    expect(paid.events.filter(event=>event.type==='item_consumed')).toHaveLength(1);
    const request=prepareSheetCheckCommit({character:{id:'hero',runtime_revision:4,turn_state:{}} as ForgeCharacter,
      state:paid.state,events:paid.events,commandId:'fixed-gift-command',rulesContent:gift.mechanics});
    const saved=JSON.parse(JSON.stringify(request));
    expect(saved.request.participants[0].patch.inventory_items).toEqual([]);
    expect(saved.request.participants[0].patch).not.toHaveProperty('equipment');
    expect(saved.request.command_id).toBe('fixed-gift-command');
    expect(availableRollInfluences(JSON.parse(JSON.stringify(paid.state)),[source],'check',undefined,{timing:'before_roll',character})).toEqual([]);
    expect(()=>flow.finalize(paid.state)).toThrow();
    expect(state.inventory[0].qty).toBe(1);
  });
  it('validates every emitted Action and preserves shared pool costs in the choice pair',()=>{
    for(const action of actions) expect(validateMechanics(action.mechanics,{id:action.id,name:action.name,kind:'action'}),action.card_number).toEqual({valid:true,errors:[]});
    const first=actions.find(action=>action.card_number==='ACT-item-influence-0544-adv')!;
    const second=actions.find(action=>action.card_number==='ACT-item-influence-0544-dis')!;
    expect(first.mechanics?.uses).toEqual({count:3,per:'day'});
    expect((second.mechanics?.activation as {cost:unknown[]}).cost).toEqual([{resource:'uses_ACT-item-influence-0544-adv',amount:1}]);
    expect(overrides['CARD-0637'].append_payloads).toContainEqual({kind:'attunement_capacity',amount:1});
    expect(overrides['CARD-0890'].append_payloads).toContainEqual({kind:'attunement_capacity',amount:-1});
  });

  it('hydrates two item action grants, shares three charges and rejects old actions after unequipping',async()=>{
    const refs=['ACT-item-influence-0381','ACT-item-influence-0544-adv','ACT-item-influence-0544-dis'];
    const owned=actions.filter(action=>refs.includes(action.card_number));
    const ids=[...new Set(owned.map(action=>String(action.mechanics!.requires_item_source)))];
    const cards=ids.map((id,index)=>({id,card_number:`CARD-TEST-${index}`,name:`Item ${index}`,type:'ring',requires_attunement:false,
      mechanics:{activation:{mode:'passive',while:'equipped'},effects:[{resolution:'auto',result:owned.filter(action=>action.mechanics!.requires_item_source===id).map(action=>({kind:'grant_action',value:action.card_number}))}]},
    })) as unknown as Card[];
    const assembled={race:{id:'race',name:'Human',speed:30},klass:null,subclass:null,background:null,feats:[],effects:[],actions:[],spells:[],pendingChoices:[],featAbilityIncreases:[],derived:{}} as unknown as AssembledCharacter;
    const character={id:'hero',name:'Hero',user_id:'qa',access_mode:'owner',level:1,race_id:'race',system_id:'dnd5e-2024',ruleset_version:'2024',runtime_revision:0,
      abilities:{str:12,dex:12,con:12,int:12,wis:12,cha:12},current_hp:10,max_hp:10,resources:{action:1,bonus_action:1,reaction:1},max_resources:{action:1,bonus_action:1,reaction:1},
      active_effects:[],resolved_choices:{},equipment:{ring_1:ids[0],ring_2:ids[1]},inventory_items:ids.map(card_id=>({card_id,qty:1})),turn_state:{}} as unknown as ForgeCharacter;
    const factory=createSheetCombatRuntime({loadAssembly:async()=>assembled,cardsApi:{getCard:async id=>cards.find(card=>card.id===id)!},
      actionsApi:{getAction:async ref=>owned.find(action=>action.card_number===ref)!},effectsApi:{getEffect:async()=>{throw Error('unexpected effect');}},loadMasteryEffectsStrict:async()=>[]});
    const {canonical}=await factory.loadSheetCombatParticipant({character,cards:new Map()});
    const actor=canonical.world.actors.hero;
    const before=availableRollInfluences(actor.runtime,actor.passives ?? [],'attack',undefined,{timing:'before_roll',character:actor.character});
    expect(before).toHaveLength(2);
    expect(actor.runtime.resources.uses_ACT_ITEM).toBeUndefined();
    expect(actor.runtime.resources['uses_ACT-item-influence-0544-adv']).toBe(3);
    const spent=spendRollInfluence(actor.runtime,before[1]).state;
    expect(spent.resources['uses_ACT-item-influence-0544-adv']).toBe(2);
    const held=rollD20({rng:()=>.1});
    expect(availableRollInfluences(spent,actor.passives ?? [],'check',held,{character:actor.character}).some(row=>row.mechanics.requires_item_source===ids[0])).toBe(true);
    expect(availableRollInfluences({...spent,equipment:{}},actor.passives ?? [],'attack',undefined,{timing:'before_roll',character:actor.character})).toEqual([]);
  });
});
