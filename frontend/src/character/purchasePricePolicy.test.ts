import {describe,it,expect} from 'vitest';
import {purchasePrice} from './inventory';
import {cardForOffer,shopPriceCopper} from '../roguelike/shopPresentation';
import type {Card} from '../types';
import type {RoguelikeOffer} from '../roguelike/api';
describe('flat catalog purchase price policy',()=>{
 it.each([200,75])('normalizes currency before discount %s and never pays negative',discount=>{
  const passives=[{effects:[{resolution:'auto',result:[{kind:'purchase_price_policy',discount_copper:discount}]}]}];
  const card={id:'goods',price:5,price_currency:'gold'} as Card;
  expect(purchasePrice(card,passives).payable).toBe((500-discount)/100);
  expect(purchasePrice({...card,price:1,price_currency:'copper'},passives).payable).toBe(0);
  const offer={id:'offer',price:500,price_currency:'copper',quantity:1} as RoguelikeOffer;
  expect(shopPriceCopper(cardForOffer(card,offer),[offer],passives)).toBe(500-discount);
  expect(card.price).toBe(5);
 });
});
