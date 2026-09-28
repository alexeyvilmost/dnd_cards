import {describe,expect,it} from 'vitest';
import {syncRuntimeResources} from './resourceInit';
import {freshFighterState,FIGHTER_CTX_EQUIPPED} from '../mvp/fixtures';
import type {AssembledCharacter} from './assemble';
import type {Card} from '../types';

const assembled={effects:[],actions:[],spells:[],classes:[],klass:null} as unknown as AssembledCharacter;
const item=(id:string,resource:string,amount:number,attuned=false)=>({
  id,name:id,requires_attunement:attuned,
  mechanics:{activation:{mode:'passive',while:'equipped'},effects:[{resolution:'auto',result:[{kind:'resource',op:'grant',id:resource,amount}]}]},
}) as unknown as Card;

describe('item-owned resource capacity',()=>{
  it('adds a spell slot and a reaction through the same grant collector, respecting equip and attunement',()=>{
    const cards=[item('amulet','spell_slot_2',1,true),item('ring','reaction',1)];
    const state=freshFighterState();state.equipment={necklace:'amulet',ring_1:'ring'};
    const ctx={...FIGHTER_CTX_EQUIPPED,attunedIds:['amulet']};
    const result=syncRuntimeResources(ctx,assembled,state,[],cards);
    expect(result.maxResources.spell_slot_2).toBe(1);
    expect(result.maxResources.reaction).toBe(2);
    expect(result.sources.spell_slot_2).toContainEqual(expect.objectContaining({source:'amulet',value:1}));
    const unattuned=syncRuntimeResources({...ctx,attunedIds:[]},assembled,state,[],cards);
    expect(unattuned.maxResources.spell_slot_2).toBeUndefined();
  });
  it('preserves expenditure over reload and unequip/re-equip instead of replenishing a unique granted pool',()=>{
    const cards=[item('slot-item','spell_slot_2',1)];
    const state=freshFighterState();state.equipment={necklace:'slot-item'};
    const initial=syncRuntimeResources(FIGHTER_CTX_EQUIPPED,assembled,state,[],cards);
    const spent={...state,resources:{...initial.resources,spell_slot_2:0},maxResources:initial.maxResources};
    const removed=syncRuntimeResources(FIGHTER_CTX_EQUIPPED,assembled,{...spent,equipment:{}},[],cards);
    expect(removed.maxResources.spell_slot_2).toBe(0);
    const restored=syncRuntimeResources(FIGHTER_CTX_EQUIPPED,assembled,JSON.parse(JSON.stringify({...spent,...removed})),[],cards);
    expect(restored.maxResources.spell_slot_2).toBe(1);
    expect(restored.resources.spell_slot_2).toBe(0);
  });
  it('does not turn an active resource restoration into a permanent capacity grant',()=>{
    const card=item('active','spell_slot_2',4);
    (card.mechanics!.activation as Record<string,unknown>).mode='active';
    const state=freshFighterState();state.equipment={necklace:'active'};
    expect(syncRuntimeResources(FIGHTER_CTX_EQUIPPED,assembled,state,[],[card]).maxResources.spell_slot_2).toBeUndefined();
    state.activeEffects=[{id:'active-grant',name:'Restore',source:'test',mechanics:card.mechanics!}];
    expect(syncRuntimeResources(FIGHTER_CTX_EQUIPPED,assembled,state).maxResources.spell_slot_2).toBeUndefined();
  });
});
