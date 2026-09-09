import {expect,it} from 'vitest';
import {cardPropertyList} from './cardProperties';
it.each([null,undefined,[],{},42])('handles empty and invalid property shapes without crashing: %s',value=>expect(cardPropertyList(value)).toEqual([]));
it('normalizes serialized database properties without changing their rule identifiers',()=>{
 expect(cardPropertyList('["two-handed","heavy"]')).toEqual(['two-handed','heavy']);
 expect(cardPropertyList(['two-handed','heavy'])).toEqual(['two-handed','heavy']);
 expect(cardPropertyList('heavy')).toEqual(['heavy']);
});
