import {describe,expect,it,vi} from 'vitest';
import completion from '../../../scripts/content/data/item-completion-high-20260929.json';
import cards from '../../../outputs/catalog-completion-20260929/cards.json';
import {availableRollInfluences} from './rollInfluence';
import {influencedSheetRoll} from '../character/influencedSheetRoll';
import {FIGHTER_CTX_EQUIPPED,equippedFighterState} from '../mvp/fixtures';

const card=cards.find(row=>row.card_number==='CARD-0822')!;
const source={...completion['CARD-0822'].mechanics,id:card.id,name:card.name};
const character={...FIGHTER_CTX_EQUIPPED,knownCards:[card]} as unknown as typeof FIGHTER_CTX_EQUIPPED;

describe('magnifying glass as chosen detail-check influence',()=>{
 it('offers advantage for distinct skills, uses one roll, and requires possession at commit',()=>{
  const state={...equippedFighterState(),inventory:[{cardId:card.id,qty:1}]};
  expect(availableRollInfluences(state,[source],'check',undefined,{timing:'before_roll',character,skill:'investigation'})).toHaveLength(1);
  expect(availableRollInfluences(state,[source],'check',undefined,{timing:'before_roll',character,skill:'history'})).toHaveLength(1);
  expect(availableRollInfluences(state,[source],'save',undefined,{timing:'before_roll',character})).toHaveLength(0);
  const random=vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0.9);
  const rolled=influencedSheetRoll('check',{modifiers:[]},state,[source],random,{character,skill:'history'});
  rolled.request.beforeInfluence(card.id);
  expect(rolled.request.roll().dice).toHaveLength(2);
  expect(random).toHaveBeenCalledTimes(2);
  expect(rolled.request.roll().total).toBeGreaterThan(1);
  expect(()=>rolled.finalize({...state,inventory:[]})).toThrow('недоступно');
 });
});
