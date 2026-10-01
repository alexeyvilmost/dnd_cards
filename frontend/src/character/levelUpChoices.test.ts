import {describe, expect, it} from 'vitest';
import type {Feat,Spell} from '../types';
import type {PendingChoice} from '../mechanics/collectChoices';
import {preparedSpellSelectionIssues} from '../mechanics/collectChoices';
import {levelUpChoiceSelectionLabels, levelUpDialogChoice, levelUpReturnURL} from './levelUpChoices';

const origin={kind:'class' as const,id:'class-one',name:'Class one'};
const spells=[{id:'spell-one',card_number:'SPELL-one',name:'Spell one',level:1,classes:['wizard']},
  {id:'spell-two',card_number:'SPELL-two',name:'Spell two',level:2,classes:['wizard']},
  {id:'child',card_number:'SPELL-child',name:'Child',level:1,classes:['wizard'],mechanics:{variant_of_spell_id:'spell-one'}}] as Spell[];
const feats=[{id:'feat',card_number:'FEAT-one',name:'Feat one',category:'general'},
  {id:'style',card_number:'STYLE-one',name:'Style one',category:'fighting_style'}] as Feat[];
describe('level-up dialog choice projection',()=>{
  it('returns run level-ups to the specific run and ordinary level-ups to their sheet',()=>{
    expect(levelUpReturnURL('hero','party-run')).toBe('/roguelike/party-run');
    expect(levelUpReturnURL('other','journey/run')).toBe('/roguelike/journey%2Frun');
    expect(levelUpReturnURL('hero',null)).toBe('/characters-v3/hero');
  });
  it('keeps separate feat and fighting-style domains and selected labels',()=>{
    for(const [filter,id,reference,label] of [['general','feat','FEAT-one','Feat one'],['fighting_style','style','STYLE-one','Style one']]) {
      const choice={id:'choice:'+filter,source:'feat',filter,count:1,prompt:'Choose',origin} as PendingChoice;
      expect(levelUpDialogChoice(choice,spells,1,[reference],feats).recommended).toEqual([id]);
      expect(levelUpChoiceSelectionLabels(choice,[reference],feats,spells)).toEqual([label]);
    }
  });
  it('preserves current selections and class-level spell filters while excluding variants',()=>{
    const choice={id:'book',source:'spell',count:2,prompt:'Learn',origin:{...origin,spellSlotLevelCap:1},options:{filter:{only_available_slots:true,classes:['wizard']}}} as PendingChoice;
    const projected=levelUpDialogChoice(choice,spells,3,['SPELL-one'],feats);
    expect(projected.items?.map(item=>item.previewSpell?.id)).toEqual(['spell-one']);
    expect(projected.recommended).toEqual(['spell-one']);
    expect(levelUpChoiceSelectionLabels(choice,['SPELL-one'],feats,spells)).toEqual(['Spell one']);
  });
  it('uses the exact allowed spellbook reference for preparation without acquiring it again',()=>{
    const choice={id:'prepared',source:'prepared_spell',count:1,prompt:'Prepare',origin,allowedOptionIds:['SPELL-one'],preparedSpellSourceChoiceId:'book'} as PendingChoice;
    const projected=levelUpDialogChoice(choice,spells,1,['spell-one'],feats);
    expect(projected.items?.map(item=>item.id)).toEqual(['SPELL-one']);
    expect(projected.recommended).toEqual(['SPELL-one']);
    expect(preparedSpellSelectionIssues(choice,projected.recommended!)).toEqual([]);
  });
});
