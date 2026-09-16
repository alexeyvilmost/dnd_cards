import {describe,it,expect} from 'vitest';
import {priceInCopper,walletInCopper,spendCopper,formatCopper} from './money';
describe('exact coin conversion',()=>{
 it('changes five gold after a five copper purchase',()=>{expect(spendCopper({gold:5},5)).toMatchObject({gold:4,silver:9,copper:5})});
 it('buys twenty ammunition units for one gold',()=>{expect(spendCopper({gold:5},priceInCopper(5*20,'copper'))).toMatchObject({gold:4,silver:0,copper:0})});
 it('uses mixed coins and keeps all value without a fee',()=>{const initial={gold:1,silver:12,copper:17,platinum:1};const next=spendCopper(initial,23)!;expect(walletInCopper(next)).toBe(walletInCopper(initial)-23);expect(formatCopper(495)).toBe('4 зм 9 см 5 мм')});
 it('rejects negative, fractional and unaffordable charges',()=>{for(const n of [-1,1.5,501,NaN])expect(spendCopper({gold:5},n)).toBeNull()});
 it('rounds only fractions of a copper, not a gold',()=>{expect(priceInCopper(.05,'gold')).toBe(5);expect(priceInCopper(.3,'silver')).toBe(3)});
});
