import type { ActorState } from './domain';
import type {WorldState} from './domain';
import type { IlluminationAttachment, WorldObjectMutationEvent, WorldObjectState } from './worldObjects';

type Dict = Record<string, unknown>;
export interface ItemLightPolicy {
  granted_action_refs?:string[];
  consumes_source?:boolean;
  item_card_id: string;
  bright_radius_ft: number;
  dim_additional_radius_ft: number;
  duration_rounds?: number;
  requires_fuel_card_id?: string;
  daylight?: boolean;
  shape?: 'sphere' | 'cone';
  facing?: 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
  mode?: 'ignite' | 'extinguish' | 'aim';
}
export function parseItemLight(mechanics: Dict): ItemLightPolicy {
  const primitive = mechanics.primitive as Dict | undefined;
  const raw = primitive?.policy as Dict | undefined;
  const keys = ['item_card_id', 'bright_radius_ft', 'dim_additional_radius_ft', 'duration_rounds', 'requires_fuel_card_id', 'daylight', 'shape', 'facing', 'mode','consumes_source','granted_action_refs'];
  if (primitive?.type !== 'item_light' || !raw || typeof raw !== 'object' || Array.isArray(raw)
    || Object.keys(raw).some(key => !keys.includes(key)) || typeof raw.item_card_id !== 'string' || !raw.item_card_id
    || ![raw.bright_radius_ft, raw.dim_additional_radius_ft].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    || Number(raw.bright_radius_ft) + Number(raw.dim_additional_radius_ft) <= 0
    || (raw.consumes_source!==undefined&&(typeof raw.consumes_source!=='boolean'||raw.duration_rounds===undefined))
    || (raw.granted_action_refs!==undefined&&(!Array.isArray(raw.granted_action_refs)||!raw.granted_action_refs.every(ref=>typeof ref==='string'&&ref.trim())))
    || (raw.duration_rounds !== undefined && (!Number.isInteger(raw.duration_rounds) || Number(raw.duration_rounds) <= 0))
    || (raw.requires_fuel_card_id !== undefined && (typeof raw.requires_fuel_card_id !== 'string' || !raw.requires_fuel_card_id.trim()))
    || (raw.daylight !== undefined && typeof raw.daylight !== 'boolean')
    || (raw.shape !== undefined && !['sphere', 'cone'].includes(String(raw.shape)))
    || (raw.shape === 'cone' && !['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].includes(String(raw.facing)))
    || (raw.mode !== undefined && !['ignite', 'extinguish', 'aim'].includes(String(raw.mode)))) throw Error('Invalid item light policy');
  return raw as unknown as ItemLightPolicy;
}

function carriedLight(objects:Record<string,WorldObjectState>,actorId:string,cardId:string):WorldObjectState|undefined {
  return Object.values(objects).filter(object=>object.itemCardId===cardId&&(object.carriedByActorId===actorId||object.heldByActorId===actorId)
    &&(object.fuelRoundsLeft===undefined||object.fuelRoundsLeft>0)).sort((a,b)=>a.id.localeCompare(b.id))[0];
}
/** A partially burnt candle uses its remaining fuel, never a fresh inventory
 * unit. Other action costs remain ordinary canonical costs. */
export function bindItemLightFuel<T extends {mechanics:Dict}>(world:Pick<WorldState,'objects'>,actorId:string,action:T):T {
  if((action.mechanics.primitive as Dict|undefined)?.type!=='item_light')return action;
  const p=parseItemLight(action.mechanics),existing=carriedLight(world.objects,actorId,p.item_card_id);
  if(!p.consumes_source||!existing||existing.fuelRoundsLeft===undefined)return action;
  const activation=action.mechanics.activation as Dict;
  return {...action,mechanics:{...action.mechanics,activation:{...activation,cost:(activation.cost as Dict[]).filter(cost=>!(cost.resource==='item'&&cost.card_id===p.item_card_id))}}};
}

/** A flame belongs to a concrete carried item, so dropping it keeps its light at
 * the object position. Fuel is an ordinary canonical item cost on the action. */
export function itemLightEvents(input: { actor: ActorState; objects: Record<string, WorldObjectState>; mechanics: Dict; actionId: string; name: string; nextId: () => string }): WorldObjectMutationEvent[] {
  const p = parseItemLight(input.mechanics), actor = input.actor;
  const existing=carriedLight(input.objects,actor.id,p.item_card_id);
  if (!existing&&!actor.runtime.inventory.some(item => item.cardId === p.item_card_id && item.qty > 0) && !Object.values(actor.runtime.equipment).includes(p.item_card_id)) throw Error('The light source is no longer in inventory');
  if (p.mode !== 'extinguish' && p.mode !== 'aim' && p.requires_fuel_card_id && !actor.runtime.inventory.some(item => item.cardId === p.requires_fuel_card_id && item.qty > 0)) throw Error('The light requires its declared fuel');
  if (p.mode === 'extinguish') return existing?.illumination ? [{ type: 'WorldObjectPatched', objectId: existing.id, patch: {}, unset: ['illumination'], reason: 'item_light_extinguished' }] : [];
  if (p.mode === 'aim') {
    if (!existing?.illumination || existing.illumination.shape !== 'cone') throw Error('Only a burning cone light can be aimed');
    return [{ type: 'WorldObjectPatched', objectId: existing.id, patch: { illumination: { ...existing.illumination, facing: p.facing } }, reason: 'item_light_aimed' }];
  }
  if (existing?.illumination) throw Error('This item is already lit');
  const illumination: IlluminationAttachment = { id: input.nextId(), sourceActorId: actor.id, sourceActionId: input.actionId,
    brightRadiusFt: p.bright_radius_ft, dimAdditionalRadiusFt: p.dim_additional_radius_ft,
    roundsLeft: existing?.fuelRoundsLeft??p.duration_rounds ?? null, ...(p.daylight ? { daylight: true } : {}), ...(p.shape ? { shape: p.shape, facing: p.facing } : {}) };
  if (existing) return [{ type: 'WorldObjectPatched', objectId: existing.id, patch: { illumination }, reason: 'item_light_ignited' }];
  return [{ type: 'WorldObjectCreated', object: { id: input.nextId(), name: input.name, kind: 'item', size: 'tiny', itemCardId: p.item_card_id,
    carriedByActorId: actor.id, ownerActorId: actor.id, illumination,
    ...(p.granted_action_refs?{grantedActionRefs:[...new Set(p.granted_action_refs)]}:{}),
    ...(p.consumes_source?{fuelRoundsLeft:p.duration_rounds!}:{}) } }];
}
