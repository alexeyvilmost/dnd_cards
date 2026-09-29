import {collectChoices,type PendingChoice} from '../mechanics/collectChoices';
import {optionsForChoiceSource} from '../mechanics/registries';
import type {RuntimeRuleSource} from './rules/types';

type Dict=Record<string,unknown>;
/** Uses the exact runtime source identity consumed by resolveCharacterRules. */
export function collectRuntimeItemChoices(sources:readonly RuntimeRuleSource[],resolved:Record<string,string[]>):PendingChoice[]{
  return sources.flatMap(({source,mechanics})=>{
    const activation=mechanics?.activation as Dict|undefined;
    if(source.type!=='item'||activation?.mode!==undefined&&activation.mode!=='passive')return [];
    return collectChoices(mechanics,{kind:'other',id:source.id,name:source.name,sourceId:source.id},resolved)
      .map(choice=>({...choice,context:'in_play'}));
  });
}

/** Saved item choices are bounded by the current declaration, even after content edits. */
export function validItemChoiceSelections(choice:Dict,selected:readonly string[]):string[]{
  const count=Number(choice.count??1),options=choice.options as Dict|undefined;
  if(!Number.isSafeInteger(count)||count<1||selected.length>count||new Set(selected).size!==selected.length)return [];
  const explicit=Array.isArray(options?.items)?options.items as Dict[]:[];
  const registered=optionsForChoiceSource(String(options?.source??''));
  const filter=Array.isArray(options?.filter)?options.filter as string[]:undefined;
  const domain=new Set(explicit.length?explicit.map(item=>String(item.id)):registered.map(item=>item.id).filter(id=>!filter||filter.includes(id)));
  return selected.every(value=>domain.has(value))?[...selected]:[];
}
