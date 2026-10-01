import {describe,it,expect} from 'vitest';
import type {Card} from '../types';
import type {RoguelikeOffer} from './api';
import {cardForOffer,shopPriceCopper,itemSaleCopper} from './shopPresentation';
describe('merchant presentation separates entity metadata and transaction prices',()=>{
 it('sells at half the printed fractional price and rounds the whole stack only',()=>{
  const card={id:'sale',price:2.5,price_currency:'silver'} as Card;
  expect(itemSaleCopper(card)).toBe(12);expect(itemSaleCopper(card,2)).toBe(25);
  const copper={...card,price:1,price_currency:'copper'} as Card;expect(itemSaleCopper(copper)).toBe(0);expect(itemSaleCopper(copper,2)).toBe(1);
  expect(itemSaleCopper({...card,price:null})).toBeNull();expect(itemSaleCopper({...card,price_currency:'unsupported'} as unknown as Card)).toBeNull();expect(itemSaleCopper(card,1.5)).toBeNull();
  expect(itemSaleCopper(cardForOffer(card,{id:'different-offer',price:900,quantity:1} as RoguelikeOffer))).toBe(12);
 });
 it.each([{currency:'gold',price:15,offer:1700},{currency:'silver',price:2,offer:50}])('keeps the authored $currency price in previews',({currency,price,offer})=>{
  const card={id:currency,name:'Item',price,price_currency:currency} as Card;
  const stock={id:'offer-'+currency,card_id:card.id,price:offer,price_currency:'copper',quantity:2} as RoguelikeOffer;
  const shown=cardForOffer(card,stock);
  expect(shown.price).toBe(price);expect(shown.price_currency).toBe(currency);
  expect(shopPriceCopper(shown,[stock])).toBe(offer);
  expect(card).not.toHaveProperty('runOfferId');
 });
 it('retains legacy gold offers and ordinary catalog pricing',()=>{
  const card={id:'item',price:5,price_currency:'copper'} as Card;
  const stock={id:'legacy',price:1,quantity:20} as RoguelikeOffer;
  expect(shopPriceCopper(cardForOffer(card,stock),[stock])).toBe(100);
  expect(shopPriceCopper(card,[])).toBe(5);
 });
});
