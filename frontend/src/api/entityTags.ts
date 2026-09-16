import {apiClient} from './client';
import {bustPrefix} from './apiCache';
export interface EntityTag {id:string;name:string;description:string}
export interface TagCatalog {tags:EntityTag[];can_manage:boolean}
export type TaggedEntityType='card'|'action'|'effect'|'spell'|'feat'|'background'|'race'|'class'|'resource'|'variable'|'concept'|'monster'|'passive';
export const entityTagsApi={
 list:async():Promise<TagCatalog>=>(await apiClient.get('/api/entity-tags')).data,
 create:async(name:string,description:string):Promise<EntityTag>=>(await apiClient.post('/api/entity-tags',{name,description})).data,
 get:async(type:TaggedEntityType,id:string):Promise<EntityTag[]>=>(await apiClient.get(`/api/entity-tags/${type}/${encodeURIComponent(id)}`)).data.tags,
 set:async(type:TaggedEntityType,id:string,tag_ids:string[])=>{await apiClient.put(`/api/entity-tags/${type}/${encodeURIComponent(id)}`,{tag_ids});bustPrefix('/api/');window.dispatchEvent(new Event('entity-tags-changed'));},
};
export interface MerchantLevel {level:number;slots:number;magic_limit:number;uncommon_bp:number;rare_bp:number;epic_bp:number}
export interface MerchantConfig {pool_tag:string;starting_tag:string;staple_tag:string;supplies_price:number;refresh_price:number;levels:MerchantLevel[]}
export interface MerchantSettings {config:MerchantConfig;version:number;can_manage:boolean}
export interface MerchantItemRule {card_id:string;min_level:number;weight:number;kind:string;quantity:number;price:number|null}
export const merchantSettingsApi={
 get:async():Promise<MerchantSettings>=>(await apiClient.get('/api/roguelike/shop-settings')).data,
 save:async(value:MerchantSettings):Promise<MerchantSettings>=>(await apiClient.put('/api/roguelike/shop-settings',value)).data,
 item:async(id:string):Promise<MerchantItemRule>=>(await apiClient.get(`/api/roguelike/item-rules/${id}`)).data,
 saveItem:async(value:MerchantItemRule):Promise<MerchantItemRule>=>(await apiClient.put(`/api/roguelike/item-rules/${value.card_id}`,value)).data,
};
export function tagError(e:unknown){return (e as {response?:{data?:{error?:string}}})?.response?.data?.error || (e instanceof Error?e.message:'Не удалось сохранить');}
