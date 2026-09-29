import {describe,expect,it} from 'vitest';
import {rollD20} from './roll';
import {applyDamageDieRules} from './rollRules';
import {withD20Replacement} from './rollInfluence';
import {collectModifiers} from './modifiers';
import {equippedFighterState} from '../mvp/fixtures';

const rule=(op:string,value?:number)=>({kind:'modifier',op,applies_to:{roll:'d20'},...(value===undefined?{}:{value})});
const tape=(values:number[])=>()=>{const next=values.shift();if(next===undefined)throw Error('Unexpected RNG draw');return next;};

describe('item-owned dice policies',()=>{
  it.each([12,20])('adds a separately declared critical d%s without doubling that extra die',faces=>{
    const adjusted=applyDamageDieRules([{sides:6,result:4},{sides:6,result:2}],
      [{kind:'modifier',op:'critical_extra_die',value:1,faces}],{rng:tape([.99])});
    expect(adjusted.delta).toBe(faces);
    expect(adjusted.dice).toEqual([{sides:6,result:4},{sides:6,result:2},{sides:faces,result:faces}]);
  });
  it.each([3,4])('rolls %s dice with advantage, retaining all discarded faces for replay',count=>{
    const rules=collectModifiers(equippedFighterState(),[rule('advantage_dice',count)],{roll:'attack'}).rules;
    const result=rollD20({advantage:'advantage',rules,rng:tape(Array.from({length:count},(_,i)=>i*.2)),target:{type:'ac',value:5}});
    expect(result.dice).toHaveLength(count);
    expect(result.dice.filter(d=>!d.discarded)).toHaveLength(1);
    expect(result.total).toBe(Math.floor((count-1)*.2*20)+1);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
  it('replacing the selected die compares all remaining disadvantage/advantage dice',()=>{
    const result=rollD20({advantage:'advantage',rules:[rule('advantage_dice',3)],
      rng:withD20Replacement(tape([.95,.9,.85]),1,'Choice')});
    expect(result.total).toBe(19);
    expect(result.dice.filter(d=>!d.discarded).map(d=>d.result)).toEqual([19]);
    expect(result.dice).toHaveLength(4);
  });
  it('disabling advantage preserves a previously cancelled disadvantage and disables extra dice',()=>{
    const rules=[rule('advantage_dice',3),rule('deny_advantage')];
    expect(rollD20({advantage:'advantage',rules,rng:tape([.5])}).dice).toHaveLength(1);
    const result=rollD20({advantage:'none',hasAdvantage:true,hasDisadvantage:true,rules,rng:tape([.5,.1,.8])});
    expect(result.advantage).toBe('disadvantage');expect(result.total).toBe(3);
  });
  it.each([1,7])('uses declared face %s for natural outcome and damage, independently of rolled faces',value=>{
    const rules=[rule('set_die_result',value)];
    const result=rollD20({rules,rng:tape([.99]),target:{type:'ac',value:5}});
    expect(result.total).toBe(value);expect(result.outcome).toBe(value===1?'miss':'hit');
    expect(result.dice).toMatchObject([{result:20,discarded:true},{result:value}]);
    const damage=applyDamageDieRules([{sides:8,result:8},{sides:4,result:3,discarded:true}],rules,{rng:()=>{throw Error('No reroll');}});
    expect(damage.delta).toBe(value-8);expect(damage.dice[0].result).toBe(value);
    expect(damage.dice[1].result).toBe(3);
  });
  it.each(['critical_on_hit','force_success'])('critical prohibition prevails over %s without converting misses to hits',op=>{
    const rules=[rule(op),rule('deny_critical')];
    expect(rollD20({rules,rng:tape([.99]),target:{type:'ac',value:12}}).outcome).toBe('hit');
    expect(rollD20({rules:[rule('deny_critical')],rng:tape([.1]),target:{type:'ac',value:12}}).outcome).toBe('miss');
  });
  it.each([4,6])('applies a d%s bonus policy to bonus dice on an ability check',faces=>{
    const result=rollD20({rules:[{...rule('bonus_die'),faces},
      {kind:'modifier',op:'die_bonus',value:1,applies_to:{roll:'d20',die:faces}}],rng:tape([.5,0])});
    expect(result.total).toBe(13);
    expect(result.dice.at(-1)).toMatchObject({sides:faces,result:2,role:'bonus'});
  });

  it.each([6,8])('adds two d%s and drops only one lowest die for an echo charge',faces=>{
    const result=applyDamageDieRules([{sides:faces,result:2}],[{op:'add_dice_drop_lowest',extra:2,drop:1}],{rng:tape([0,.99])});
    expect(result.delta).toBe(faces);
    expect(result.dice.filter(d=>!d.discarded).map(d=>d.result)).toEqual([2,faces]);
    expect(result.dice.filter(d=>d.discarded).map(d=>d.result)).toEqual([1]);
  });
  it('explodes an explicitly declared natural face once and reports the spent rule key',()=>{
    const result=applyDamageDieRules([{sides:8,result:7},{sides:8,result:8}],[{op:'explode',natural:{eq:7},limit:1,once_per_turn:'item:528'}],{rng:tape([.99])});
    expect(result.delta).toBe(8);expect(result.usedRuleKeys).toEqual(['item:528']);
  });

  it.each([3,5])('reports one actual automatic reroll with natural threshold %s and filters it after reload',max=>{
    const state=equippedFighterState(),passive={...rule('reroll'),natural:{max},once_per_turn:`rule-${max}`};
    const first=rollD20({rng:tape([0,.5]),rules:collectModifiers(state,[passive],{roll:'attack'}).rules});
    expect(first.usedRuleKeys).toEqual([`rule-${max}`]);
    const loaded=JSON.parse(JSON.stringify({...state,firedThisTurn:first.usedRuleKeys}));
    const second=rollD20({rng:tape([0]),rules:collectModifiers(loaded,[passive],{roll:'attack'}).rules});
    expect(second.total).toBe(1);expect(second.usedRuleKeys).toBeUndefined();
    expect(rollD20({rng:tape([.5]),rules:[passive]}).usedRuleKeys).toBeUndefined();
  });

  it.each([5,7])('keeps the native maximum-face explosion when an item also explodes on %s',face=>{
    const result=applyDamageDieRules([{sides:8,result:face}],[{op:'explode',natural:{eq:face},limit:1,once_per_turn:'extra'}],{explodeLimit:2,rng:tape([.99,.375])});
    expect(result.dice.map(d=>d.result)).toEqual([face,8,4]);expect(result.usedRuleKeys).toEqual(['extra']);expect(result.delta).toBe(12);
  });

});
