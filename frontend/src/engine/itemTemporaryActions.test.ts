import {describe,expect,it,vi} from 'vitest';
import manifest from '../../../backend/migrations/data/catalog-audit-20260929/items.json';
import {executeAction} from './execute';
import {bindSelfItemCost} from './cost';
import {startTurn} from './turn';
import {freshFighterState,FIGHTER_CTX_EQUIPPED} from '../mvp/fixtures';
import {loadEffectGrantedActionClosure} from '../character/effectGrantedActions';
import {syncRuntimeResources} from '../character/resourceInit';
import type {AssembledCharacter} from '../character/assemble';
import type {Action,PassiveEffect} from '../types';

type Dict=Record<string,unknown>;
const rows=manifest.entities as unknown as Array<{card_number:string;id:string;preimage:Dict|null;patch:Dict}>;
const merged=(ref:string)=>{const row=rows.find(r=>r.card_number===ref)!;return {...row.preimage,...row.patch,id:row.id} as Dict;};
const assembled={effects:[],actions:[],spells:[],classes:[],klass:null} as unknown as AssembledCharacter;

describe('temporary item actions through the canonical effect closure',()=>{
  it('consumes a potion, preserves three breaths across reload, then revokes the temporary action',async()=>{
    const potion=merged('CARD-0885');
    const effect=merged('EFFECT-item-audit-885') as unknown as PassiveEffect;
    const action=merged('ACT-item-audit-fire-breath') as unknown as Action;
    const closure=await loadEffectGrantedActionClosure({roots:[potion.mechanics as Dict],grantedActions:[],characterLevel:5,
      resolveEffect:async()=>effect,resolveAction:async()=>action});
    const guarded=closure.grantedActions[0].action.mechanics!;
    let state=freshFighterState();state.inventory=[{cardId:String(potion.id),qty:1}];
    const rng=vi.fn(()=>0.5);
    const ctx={character:FIGHTER_CTX_EQUIPPED,selfId:'actor',rng,grantedEffects:{[effect.card_number!]:effect}};
    expect(()=>executeAction(state,guarded,ctx)).toThrow();
    expect(rng).not.toHaveBeenCalled();
    state=executeAction(state,bindSelfItemCost(potion.mechanics as Dict,String(potion.id)),ctx).state;
    expect(state.inventory.some(row=>row.cardId===potion.id)).toBe(false);
    expect(state.resources.potion_fire_breath).toBe(3);
    expect(state.activeEffects[0].roundsLeft).toBe(600);
    for(let remaining=2;remaining>=0;remaining--){
      state=startTurn(state).state;
      const target=freshFighterState();target.hp={current:100,max:100,temp:0};
      const result=executeAction(state,guarded,{...ctx,target:{id:'target',runtimeState:target,saveMods:{dex:-10}}});
      expect(result.state.resources.potion_fire_breath).toBe(remaining);
      expect(result.targetState?.hp.current).toBe(84);
      state=JSON.parse(JSON.stringify(result.state));
      if(remaining>0){
        const synced=syncRuntimeResources(FIGHTER_CTX_EQUIPPED,assembled,state);
        expect(synced.resources.potion_fire_breath).toBe(remaining);
        expect(synced.maxResources.potion_fire_breath).toBe(3);
        state={...state,...synced};
      }
    }
    expect(state.activeEffects.some(entry=>entry.entityRef?.cardNumber===effect.card_number)).toBe(false);
    state=startTurn(state).state;
    expect(()=>executeAction(state,guarded,ctx)).toThrow('предоставляющий');
  });
  it('synchronizes two independently declared runtime capacities without replenishing spent charges',()=>{
    const state=freshFighterState();
    state.activeEffects=[{id:'a',name:'A',source:'a',roundsLeft:10,mechanics:{effects:[{resolution:'auto',result:[{kind:'resource',op:'grant',id:'pool_a',amount:2}]}]}},
      {id:'b',name:'B',source:'b',roundsLeft:20,mechanics:{effects:[{resolution:'auto',result:[{kind:'resource',op:'grant',id:'pool_b',amount:5}]}]}}];
    state.resources={...state.resources,pool_a:0,pool_b:3};state.maxResources={...state.maxResources,pool_a:2,pool_b:5};
    const result=syncRuntimeResources(FIGHTER_CTX_EQUIPPED,assembled,JSON.parse(JSON.stringify(state)));
    expect(result.resources).toMatchObject({pool_a:0,pool_b:3});
    expect(result.maxResources).toMatchObject({pool_a:2,pool_b:5});
  });
});
