import {discountedPurchaseCopper} from '../character/purchasePricePolicy';
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
 return offer?discountedPurchaseCopper(priceInCopper(offer.price,offer.price_currency||'gold'),passives)
  :priceInCopper(purchasePrice(card,passives).payable,card.price_currency||'gold');
}

/** Printed catalog value, independent of the merchant offer or buying perks. */
export function itemSaleCopper(card:Card,quantity=1):number|null {
 if(card.price==null||!Number.isFinite(card.price)||card.price<0||!Number.isSafeInteger(quantity)||quantity<1||quantity>10000)return null;
 try {
  const value=card.price*priceInCopper(1,card.price_currency||'gold')*quantity/2;
  return Number.isFinite(value)&&value<=1e12?Math.floor(value+1e-8):null;
 }catch{return null;}
}
