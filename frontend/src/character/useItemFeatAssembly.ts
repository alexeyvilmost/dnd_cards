import {useEffect,useMemo,useState} from 'react';
import {loadAssembly,type AssembledCharacter} from './assemble';
import type {CharacterDraft} from './types';
import type {ItemMechanic} from './attunement';
import {itemFeatReferences,loadItemFeatAssembly,withItemFeatAssembly,bindItemFeatSources} from './itemFeatGrants';

export function useItemFeatAssembly(base:AssembledCharacter|null,draft:CharacterDraft|null,items:readonly ItemMechanic[]):AssembledCharacter|null{
  const references=useMemo(()=>base&&draft?itemFeatReferences(base,draft,items):[],[base,draft,items]);
  const key=JSON.stringify(references);
  const [loaded,setLoaded]=useState<{base:AssembledCharacter;key:string;assembly:AssembledCharacter}|null>(null);
  const [error,setError]=useState<{key:string;message:string}|null>(null);
  useEffect(()=>{
    if(!base||!draft||!references.length)return;
    let stale=false;
    void loadItemFeatAssembly(base,draft,references,loadAssembly).then(assembly=>{if(!stale){setLoaded({base,key,assembly:bindItemFeatSources(base,assembly,draft,items)});setError(null);}})
      .catch(error=>{if(!stale)setError({key,message:error instanceof Error?error.message:'Не удалось загрузить черту предмета'});});
    return ()=>{stale=true;};
  },[base,draft,key,items]);
  if(error?.key===key)throw Error(error.message);
  return base?withItemFeatAssembly(base,loaded,references):null;
}
