import type {Card} from '../types';
import type {RoguelikeOffer} from './api';
import {purchasePrice} from '../character/inventory';
import {priceInCopper} from '../utils/money';

export type RunShopCard=Card&{runOfferId?:string};
export const offerId=(card:Card)=>(card as RunShopCard).runOfferId??card.id;

/** Keep catalog metadata intact: an offer price is not the item's own price. */
export function cardForOffer(card:Card,offer:RoguelikeOffer):RunShopCard {
 return {...card,runOfferId:offer.id};
}
export function shopPriceCopper(card:Card,offers:RoguelikeOffer[],passives:Record<string,unknown>[]=[]):number {
 const offer=offers.find(o=>o.id===offerId(card));
 return offer?priceInCopper(offer.price,offer.price_currency||'gold')
  :priceInCopper(purchasePrice(card,passives).payable,card.price_currency||'gold');
}
