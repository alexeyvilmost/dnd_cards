import type {AssembledCharacter} from './assemblyFactory';
import type {CharacterDraft} from './types';
import type {ItemMechanic} from './attunement';
import {resolveCharacterRules} from './rules/resolveCharacterRules';
import {collectGrantActionSlugs} from '../mechanics/actionGrants';

export function itemFeatReferences(base:AssembledCharacter,draft:CharacterDraft,items:readonly ItemMechanic[]):string[]{
  const rules=resolveCharacterRules({assembled:base,draft,runtimeSources:items.map(item=>({source:{type:'item',id:item.card.id,name:item.card.name},mechanics:item.mechanics}))});
  const owned=new Set(base.feats.flatMap(feat=>[feat.id,feat.card_number]));
  return [...new Set(rules.appliedGrants.filter(grant=>grant.kind==='feat'&&grant.source.type==='item'&&!owned.has(grant.value)).map(grant=>grant.value))].sort();
}

/** Reuse the complete assembler, including related effects, actions, choices,
 * spell grants and resources. Item grants never become permanent draft picks. */
export async function loadItemFeatAssembly(base:AssembledCharacter,draft:CharacterDraft,references:readonly string[],load:(draft:CharacterDraft)=>Promise<AssembledCharacter>):Promise<AssembledCharacter>{
  if(!references.length)return base;
  return load({...draft,featIds:[...new Set([...(draft.featIds??[]),...references])]});
}

export function bindItemFeatSources(base:AssembledCharacter,loaded:AssembledCharacter,draft:CharacterDraft,items:readonly ItemMechanic[]):AssembledCharacter{
  const grants=resolveCharacterRules({assembled:base,draft,runtimeSources:items.map(item=>({source:{type:'item',id:item.card.id,name:item.card.name},mechanics:item.mechanics}))}).appliedGrants;
  const roots=new Map(loaded.feats.map(feat=>[feat.id,[...new Set(grants.filter(grant=>grant.kind==='feat'&&grant.source.type==='item'
    &&(grant.value===feat.id||grant.value===feat.card_number)).map(grant=>grant.source.id))]]));
  const gate=(mechanics:Record<string,unknown>|null|undefined,ids:string[])=>{
    if(!mechanics||!ids.length)return mechanics;
    const condition={kind:'any_of',of:ids.map(id=>({kind:'item_source_active',id}))};
    const visit=(value:unknown):unknown=>{
      if(Array.isArray(value))return value.map(visit);
      if(!value||typeof value!=='object')return value;
      const row=value as Record<string,unknown>,out=Object.fromEntries(Object.entries(row).map(([key,nested])=>[key,visit(nested)]));
      if(['modifier','resistance','triggered_effect','life_policy','aura','condition_immunity','damage_rider','roll_influence'].includes(String(row.kind)))out.when=[...(Array.isArray(row.when)?row.when:[]),condition];
      return out;
    };
    const gated=visit(mechanics) as Record<string,unknown>;
    const activation=gated.activation as Record<string,unknown>|undefined;
    const trigger=activation?.trigger as Record<string,unknown>|undefined;
    if(trigger)gated.activation={...activation,trigger:{...trigger,circumstances:[...(Array.isArray(trigger.circumstances)?trigger.circumstances:[]),condition]}};
    return {...gated,requires_any_item_source:ids};
  };
  const baseEffectIds=new Set(base.effects.map(row=>row.effect.id)),baseActionIds=new Set(base.actions.map(row=>row.action.id));
  return {...loaded,effects:loaded.effects.map(row=>baseEffectIds.has(row.effect.id)?row:{...row,effect:{...row.effect,mechanics:gate(row.effect.mechanics,roots.get(row.origin.id)??[])}}),
    actions:loaded.actions.map(row=>baseActionIds.has(row.action.id)?row:{...row,action:{...row.action,mechanics:gate(row.action.mechanics,roots.get(row.origin.id)??[])}})};
}

export function withItemFeatAssembly(base:AssembledCharacter,loaded:{base:AssembledCharacter;key:string;assembly:AssembledCharacter}|null,references:readonly string[]):AssembledCharacter{
  return references.length&&loaded?.base===base&&loaded.key===JSON.stringify(references)?loaded.assembly:base;
}

export function itemFeatActionSources(assembled:AssembledCharacter,action:{id:string;card_number?:string}):string[]{
  const providers=assembled.effects.filter(({effect})=>collectGrantActionSlugs(effect.mechanics,Number.MAX_SAFE_INTEGER)
    .some(reference=>reference===action.id||reference===action.card_number));
  if(!providers.length||providers.some(({effect})=>!Array.isArray(effect.mechanics?.requires_any_item_source)))return [];
  return [...new Set(providers.flatMap(({effect})=>effect.mechanics!.requires_any_item_source as string[]))].sort();
}
