import {describe, expect, it} from 'vitest';
import {currentHpForMaximum, currentResourceForMaximum} from './vitalityReconciliation';
import {alignRuntimeHp} from './runtime';
import type {RuntimeState} from '../mvp/contracts';
import type {AssembledCharacter} from './assemble';
import {emptyDraft} from './types';
import {resolveCharacterRules} from './rules/resolveCharacterRules';
import {buildSavePayload} from './forgeHelpers';

describe('maximum capacity reconciliation', () => {
  it.each([[10,10,20,20],[5,10,20,10],[1,10,20,2],[0,10,20,0],[5,10,15,8],[1,20,5,1],[5,10,10,5]])('keeps the HP share %s/%s when maximum becomes %s', (current, before, after, expected) => {
    expect(currentHpForMaximum(current,before,after)).toBe(expected);
  });
  it('does not scale temporary HP or mutate the original runtime snapshot', () => {
    const before = {hp:{current:5,max:10,temp:7}} as RuntimeState;
    const after = alignRuntimeHp(before,20);
    expect(after.hp).toEqual({current:10,max:20,temp:7});
    expect(before.hp).toEqual({current:5,max:10,temp:7});
    expect(alignRuntimeHp(after,20).hp).toEqual(after.hp);
  });
  it.each([[0,2,3,1],[1,2,3,2],[2,2,3,3],[0,0,2,2],[1,3,2,1],[0,3,3,0]])('fills only new resource capacity for %s/%s → max %s', (current,before,after,expected) => {
    expect(currentResourceForMaximum(current,before,after)).toBe(expected);
  });
  it('preserves injured vitality through multiclass level, Constitution and data-owned maximum HP changes', () => {
    const classes = [{id:'fighter',name:'Fighter',hit_die:'d10'}, {id:'wizard',name:'Wizard',hit_die:'d6'}];
    const assembled = {race:null,klass:classes[0],classes,background:null,feats:[],effects:[],actions:[],spells:[],pendingChoices:[],derived:{}} as unknown as AssembledCharacter;
    const draft = {...emptyDraft(),name:'Injured multiclass',classId:'fighter',level:2,classLevels:{fighter:1,wizard:1},abilities:{str:10,dex:10,con:14,int:10,wis:10,cha:10}};
    const previous = resolveCharacterRules({draft,assembled});
    expect(previous.maxHP).toBe(18);
    const leveled = {...draft,level:3,classLevels:{fighter:1,wizard:2}};
    const next = resolveCharacterRules({draft:leveled,assembled});
    expect(next.maxHP).toBe(24);
    expect(buildSavePayload(leveled,assembled,next,9,previous.maxHP).current_hp).toBe(12);

    const stronger = {...leveled,abilities:{...leveled.abilities,con:18}};
    const conRules = resolveCharacterRules({draft:stronger,assembled});
    expect(conRules.maxHP).toBe(30);
    expect(buildSavePayload(stronger,assembled,conRules,12,next.maxHP).current_hp).toBe(15);
    const granted = resolveCharacterRules({draft:stronger,assembled,runtimeSources:[{
      source:{type:'temporary_effect',id:'renamed-source',name:'Independent source'},
      mechanics:{effects:[{kind:'modifier',applies_to:{roll:'max_hp'},value:'+6'}]},
    }]});
    expect(granted.maxHP).toBe(36);
    expect(buildSavePayload(stronger,assembled,granted,15,conRules.maxHP).current_hp).toBe(18);
  });
});
