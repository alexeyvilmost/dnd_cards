import {describe,expect,it} from 'vitest';
import {resourceDisplayGroup,resourceDisplayOrder,type ResourceOption} from './resourcePresentation';
import {sheetResourceTileOrder} from '../components/SheetResourceTile';

describe('shared main / spellcasting / other resource order',()=>{
  it('keeps catalog-owned categories ahead of arbitrary sort orders and stable IDs',()=>{
    const options:ResourceOption[]=[
      {id:'special-turn',label:'Declared turn cost',category:'action_cost',sortOrder:9999},
      {id:'gift-casts',label:'Declared free casts',category:'spellcasting_resource',sortOrder:800},
      {id:'class-pool',label:'Class pool',category:'class_resource',sortOrder:0},
      {id:'species-pool',label:'Species pool',category:'species_resource',sortOrder:1},
    ];
    const keys=['species-pool','gift-casts','class-pool','special-turn'];
    expect(keys.sort((a,b)=>resourceDisplayOrder(a,options)-resourceDisplayOrder(b,options))).toEqual([
      'special-turn','gift-casts','class-pool','species-pool',
    ]);
    expect(resourceDisplayGroup('gift-casts',options)).toBe('spellcasting');
    expect(sheetResourceTileOrder('gift-casts',options)).toBe(resourceDisplayOrder('gift-casts',options));
  });
  it('orders normal, pact and free-use schema pools before other pools while catalog loads',()=>{
    const keys=['hit_dice_d10','freeuse-spells','pact_slot_3','spell_slot_2','action','bonus_action','reaction','spell_slot_1'];
    expect(keys.sort((a,b)=>resourceDisplayOrder(a,[])-resourceDisplayOrder(b,[]))).toEqual([
      'action','bonus_action','reaction','spell_slot_1','spell_slot_2','pact_slot_3','freeuse-spells','hit_dice_d10',
    ]);
  });
});
