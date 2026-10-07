import {useEffect, useState} from 'react';
import {actionsApi, classesApi, effectsApi} from '../../api/client';
import type {CharacterClass, PassiveEffect, Action} from '../../types';
import {expandEffectGrants, gatherFeatureRefs} from '../../character/assemble';
import {emptyDraft} from '../../character/types';
import {subclassAbilitiesAtLevel, subclassProgressionLevels, type SubclassProgressionColumn} from '../../character/levelUpPresentation';
import {useSiteSettings} from '../../settings';
import DialogShell from '../DialogShell';
import ClassPreview from '../ClassPreview';
import EntitySquareCard from './EntitySquareCard';
import ForgeAbilityDisplay from './ForgeAbilityDisplay';
import '../../contexts/ForgeChoiceDialog.css';
import './SubclassProgressionDialog.css';

export default function SubclassProgressionDialog({subclasses, className, unlockLevel, selectedId, onClose}: {
  subclasses: CharacterClass[];
  className: string;
  unlockLevel: number;
  selectedId?: string;
  onClose: () => void;
}) {
  const {entityDisplay,hideTechnicalAbilities} = useSiteSettings();
  const [columns, setColumns] = useState<SubclassProgressionColumn[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const catalogKey = JSON.stringify(subclasses.map(subclass=>subclass.id));
  useEffect(()=>{
    let stale=false;
    setColumns(null); setError(false);
    const effectCache=new Map<string,Promise<PassiveEffect>>();
    const actionCache=new Map<string,Promise<Action>>();
    const getEffect=(reference:string)=>{
      if(!effectCache.has(reference)) effectCache.set(reference,effectsApi.getEffect(reference));
      return effectCache.get(reference)!;
    };
    const getAction=(reference:string)=>{
      if(!actionCache.has(reference)) actionCache.set(reference,actionsApi.getAction(reference));
      return actionCache.get(reference)!;
    };
    void Promise.all((JSON.parse(catalogKey) as string[]).map(async id=>{
      const subclass=await classesApi.getClass(id);
      const level=Math.max(unlockLevel,...Object.keys(subclass.level_progression??{}).map(Number).filter(Number.isFinite));
      const refs=gatherFeatureRefs(null,null,[],level,null,subclass);
      const effects=await Promise.all(refs.effectRefs.map(async ref=>({effect:await getEffect(ref.id),origin:ref.origin})));
      const actions=await Promise.all(refs.actionRefs.map(async ref=>({action:await getAction(ref.id),origin:ref.origin})));
      const draft={...emptyDraft(),level};
      const expanded=await expandEffectGrants(effects,draft,getEffect);
      return {subclass,effects:expanded,actions};
    })).then(result=>{if(!stale)setColumns(result);}).catch(()=>{if(!stale)setError(true);});
    return ()=>{stale=true;};
  },[catalogKey,unlockLevel,attempt]);
  const levels=columns?subclassProgressionLevels(columns,unlockLevel):[];
  return <DialogShell label={`Подклассы: ${className}`} onCancel={onClose} initialFocus="dialog" wrap className="forge-choice-dialog subclass-comparison-dialog">
    <div className="dice-dialog-title">Подклассы: {className}</div>
    <div className="dice-dialog-summary">Сравните способности каждого подкласса по уровням класса.</div>
    {error?<div className="subclass-comparison-status" role="alert"><p>Не удалось загрузить способности подклассов.</p><button type="button" className="dice-dialog-btn" onClick={()=>setAttempt(value=>value+1)}>Повторить</button></div>
      :!columns?<div className="subclass-comparison-status" role="status">Загрузка способностей…</div>
      :<div className="subclass-comparison-scroll" role="region" aria-label="Сравнение подклассов по уровням" tabIndex={0}>
        <table className="subclass-comparison-table">
          <thead><tr><th scope="col" className="subclass-level-label">Уровень класса</th>{columns.map(column=><th key={column.subclass.id} scope="col">
            <EntitySquareCard name={column.subclass.name} imageUrl={column.subclass.image_url} selected={selectedId===column.subclass.id}
              preview={<ClassPreview characterClass={column.subclass} disableHover/>}/>
          </th>)}</tr></thead>
          <tbody>{levels.map(level=><tr key={level}><th scope="row" className="subclass-level-label"><b>{level}</b><span>уровень</span></th>
            {columns.map(column=>{
              const abilities=subclassAbilitiesAtLevel(column,level,unlockLevel);
              return <td key={column.subclass.id} className={selectedId===column.subclass.id?'is-selected':undefined}>
                <ForgeAbilityDisplay mode={entityDisplay.effects} entries={abilities.effects.filter(({effect})=>!hideTechnicalAbilities||!effect.is_technical).map(({effect,origin},index)=>({key:`${effect.id}:${index}`,name:effect.name,imageUrl:effect.image_url,effect,sourceLabel:origin.name}))}/>
                <ForgeAbilityDisplay mode={entityDisplay.actions} entries={abilities.actions.map(({action,origin})=>({key:action.id,name:action.name,imageUrl:action.image_url,action,sourceLabel:origin.name}))}/>
                {!abilities.effects.length&&!abilities.actions.length&&<span className="subclass-comparison-empty" aria-label="Нет новых способностей">—</span>}
              </td>;
            })}</tr>)}</tbody>
        </table>
        {!levels.length&&<p className="subclass-comparison-status">Способности по уровням пока не указаны.</p>}
      </div>}
    <div className="dice-dialog-actions"><button type="button" className="dice-dialog-btn ghost" onClick={onClose}>Закрыть</button></div>
  </DialogShell>;
}
