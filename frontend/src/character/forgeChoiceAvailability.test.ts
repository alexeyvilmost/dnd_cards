import {describe, expect, it} from 'vitest';
import type {Feat} from '../types';
import type {PendingChoice} from '../mechanics/collectChoices';
import type {CharacterRuleState} from './rules/types';
import {forgeChoiceUnavailableOptions} from './forgeChoiceAvailability';

const feats = [
  {id:'first',card_number:'FEAT-a',name:'A',category:'general',prerequisite:'уровень 4+'},
  {id:'second',card_number:'STYLE-b',name:'B',category:'fighting_style',prerequisite:'Сила 13+'},
] as Feat[];
const choice: PendingChoice = {id:'pick',source:'feat',count:1,prompt:'Choose',origin:{kind:'class',id:'class',name:'Class'},grant:{kind:'grant_feat'},
  items:[{id:'option-a',name:'A option',value:'FEAT-a'}, {id:'option-b',name:'B option',grants:[{kind:'grant_feat',value:'second'}]}]};
const state = {classLevels:{fighter:3},abilities:{str:12},weaponMasteries:[],
  spells:{known:[],cantrips:[],leveled:[]},appliedGrants:[],expertise:{skills:[],tools:[]},
  proficiencies:{skills:[],tools:[],weapons:[],armor:[],languages:[],savingThrows:[]}} as unknown as CharacterRuleState;

describe('Forge declared feat option availability',()=>{
  it('applies each canonical feat prerequisite to its distinct persisted option id',()=>{
    expect(forgeChoiceUnavailableOptions(choice,state,[],feats)).toEqual({'option-a':'Требуется уровень 4+','option-b':'Требуется STR 13+'});
    expect(forgeChoiceUnavailableOptions(choice,{...state,classLevels:{fighter:2,rogue:2},abilities:{str:14}},[],feats)).toEqual({});
  });
  it('blocks acquiring an already owned explicit grant, while permitting its removal',()=>{
    const eligible={...state,classLevels:{fighter:4},abilities:{str:14}};
    expect(forgeChoiceUnavailableOptions(choice,eligible,[],feats,[feats[1]])['option-b']).toContain('Уже получена');
    expect(forgeChoiceUnavailableOptions(choice,eligible,['option-b'],feats,[feats[1]])['option-b']).toBeUndefined();
  });
});
