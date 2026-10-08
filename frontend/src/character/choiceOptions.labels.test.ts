import {it,expect} from 'vitest';
import {optionsForChoice} from './choiceOptions';
import type {PendingChoice} from '../mechanics/collectChoices';
it('localizes explicit spellcasting and ability-score options without changing saved keys',()=>{
  for(const grant of [{kind:'spellcasting_ability'},{kind:'grant_ability_score'}]){
    const choice:PendingChoice={id:'ability',prompt:'Выберите характеристику',count:1,source:'ability',grant,origin:{kind:'race',id:'r',name:'R'},items:[{id:'int',name:'INT'},{id:'wis',name:'WIS'},{id:'cha',name:'CHA'}]};
    expect(optionsForChoice(choice)).toEqual([{id:'int',label:'Интеллект'},{id:'wis',label:'Мудрость'},{id:'cha',label:'Харизма'}]);
  }
});
