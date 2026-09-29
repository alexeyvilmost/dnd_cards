import {describe, expect, it} from 'vitest';
import type {Card} from '../types';
import {attunementCapacity} from './attunement';
import {projectPaperEquipment, referencedPaperItemIds} from '../paper-sheet/equipmentEffects';
import {createPaperSheet} from '../paper-sheet/model';
import {paperEntityToken} from '../paper-sheet/references';

const item = (id: string, amount: number, whileMode = 'equipped', requiresAttunement = false) => ({
  id, name: id, requires_attunement: requiresAttunement,
  mechanics: {activation: {mode: 'passive', while: whileMode}, effects: [{resolution: 'auto', result: [{kind: 'attunement_capacity', amount}]}]},
}) as unknown as Card;

describe('data-owned attunement capacity', () => {
  it('adds and subtracts distinct eligible items without duplicates, and rejects inactive gates', () => {
    const ring = item('ring', 1, 'equipped', true), sacrifice = item('sacrifice', -1, 'carried');
    const map = new Map([ring, sacrifice].map(card => [card.id, card]));
    const inventory = [{cardId:'ring',qty:1}, {cardId:'sacrifice',qty:1}];
    expect(attunementCapacity({ring_1:'ring',ring_2:'ring'},map,{attuned_ids:['ring']},inventory)).toBe(3);
    expect(attunementCapacity({ring_1:'ring'},map,{},inventory)).toBe(2);
    expect(attunementCapacity({},map,{attuned_ids:['ring']},inventory)).toBe(2);
    expect(attunementCapacity({ring_1:'ring'},map,{attuned_ids:['ring']},[])).toBe(4);
    expect(attunementCapacity({},new Map([['loss',item('loss',-5,'carried')]]),{},[{cardId:'loss',qty:1}])).toBe(0);
  });

  it('paper projection preserves a populated fourth choice when the capacity provider is removed', () => {
    const card = item('ring',1);
    const doc = createPaperSheet();
    doc.fields['equipment.ring_1'] = paperEntityToken({type:'card',id:card.id,name:card.name});
    doc.fields.attunementName3 = paperEntityToken({type:'card',id:'fourth',name:'Fourth'});
    doc.checks.attunement3 = true;
    expect(projectPaperEquipment(doc,new Map([[card.id,card]])).attunementCapacity).toBe(4);
    delete doc.fields['equipment.ring_1'];
    expect(referencedPaperItemIds(doc)).toContain('fourth');
    expect(doc.checks.attunement3).toBe(true);
  });
  it('retains two distinct permanent sacrifices across reload and item removal',()=>{
    const effects=[1,2].map(n=>({id:`sacrifice:${n}`,name:'Sacrifice',source:'item',mechanics:{kind:'attunement_capacity',op:'add',amount:-1,duration:{type:'permanent'}}}));
    const map=new Map([['provider',item('provider',1)]]);
    expect(attunementCapacity({ring_1:'provider'},map,{},[],effects)).toBe(2);
    expect(attunementCapacity({},map,{},[],JSON.parse(JSON.stringify(effects)))).toBe(1);
  });

});
