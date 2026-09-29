import { describe, expect, it, vi } from 'vitest';
import { availableRollInfluences } from './rollInfluence';
import { influencedSheetRoll } from '../character/influencedSheetRoll';
import { FIGHTER_CTX_EQUIPPED, equippedFighterState } from '../mvp/fixtures';
import completion from '../../../scripts/content/data/item-completion-high-20260929.json';

type Dict = Record<string, unknown>;
const data = completion as unknown as Record<string, { mechanics: Dict }>;
const book = (number: number) => {
  const id = `CARD-${number.toString().padStart(4,'0')}`, mechanics = data[id].mechanics;
  const cardId = String(mechanics.requires_item_source);
  const state = { ...equippedFighterState(), inventory: [{ cardId, qty: 1 }] };
  const source = { ...mechanics, id, name: id };
  const character = { ...FIGHTER_CTX_EQUIPPED, knownCards: [{ id: cardId, name: id, mechanics }] } as unknown as typeof FIGHTER_CTX_EQUIPPED;
  return { state, source, character };
};

describe('catalog books as chosen roll influences', () => {
  it.each([[708,'history'],[724,'insight'],[726,'religion']] as const)('%i applies only to chosen %s checks and records its source once', (number, skill) => {
    const input = book(number), random = vi.fn(() => 0.45);
    const rolled = influencedSheetRoll('check', { modifiers: [] }, input.state, [input.source], random, { character: input.character, skill });
    expect(rolled.request.beforeInfluences()).toHaveLength(1);
    rolled.request.beforeInfluence(input.source.id);
    const roll = rolled.request.roll();
    expect(roll.total).toBe(15); expect(roll.modifiers.some(modifier => modifier.source === input.source.id && modifier.value === 5)).toBe(true);
    expect(rolled.request.roll()).toBe(roll); expect(random).toHaveBeenCalledTimes(1);
    expect(availableRollInfluences(input.state,[input.source],'check',undefined,{timing:'before_roll',character:input.character,skill:'athletics'})).toHaveLength(0);
    const loaded = JSON.parse(JSON.stringify(input.state));
    expect(rolled.finalize(loaded).state.inventory).toEqual(input.state.inventory);
    expect(() => rolled.finalize(loaded)).toThrow('уже применено');
  });

  it('revalidates possession before confirming the chosen bonus', () => {
    const input = book(708), rolled = influencedSheetRoll('check',{modifiers:[]},input.state,[input.source],()=>0.5,{character:input.character,skill:'history'});
    rolled.request.beforeInfluence(input.source.id); rolled.request.roll();
    expect(() => rolled.finalize({...input.state,inventory:[]})).toThrow('недоступно');
  });

  it('supports a different numeric influence and optional bonus die before the roll', () => {
    const state = equippedFighterState(), sources = [{id:'other-gift',name:'Other gift',activation:{mode:'triggered',cost:[]},
      effects:[{resolution:'auto',result:[{kind:'roll_influence',operation:'add_modifier',value:2,bonus_dice:'1d6',timing:'before_roll',eligible_rolls:['check']}]}]}];
    const rolled = influencedSheetRoll('check',{modifiers:[]},state,sources,()=>0.5);
    rolled.request.beforeInfluence('other-gift'); expect(rolled.request.roll().total).toBe(17); // d20=11 +2 +d6=4
  });

  it('sets an existing successful die to one without rolling or spending twice', () => {
    const state=equippedFighterState();state.resources.luck=1;
    const source={id:'bad-luck',name:'Bad luck',activation:{mode:'triggered',cost:[{resource:'luck'}]},
      effects:[{resolution:'auto',result:[{kind:'roll_influence',operation:'set_die_result',value:1,timing:'after_roll_before_outcome',eligible_rolls:['check'],eligible_outcomes:['success']}]}]};
    const random=vi.fn(()=>0.7),rolled=influencedSheetRoll('check',{modifiers:[],target:{type:'dc',value:10}},state,[source],random);
    expect(rolled.request.roll().outcome).toBe('success');
    expect(rolled.request.influence('bad-luck').total).toBe(1); expect(random).toHaveBeenCalledTimes(1);
    expect(rolled.finalize(state).state.resources.luck).toBe(0);
    expect(()=>rolled.request.influence('bad-luck')).toThrow();
  });
});
