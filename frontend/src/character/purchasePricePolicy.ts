import {payloadsOf} from '../engine/mechanicsView';
/** Currency is normalized before applying flat purchase discounts. */
export function purchaseDiscountCopper(passives:readonly Record<string,unknown>[]):number{
 return passives.flatMap(payloadsOf).reduce((total,payload)=>payload.kind==='purchase_price_policy'&&Number.isSafeInteger(payload.discount_copper)&&Number(payload.discount_copper)>=0?total+Number(payload.discount_copper):total,0);
}
export function discountedPurchaseCopper(listed:number,passives:readonly Record<string,unknown>[]):number{return Math.max(0,listed-purchaseDiscountCopper(passives));}
